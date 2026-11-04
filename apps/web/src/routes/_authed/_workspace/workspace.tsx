import { createFileRoute, redirect } from "@tanstack/react-router";

// The Workspace page moved into Settings. This keeps old links and the API's
// /workspace?github=… redirects from older deploys working, notices included.
// TODO(#94): remove once nothing points here any more.
export const Route = createFileRoute("/_authed/_workspace/workspace")({
  validateSearch: (search: Record<string, unknown>): { github?: string } => ({
    github: typeof search.github === "string" ? search.github : undefined,
  }),
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/settings/github",
      // settings/github validates the value and drops anything it doesn't know.
      search: search.github ? ({ github: search.github } as never) : {},
      replace: true,
    });
  },
});
