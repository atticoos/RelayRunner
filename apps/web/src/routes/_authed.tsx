import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { authDisabled, getSession, signOut } from "@/lib/auth-client";

// Pathless layout: every route under routes/_authed/ requires a session.
export const Route = createFileRoute("/_authed")({
  beforeLoad: async ({ location }) => {
    if (authDisabled) return { user: null };
    const session = await getSession();
    if (!session) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
    return { user: session.user };
  },
  component: AuthedLayout,
});

const nav = [
  { to: "/repos", label: "Repos" },
  { to: "/runners", label: "Runners" },
] as const;

function AuthedLayout() {
  const { user } = Route.useRouteContext();
  const router = useRouter();

  async function handleSignOut() {
    await signOut();
    await router.navigate({ to: "/login" });
  }

  return (
    <div className="grid min-h-screen grid-cols-1 sm:grid-cols-[220px_1fr]">
      <aside className="flex flex-col gap-3 border-b border-sidebar-border bg-sidebar px-4 py-5 sm:gap-6 sm:border-r sm:border-b-0">
        <Brand className="px-2.5" />
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
          <span className="text-sm text-muted-foreground">{user?.name ?? "Dev (auth disabled)"}</span>
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
