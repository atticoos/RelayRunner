import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";

export const Route = createFileRoute("/_authed/routing")({
  component: () => (
    <section>
      <PageHeader title="Routing">
        Per-repo runner order: pinned, autopilot (idle laptop, then Blacksmith, then hosted), or off.
      </PageHeader>
    </section>
  ),
});
