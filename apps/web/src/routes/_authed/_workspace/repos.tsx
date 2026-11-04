import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";

export const Route = createFileRoute("/_authed/_workspace/repos")({
  component: () => (
    <section>
      <PageHeader title="Repos TEST">
        Repositories the RelayRunner GitHub App can see, and whether each workflow is opted in.
      </PageHeader>
    </section>
  ),
});
