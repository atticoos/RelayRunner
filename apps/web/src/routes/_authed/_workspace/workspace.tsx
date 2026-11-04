import { createFileRoute, useRouter } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { useState, type ReactNode } from "react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError } from "@/lib/api";
import { authDisabled, signIn } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import {
  claimInstallation,
  getUnclaimedInstallations,
  needsGitHubSignIn,
  type Installation,
  type UnclaimedInstallations,
} from "@/lib/workspace";

// What GET /api/github/setup reports back in ?github=, in plain language.
const outcomes = {
  connected: { tone: "go", message: "GitHub org connected." },
  updated: { tone: "go", message: "Your changes on GitHub are saved." },
  unclaimed: {
    tone: "run",
    message: "The GitHub App is installed but isn't in a workspace yet. Add it under Unclaimed installations.",
  },
  requested: {
    tone: "run",
    message: "Install request sent to the org's owners. Once one approves it, add the org under Unclaimed installations.",
  },
  taken: {
    tone: "run",
    message: "That GitHub org is already connected to another workspace. An org can only belong to one workspace.",
  },
  not_found: {
    tone: "run",
    message: "Your GitHub account can't see that installation, so nothing was connected. Ask an org owner to connect it.",
  },
  expired: {
    tone: "run",
    message: "That connect link expired, so nothing was connected. If the GitHub App is installed, add it under Unclaimed installations.",
  },
  reauth: {
    tone: "run",
    message: "Your GitHub sign-in has expired, so nothing was connected. Sign in again, then add the org under Unclaimed installations.",
  },
  invalid: { tone: "run", message: "GitHub didn't say which installation to connect. Try connecting again." },
} as const;

type GitHubOutcome = keyof typeof outcomes;

function isGitHubOutcome(value: unknown): value is GitHubOutcome {
  return typeof value === "string" && Object.hasOwn(outcomes, value);
}

export const Route = createFileRoute("/_authed/_workspace/workspace")({
  validateSearch: (search: Record<string, unknown>): { github?: GitHubOutcome } => ({
    github: isGitHubOutcome(search.github) ? search.github : undefined,
  }),
  loader: (): Promise<UnclaimedInstallations> =>
    authDisabled ? Promise.resolve({ installations: [] }) : getUnclaimedInstallations(),
  component: WorkspacePage,
});

