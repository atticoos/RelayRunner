import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { authDisabled, getSession, signOut } from "../lib/auth-client";

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
  { to: "/routing", label: "Routing" },
  { to: "/decisions", label: "Decision log" },
] as const;

function AuthedLayout() {
  const { user } = Route.useRouteContext();
  const router = useRouter();

  async function handleSignOut() {
    await signOut();
    await router.navigate({ to: "/login" });
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="wordmark">RelayRunner</div>
        <nav>
          {nav.map((item) => (
            <Link key={item.to} to={item.to} activeProps={{ className: "active" }}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="account">
          <span className="mute">{user?.name ?? "Dev (auth disabled)"}</span>
          {user && (
            <button type="button" onClick={handleSignOut}>
              Sign out
            </button>
          )}
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
