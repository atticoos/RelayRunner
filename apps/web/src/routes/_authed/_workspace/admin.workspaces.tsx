import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { timeAgo } from "@/lib/activity";
import { listWorkspaces } from "@/lib/admin";
import { ROLE_LABELS, type Role } from "@/lib/roles";

// Operator admin, behind Cloudflare Access and an operator session (apps/api/src/routes/admin.ts).
export const Route = createFileRoute("/_authed/_workspace/admin/workspaces")({
  loader: () => listWorkspaces(),
  component: WorkspacesPage,
  errorComponent: ({ error }) => (
    <PageHeader title="Workspaces">
      Couldn't load workspaces: {error instanceof Error ? error.message : String(error)}
    </PageHeader>
  ),
});

function WorkspacesPage() {
  const { workspaces } = Route.useLoaderData();
  const now = Date.now();

  return (
    <section className="grid max-w-5xl gap-6">
      <PageHeader title="Workspaces">
        Every workspace, newest first, with its members and connected GitHub accounts. Members
        manage their own roles under each workspace's settings.
      </PageHeader>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr className="border-b">
              <th className="px-4 py-2 font-medium">Workspace</th>
              <th className="px-4 py-2 font-medium">GitHub</th>
              <th className="px-4 py-2 font-medium">Members</th>
              <th className="px-4 py-2 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {workspaces.map((workspace) => (
              <tr key={workspace.id} className="border-b align-top last:border-0">
                <td className="px-4 py-3">
                  <div className="font-medium">{workspace.name}</div>
                  <div className="font-mono text-xs text-muted-foreground">{workspace.slug}</div>
                </td>
                <td className="px-4 py-3">
                  {workspace.githubAccounts.length ? workspace.githubAccounts.join(", ") : "—"}
                </td>
                <td className="px-4 py-3">
                  <ul className="grid gap-1">
                    {workspace.members.map((member) => (
                      <li key={member.userId} className="flex flex-wrap items-center gap-1.5">
                        <span title={member.email}>{member.name}</span>
                        <Badge variant="idle">
                          {ROLE_LABELS[member.role as Role] ?? member.role}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </td>
                <td className="px-4 py-3 whitespace-nowrap" title={workspace.createdAt}>
                  {timeAgo(workspace.createdAt, now)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