function WorkspacePage() {
  const { current, user } = Route.useRouteContext();
  const { github } = Route.useSearch();
  const unclaimed = Route.useLoaderData();
  const { workspace, role, installations } = current;

  return (
    <section>
      <PageHeader title={workspace.name}>
        Your workspace connects GitHub orgs and owns the machines that run their jobs.
      </PageHeader>
      <div className="grid max-w-3xl gap-4">
        {github && <GitHubNotice outcome={github} />}

        <Card className="py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm">Details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 px-4 text-sm">
            <Row label="Slug">
              <span className="font-mono">{workspace.slug}</span>
            </Row>
            <Row label="Owner">
              <span>{user?.name ?? "You"}</span>
              <Badge variant="idle" className="ml-2 capitalize">
                {role}
              </Badge>
            </Row>
            <Row label="Created">{new Date(workspace.createdAt).toLocaleDateString()}</Row>
          </CardContent>
        </Card>

        <Card className="py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm">GitHub orgs</CardTitle>
            <CardDescription>
              Orgs and accounts where the RelayRunner GitHub App is installed for this workspace.
            </CardDescription>
            <CardAction>
              <Button asChild size="sm" variant={installations.length ? "outline" : "default"}>
                {/* A full page load: this leaves the dashboard for GitHub's install page. GitHub
                    lists only accounts that can take a new install; with none left it opens the
                    existing installation's settings instead. */}
                <a href="/api/github/install">
                  {installations.length ? "Connect another org" : "Connect GitHub org"}
                </a>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="px-4">
            {installations.length === 0 ? (
              <p className="text-sm text-muted-foreground">No GitHub orgs connected yet.</p>
            ) : (
              <ul className="grid gap-3">
                {installations.map((installation) => (
                  <ConnectedOrg key={installation.id} installation={installation} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <UnclaimedCard
          workspaceName={workspace.name}
          unclaimed={unclaimed}
          // The notice above already has a sign-in prompt.
          hideSignIn={github === "reauth"}
        />
      </div>
    </section>
  );
}

function GitHubNotice({ outcome }: { outcome: GitHubOutcome }) {
  const { tone, message } = outcomes[outcome];
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border px-4 py-3 text-sm",
        tone === "go" ? "border-go-edge bg-go-soft" : "border-run-edge bg-run/15",
      )}
    >
      <p className="min-w-0 flex-1 basis-60">{message}</p>
      {outcome === "reauth" && <SignInAgain />}
    </div>
  );
}

function ConnectedOrg({ installation }: { installation: Installation }) {
  const { accountLogin, repositorySelection, suspendedAt, settingsUrl } = installation;
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 text-sm">
      <OrgName installation={installation}>
        <span className="text-muted-foreground">{repositorySelection === "all" ? "All repos" : "Selected repos"}</span>
      </OrgName>
      <div className="flex items-center gap-2">
        {suspendedAt ? <Badge variant="run">Suspended</Badge> : <Badge variant="go">Active</Badge>}
        <Button asChild variant="outline" size="xs">
          <a href={settingsUrl} target="_blank" rel="noreferrer" aria-label={`${suspendedAt ? "Fix" : "Configure"} ${accountLogin} on GitHub`}>
            {suspendedAt ? "Fix" : "Configure"}
            <ExternalLink aria-hidden />
          </a>
        </Button>
      </div>
    </li>
  );
}

function OrgName({ installation, children }: { installation: Installation; children?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span className="truncate font-mono">{installation.accountLogin}</span>
      <Badge variant="idle">{installation.accountType === "User" ? "Personal" : "Org"}</Badge>
      {children}
    </div>
  );
}

function UnclaimedCard({
  workspaceName,
  unclaimed,
  hideSignIn,
}: {
  workspaceName: string;
  unclaimed: UnclaimedInstallations;
  hideSignIn: boolean;
}) {
  const router = useRouter();
  const navigate = Route.useNavigate();
  const [claiming, setClaiming] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  async function claim(id: number) {
    setClaiming(id);
    setError(null);
    try {
      await claimInstallation(id);
      // Drop any ?github= notice: it was about getting this installation linked.
      await navigate({ search: {}, replace: true });
      await router.invalidate();
    } catch (cause) {
      if (needsGitHubSignIn(cause)) setExpired(true);
      else setError(claimErrorMessage(cause));
    } finally {
      setClaiming(null);
    }
  }

  const needsSignIn = (unclaimed.problem === "reauth" || expired) && !hideSignIn;
  const unavailable = unclaimed.problem === "unavailable";
  if (unclaimed.installations.length === 0 && !needsSignIn && !unavailable) return null;

  return (
    <Card className="py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">Unclaimed installations</CardTitle>
        <CardDescription>GitHub App installs your account can see that aren't in a workspace yet.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 px-4 text-sm">
        {unclaimed.installations.length > 0 && (
          <ul className="grid gap-3">
            {unclaimed.installations.map((installation) => (
              <li key={installation.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
                <OrgName installation={installation} />
                <Button variant="outline" size="xs" disabled={claiming !== null} onClick={() => claim(installation.id)}>
                  {claiming === installation.id ? "Adding…" : `Add to ${workspaceName}`}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {needsSignIn && (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p className="min-w-0 flex-1 basis-60 text-muted-foreground">
              Your GitHub sign-in has expired. Sign in again to see your installations.
            </p>
            <SignInAgain />
          </div>
        )}
        {unavailable && <p className="text-muted-foreground">Couldn't reach GitHub to check. Reload to try again.</p>}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function claimErrorMessage(error: unknown) {
  const code = error instanceof ApiError ? error.code : undefined;
  if (code === "installation_in_another_workspace") return "That GitHub org is already connected to another workspace.";
  if (code === "not_found") return "Your GitHub account can no longer see that installation.";
  if (code === "forbidden") return "Only workspace owners and admins can add GitHub orgs.";
  return "Couldn't add that installation. Try again.";
}

function SignInAgain() {
  return (
    <Button variant="outline" size="xs" onClick={() => signIn.social({ provider: "github", callbackURL: "/workspace" })}>
      Sign in again
    </Button>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <span className="flex items-center">{children}</span>
    </div>
  );
}
