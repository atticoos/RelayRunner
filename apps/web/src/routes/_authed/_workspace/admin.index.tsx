import { createFileRoute, redirect } from "@tanstack/react-router";

// Webhooks is the only admin page so far.
export const Route = createFileRoute("/_authed/_workspace/admin/")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/webhooks" });
  },
});
