import { Outlet, createRootRoute } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: () => <Outlet />,
  notFoundComponent: () => (
    <main className="grid min-h-screen place-content-center gap-2 p-4 text-center">
      <h1 className="text-2xl font-bold tracking-tight">Not found</h1>
      <p className="text-muted-foreground">That page doesn't exist.</p>
    </main>
  ),
});
