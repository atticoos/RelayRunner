import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/_workspace/settings/")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/general", replace: true });
  },
});
