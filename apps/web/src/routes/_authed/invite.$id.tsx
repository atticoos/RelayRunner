import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError } from "@/lib/api";
import { organization, signOut } from "@/lib/auth-client";
import { getInvite, inviteView, inviterName, type Invite } from "@/lib/invites";

// Where the invite email links (packages/email/src/invite.ts). It sits outside the _workspace
// layout so someone with no workspace yet isn't sent off to create one first. Signed-out
// visitors go through /login (the _authed guard) and come back here.
type Loaded = { kind: "found"; invite: Invite } | { kind: "missing" } | { kind: "error" };

export const Route = createFileRoute("/_authed/invite/$id")({
  loader: async ({ params }): Promise<Loaded> => {
    try {
      return { kind: "found", invite: await getInvite(params.id) };
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return { kind: "missing" };
      return { kind: "error" };
    }
  },
  component: InvitePage,
});

function InvitePage() {
  const loaded = Route.useLoaderData();
  return (
    <main className="grid min-h-screen place-items-center p-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        <Brand />
        {loaded.kind === "missing" && (
          <Message
            title="Invite not found"
            body="This invite link doesn't match any invite. Check the link in your email, or ask for a new one."
          />
        )}
        {loaded.kind === "error" && (
          <Message
            title="Couldn't load this invite"
            body="Something went wrong on our side. Reload the page to try again."
          />
        )}
        {loaded.kind === "found" && <InviteCard invite={loaded.invite} />}
      </div>
    </main>
  );
}

function InviteCard({ invite }: { invite: Invite }) {
  const view = inviteView(invite);
  const workspace = invite.workspace.name;
  const inviter = inviterName(invite);
  switch (view.kind) {
    case "member":
      return (
        <Message
          title={`You're already in ${workspace}`}
          body="You're a member of this workspace, so there's nothing to accept."
          action={<OpenWorkspace invite={invite} label="Open workspace" />}
        />
      );
    case "closed":
      return (
        <Message
          title={closedTitle[view.reason]}
          body={`Ask ${inviter} to send you a new invite to ${workspace}.`}
        />
      );
    case "mismatch":
      return <Mismatch invite={invite} />;
    case "pending":
      return <Pending invite={invite} />;
  }
}

const closedTitle = {
  expired: "This invite has expired",
  canceled: "This invite was cancelled",
  rejected: "This invite was declined",
} as const;

function Pending({ invite }: { invite: Invite }) {
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);
  const router = useRouter();

  async function accept() {
    setBusy("accept");
    setError(null);
    const { error } = await organization.acceptInvitation({ invitationId: invite.id });
    if (error) {
      setError(error.message ?? "Couldn't accept this invite. Reload and try again.");
      setBusy(null);
      return;
    }
    await enterWorkspace(router, invite.workspace.id);
  }

  async function decline() {
    setBusy("decline");
    setError(null);
    const { error } = await organization.rejectInvitation({ invitationId: invite.id });
    setBusy(null);
    if (error) setError(error.message ?? "Couldn't decline this invite. Reload and try again.");
    else setDeclined(true);
  }

  if (declined)
    return (
      <Message
        title="Invite declined"
        body={`You won't join ${invite.workspace.name}. You can close this tab.`}
      />
    );

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Join {invite.workspace.name}</CardTitle>
        <CardDescription>
          {inviterName(invite)} invited you to join <strong>{invite.workspace.name}</strong> as{" "}
          {article(invite.role)}. You'll share its runners and can connect your own machines.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Button
          size="lg"
          className="w-full font-bold"
          disabled={busy !== null}
          onClick={() => void accept()}
        >
          {busy === "accept" ? "Joining…" : "Accept invite"}
        </Button>
        <Button
          size="lg"
          variant="outline"
          className="w-full"
          disabled={busy !== null}
          onClick={() => void decline()}
        >
          {busy === "decline" ? "Declining…" : "Decline"}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

function Mismatch({ invite }: { invite: Invite }) {
  const { user } = Route.useRouteContext();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function switchAccount() {
    setBusy(true);
    await signOut();
    await router.navigate({ to: "/login", search: { redirect: `/invite/${invite.id}` } });
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>This invite is for someone else</CardTitle>
        <CardDescription>
          This invite to {invite.workspace.name} was for{" "}
          <strong className="break-words">{invite.email}</strong>, but you're signed in as{" "}
          <strong className="break-words">{user?.email ?? "another account"}</strong>.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Sign in with the GitHub account that uses {invite.email}, or ask {inviterName(invite)} to
          invite the email on your GitHub account.
        </p>
        <Button
          size="lg"
          variant="outline"
          className="w-full"
          disabled={busy}
          onClick={() => void switchAccount()}
        >
          Sign out
        </Button>
      </CardContent>
    </Card>
  );
}

function OpenWorkspace({ invite, label }: { invite: Invite; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="lg"
      className="w-full font-bold"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void enterWorkspace(router, invite.workspace.id);
      }}
    >
      {label}
    </Button>
  );
}

async function enterWorkspace(router: ReturnType<typeof useRouter>, workspaceId: string) {
  await organization.setActive({ organizationId: workspaceId });
  // Re-run the guards so the workspace layout loads the new active workspace.
  await router.invalidate();
  await router.navigate({ to: "/runners" });
}

function article(role: string) {
  return /^[aeiou]/i.test(role) ? `an ${role}` : `a ${role}`;
}

function Message({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{body}</CardDescription>
      </CardHeader>
      {action && <CardContent>{action}</CardContent>}
    </Card>
  );
}
