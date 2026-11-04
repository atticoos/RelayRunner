import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";

export const Route = createFileRoute("/_authed/decisions")({
  component: () => (
    <section>
      <PageHeader title="Decision log">
        Every job the gateway routed, which runner it picked, and why.
      </PageHeader>
    </section>
  ),
});
