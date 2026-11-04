import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent, type ReactNode } from "react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { authDisabled, organization } from "@/lib/auth-client";
import {
  approveDevice,
  denyDevice,
  describeDeviceError,
  formatUserCode,
  openDeviceCode,
  type DeviceCodeStatus,
} from "@/lib/machines";

// Where `relayrunner connect` sends the browser: /device?user_code=ABCDEFGH&name=<hostname>.
// The user picks the workspace the machine joins and its name, then approves; the CLI picks up
// its machine token on its next poll.
type DeviceSearch = { user_code?: string; name?: string };

type Workspace = { id: string; name: string };

type Loaded =
  | { kind: "enter" }
  | { kind: "error"; message: string }
  | { kind: "done"; status: DeviceCodeStatus["status"] }
  | { kind: "review"; userCode: string; workspaces: Workspace[] };

export const Route = createFileRoute("/_authed/device")({
  validateSearch: (search: Record<string, unknown>): DeviceSearch => ({
    user_code: typeof search.user_code === "string" ? search.user_code : undefined,
    name: typeof search.name === "string" ? search.name.slice(0, 64) : undefined,
  }),
  loaderDeps: ({ search }) => ({ userCode: search.user_code }),
  loader: async ({ deps }): Promise<Loaded> => {
    if (!deps.userCode) return { kind: "enter" };
    if (authDisabled) return { kind: "review", userCode: deps.userCode, workspaces: [] };
    let status: DeviceCodeStatus;
    try {
      status = await openDeviceCode(deps.userCode);
    } catch (error) {
      return { kind: "error", message: describeDeviceError(error) };
    }
    if (status.status !== "pending") return { kind: "done", status: status.status };
    const { data } = await organization.list();
    return {
      kind: "review",
      userCode: deps.userCode,
      workspaces: (data ?? []).map(({ id, name }) => ({ id, name })),
    };
  },
  component: DevicePage,
});

function DevicePage() {
  const loaded = Route.useLoaderData();
  return (
    <main className="grid min-h-screen place-items-center p-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        <Brand />
        {loaded.kind === "enter" && <EnterCode />}
        {loaded.kind === "error" && (
          <Message title="Can't connect this machine" body={loaded.message} />
        )}
        {loaded.kind === "done" && (
          <Message
            title={loaded.status === "approved" ? "Already approved" : "Request denied"}
            body={
              loaded.status === "approved"
                ? "This machine is already approved. Head back to your terminal."
                : "This request was denied. Run `relayrunner connect` again to start over."
            }
          />
        )}
        {loaded.kind === "review" && (
          <Review userCode={loaded.userCode} workspaces={loaded.workspaces} />
        )}
      </div>
    </main>
  );
}

// For when the CLI's link was typed by hand without its code.
function EnterCode() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (code.trim()) void navigate({ to: "/device", search: { user_code: code.trim() } });
  }
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Connect a machine</CardTitle>
        <CardDescription>
          Enter the code `relayrunner connect` printed in your terminal.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
          <Input
            autoFocus
            required
            placeholder="ABCD-EFGH"
            className="font-mono uppercase"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <Button type="submit" size="lg" className="w-full font-bold" disabled={!code.trim()}>
            Continue
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Review({ userCode, workspaces }: { userCode: string; workspaces: Workspace[] }) {
  const search = Route.useSearch();
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const [name, setName] = useState(search.name ?? "");
  const [pending, setPending] = useState<"approve" | "deny" | null>(null);
  const [result, setResult] = useState<"approved" | "denied" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "approve" | "deny") {
    setError(null);
    setPending(action);
    try {
      if (action === "approve") await approveDevice({ userCode, workspaceId, name: name.trim() });
      else await denyDevice(userCode);
      setResult(action === "approve" ? "approved" : "denied");
    } catch (caught) {
      setError(describeDeviceError(caught));
    } finally {
      setPending(null);
    }
  }

  if (result === "approved")
    return (
      <Message
        title="Machine connected"
        body={`${name.trim()} is enrolled. Head back to your terminal; it finishes on its own.`}
      />
    );
  if (result === "denied")
    return <Message title="Request denied" body="Nothing was connected. You can close this tab." />;

  if (workspaces.length === 0)
    return (
      <Message
        title="Create a workspace first"
        body="Machines belong to a workspace. Create one, then run `relayrunner connect` again."
        action={
          <Button asChild size="lg" className="w-full font-bold">
            <Link to="/workspaces/new">Create a workspace</Link>
          </Button>
        }
      />
    );

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Connect a machine</CardTitle>
        <CardDescription>
          Check that this code matches your terminal. Approving lets the machine run jobs for the
          workspace's private repos.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void act("approve");
          }}
        >
          <p className="rounded-md border bg-muted py-3 text-center font-mono text-2xl tracking-widest">
            {formatUserCode(userCode)}
          </p>
          <label className="grid gap-1.5 text-sm font-medium">
            Workspace
            <select
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              value={workspaceId}
              onChange={(event) => setWorkspaceId(event.target.value)}
            >
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Machine name
            <Input
              required
              maxLength={64}
              className="font-mono"
              placeholder="my-laptop"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <div className="flex flex-col gap-2">
            <Button
              type="submit"
              size="lg"
              className="w-full font-bold"
              disabled={pending !== null || !name.trim() || !workspaceId}
            >
              {pending === "approve" ? "Approving…" : "Approve"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              disabled={pending !== null}
              onClick={() => void act("deny")}
            >
              {pending === "deny" ? "Denying…" : "Deny"}
            </Button>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>
      </CardContent>
    </Card>
  );
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
