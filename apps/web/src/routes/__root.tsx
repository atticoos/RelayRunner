import { Outlet, createRootRoute } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: () => <Outlet />,
  notFoundComponent: () => (
    <main className="center">
      <h1>Not found</h1>
      <p className="mute">That page doesn't exist.</p>
    </main>
  ),
});
