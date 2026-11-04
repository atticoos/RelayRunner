import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/decisions")({
  component: () => (
    <section>
      <h1>Decision log</h1>
      <p className="mute">Every job the gateway routed, which runner it picked, and why.</p>
    </section>
  ),
});
