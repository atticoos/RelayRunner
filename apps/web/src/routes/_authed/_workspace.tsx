import { Link, Outlet, createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { authDisabled, signOut } from "@/lib/auth-client";
import { ensureActiveWorkspace, getCurrentWorkspace, type CurrentWorkspace } from "@/lib/workspace";

const devWorkspace: CurrentWorkspace = {
  workspace: {
    id: "dev",
    name: "Dev workspace",
    slug: "dev",
    createdAt: new Date(0).toISOString(),
  },
  role: "owner",
  installations: [],
};

// Pathless layout for pages that act on a workspace. Sends users without one
// to create it, and puts the active workspace in route context.
export const Route = createFileRoute("/_authed/_workspace")({
  beforeLoad: async ({ context }) => {
    if (authDisabled || !context.session) return { current: devWorkspace };
    if (!(await ensureActiveWorkspace(context.session))) {
      throw redirect({ to: "/workspaces/new" });
    }
    try {
      return { current: await getCurrentWorkspace() };
    } catch {
      // The active workspace is gone or no longer ours.
      throw redirect({ to: "/workspaces/new" });
    }
  },
  component: WorkspaceLayout,
});

const nav = [
  { to: "/runners", label: "Runners" },
  { to: "/workspace", label: "Workspace" },
] as const;

function WorkspaceLayout() {
  const { user, current } = Route.useRouteContext();
  const router = useRouter();

  async function handleSignOut() {
    await signOut();
    await router.navigate({ to: "/login" });
  }

  return (
    <div className="grid min-h-screen grid-cols-1 grid-rows-[auto_1fr] sm:grid-cols-[220px_1fr] sm:grid-rows-1">
      <aside className="flex flex-col gap-3 border-b border-sidebar-border bg-sidebar px-4 py-5 sm:gap-6 sm:border-r sm:border-b-0">
        <div className="grid gap-1 px-2.5">
          <Brand />
          <Link
            to="/workspace"
            className="truncate text-sm text-muted-foreground hover:text-foreground"
          >
            {current.workspace.name}
          </Link>
        </div>
        <nav className="flex flex-row flex-wrap gap-0.5 sm:flex-col">
          {nav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="rounded-md px-2.5 py-1.5 text-[15px] text-sidebar-foreground transition-colors hover:text-sidebar-accent-foreground"
              activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground" }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex flex-row items-center gap-2 px-2.5 sm:mt-auto sm:flex-col sm:items-start">
          <span className="text-sm text-muted-foreground">
            {user?.name ?? "Dev (auth disabled)"}
          </span>
          {user && (
            <Button variant="outline" size="sm" onClick={handleSignOut}>
              Sign out
            </Button>
          )}
        </div>
      </aside>
      <main className="p-4 sm:p-8">
        <Outlet />
      </main>
    </div>
  );
}
