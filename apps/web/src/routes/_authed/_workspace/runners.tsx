import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { authDisabled } from "@/lib/auth-client";
import { listMachines, revokeMachine, type Machine } from "@/lib/machines";

// Placeholder rows until the gateway serves hosted runners.
const hosted = [
  { name: "ubuntu-latest", kind: "GitHub-hosted", status: "running" },
  { name: "blacksmith-4vcpu", kind: "Blacksmith", status: "idle" },
] as const;

const badge = {
  running: { variant: "run", label: "Running" },
  idle: { variant: "idle", label: "Idle" },
} as const;

const osLabel = { linux: "Linux", macos: "macOS", windows: "Windows" } as const;

export const Route = createFileRoute("/_authed/_workspace/runners")({
  loader: async () => (authDisabled ? { machines: [] } : listMachines()),
  component: RunnersPage,
});

function RunnersPage() {
  const { machines } = Route.useLoaderData();
  return (
    <section>
      <PageHeader title="Runners">
        Your machines plus GitHub-hosted and Blacksmith runners. Connect a machine by running{" "}
        <code className="font-mono">npx relayrunner connect</code> on it.
      </PageHeader>
      <div className="grid max-w-3xl gap-3">
        {machines.length === 0 && (
          <Card className="py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm font-medium">No machines yet</CardTitle>
              <CardDescription>
                Run <code className="font-mono">npx relayrunner connect</code> on a laptop or server
                to add it.
              </CardDescription>
            </CardHeader>
          </Card>
        )}
        {machines.map((machine) => (
          <MachineCard key={machine.id} machine={machine} />
        ))}
        {hosted.map((runner) => (
          <Card key={runner.name} className="py-4">
            <CardHeader className="flex items-center justify-between px-4">
              <div className="grid gap-1">
                <CardTitle className="font-mono text-sm font-medium">{runner.name}</CardTitle>
                <CardDescription>{runner.kind}</CardDescription>
              </div>
              <Badge variant={badge[runner.status].variant}>{badge[runner.status].label}</Badge>
            </CardHeader>
          </Card>
        ))}
      </div>
    </section>
  );
}

function MachineCard({ machine }: { machine: Machine }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revoke() {
    setPending(true);
    setError(null);
    try {
      await revokeMachine(machine.id);
      await router.invalidate();
    } catch {
      setError("Couldn't revoke the machine. Try again.");
      setPending(false);
    }
  }

  const platform = [machine.os && osLabel[machine.os], machine.arch].filter(Boolean).join(" · ");

  return (
    <Card className="py-4">
      <CardHeader className="px-4">
        <div className="grid gap-1">
          <CardTitle className="font-mono text-sm font-medium">{machine.name}</CardTitle>
          <CardDescription>
            Your machine{platform && ` · ${platform}`}
            {error && <span className="block text-destructive">{error}</span>}
          </CardDescription>
        </div>
        <CardAction className="flex items-center gap-2">
          {confirming ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={pending}
                onClick={() => void revoke()}
              >
                {pending ? "Revoking…" : "Revoke"}
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
              Revoke
            </Button>
          )}
        </CardAction>
      </CardHeader>
    </Card>
  );
}
