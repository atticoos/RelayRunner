import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// Better Auth lives in the apps/api Worker, mounted at /api/auth on the same
// origin as the dashboard, so session cookies need no CORS setup.
export const authClient = createAuthClient({
  basePath: "/api/auth",
  // Workspaces are Better Auth organizations (see apps/api/src/auth.ts).
  plugins: [organizationClient()],
});

export const { useSession, signIn, signOut, organization, useListOrganizations } = authClient;

export type Session = typeof authClient.$Infer.Session;

/** Dev-only escape hatch so pages render before the API exists. */
export const authDisabled = import.meta.env.DEV && import.meta.env.VITE_AUTH_DISABLED === "true";

/** Resolves the current session for route guards; null when signed out. */
export async function getSession(): Promise<Session | null> {
  try {
    const { data } = await authClient.getSession();
    return data ?? null;
  } catch {
    return null;
  }
}
