import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

// A `getRouter` factory is the shape TanStack Start expects in src/router.tsx,
// so moving from this SPA to Start later keeps this file as-is.
export function getRouter() {
  return createRouter({
    routeTree,
    defaultPreload: "intent",
    scrollRestoration: true,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
