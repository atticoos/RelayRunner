import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Placeholder rows until the API serves real runners.
const sample = [
  { name: "atticus-mbp", kind: "Your machine", status: "online" },
  { name: "ubuntu-latest", kind: "GitHub-hosted", status: "running" },
  { name: "blacksmith-4vcpu", kind: "Blacksmith", status: "idle" },
] as const;

const badge = {
  online: { variant: "go", label: "Online" },
  running: { variant: "run", label: "Running" },
  idle: { variant: "idle", label: "Idle" },
} as const;

export const Route = createFileRoute("/_authed/runners")({
  component: () => (
    <section>
      <PageHeader title="Runners">
        Your machines (online or offline) plus GitHub-hosted and Blacksmith runners. Live status will stream over a WebSocket.
      </PageHeader>
      <div className="grid max-w-3xl gap-3">
        {sample.map((runner) => (
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
  ),
});
