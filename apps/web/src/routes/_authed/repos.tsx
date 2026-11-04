import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/repos")({
  component: () => (
    <section>
      <h1>Repos</h1>
      <p className="mute">Repositories the RelayRunner GitHub App can see, and whether each workflow is opted in.</p>
    </section>
  ),
});
