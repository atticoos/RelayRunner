import { api } from "@/lib/api";

/**
 * Whether the signed-in user is a RelayRunner operator (GET /api/me), who sees the sidebar's Admin
 * section. Never throws: a failed check just hides the section.
 */
export async function getIsOperator() {
  try {
    return (await api<{ operator: boolean }>("/me")).operator;
  } catch {
    return false;
  }
}
