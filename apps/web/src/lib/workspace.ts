import { api } from "@/lib/api";
import { organization, type Session } from "@/lib/auth-client";

/** GET /api/workspaces/current: the active workspace as the gateway sees it. */
export type CurrentWorkspace = {
  workspace: { id: string; name: string; slug: string; createdAt: string };
  role: string;
  installations: { id: number; accountLogin: string; accountType: string; suspendedAt: string | null }[];
};

export function getCurrentWorkspace() {
  return api<CurrentWorkspace>("/workspaces/current");
}

/**
 * Makes sure the session has an active workspace, picking the user's first one
 * if none is set. Returns null when the user has no workspace yet.
 */
export async function ensureActiveWorkspace(session: Session): Promise<string | null> {
  if (session.session.activeOrganizationId) return session.session.activeOrganizationId;
  const { data: workspaces } = await organization.list();
  const first = workspaces?.[0];
  if (!first) return null;
  await organization.setActive({ organizationId: first.id });
  return first.id;
}

/** "Acme Labs!" -> "acme-labs" */
export function slugify(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * Creates a workspace owned by the signed-in user and makes it active. The
 * slug comes from the name, with a short suffix if it is taken.
 */
export async function createWorkspace(name: string) {
  const base = slugify(name) || "workspace";
  for (const slug of [base, `${base}-${randomSuffix()}`, `${base}-${randomSuffix()}`]) {
    const { data, error } = await organization.create({ name, slug });
    if (data) {
      // create updates the session row but not Better Auth's cached session
      // cookie; setActive refreshes the cookie too.
      await organization.setActive({ organizationId: data.id });
      return data;
    }
    if (error?.code !== "ORGANIZATION_ALREADY_EXISTS") {
      throw new Error(error?.message ?? "Could not create the workspace");
    }
  }
  throw new Error("Could not find a free URL for that name. Try another name.");
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 6);
}
