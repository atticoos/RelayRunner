import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authed/_workspace/workspace")({
  component: WorkspacePage,
});

function WorkspacePage() {
  const { current, user } = Route.useRouteContext();
  const { workspace, role, installations } = current;

  return (
    <section>
      <PageHeader title={workspace.name}>
        Your workspace connects GitHub orgs and owns the machines that run their jobs.
      </PageHeader>
      <div className="grid max-w-3xl gap-4">
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
          </CardHeader>
          <CardContent className="px-4">
            {installations.length === 0 ? (
              <p className="text-sm text-muted-foreground">No GitHub orgs connected yet.</p>
            ) : (
              <ul className="grid gap-2">
                {installations.map((installation) => (
                  <li key={installation.id} className="flex items-center justify-between text-sm">
                    <span className="font-mono">{installation.accountLogin}</span>
                    {installation.suspendedAt ? (
                      <Badge variant="run">Suspended</Badge>
                    ) : (
                      <Badge variant="go">{installation.accountType === "User" ? "Personal" : "Org"}</Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
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
