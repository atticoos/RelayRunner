import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { authDisabled, getSession } from "@/lib/auth-client";

// Pathless layout: every route under routes/_authed/ requires a session.
// routes/_authed/_workspace/ additionally requires an active workspace.
export const Route = createFileRoute("/_authed")({
  beforeLoad: async ({ location }) => {
    if (authDisabled) return { user: null, session: null };
    const session = await getSession();
    if (!session) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
    return { user: session.user, session };
  },
  component: Outlet,
});
