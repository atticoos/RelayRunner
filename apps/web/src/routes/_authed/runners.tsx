import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/runners")({
  component: () => (
    <section>
      <h1>Runners</h1>
      <p className="mute">Your machines (online or offline) plus GitHub-hosted and Blacksmith runners. Live status will stream over a WebSocket.</p>
    </section>
  ),
});
