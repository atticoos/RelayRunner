import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/routing")({
  component: () => (
    <section>
      <h1>Routing</h1>
      <p className="mute">Per-repo runner order: pinned, autopilot (idle laptop, then Blacksmith, then hosted), or off.</p>
    </section>
  ),
});
