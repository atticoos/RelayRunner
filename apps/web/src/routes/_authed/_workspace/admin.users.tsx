import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { timeAgo } from "@/lib/activity";
import { listUsers, setUserRole, type AdminUser, type UserRole } from "@/lib/admin";

// Operator admin, behind Cloudflare Access and an operator session (apps/api/src/routes/admin.ts).
export const Route = createFileRoute("/_authed/_workspace/admin/users")({
  loader: () => listUsers(),
  component: UsersPage,
  errorComponent: ({ error }) => (
    <PageHeader title="Users">
      Couldn't load users: {error instanceof Error ? error.message : String(error)}
    </PageHeader>
  ),
});

// Select items need a non-empty value, so a regular user is "user" here and null in the API.
const ROLE_OPTIONS = [
  { value: "user", label: "User" },
  { value: "operator", label: "Operator" },
] as const;

function UsersPage() {
  const { user: me } = Route.useRouteContext();
  const [users, setUsers] = useState(Route.useLoaderData().users);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const now = Date.now();

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? users.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
      : users;
  }, [users, query]);

  async function changeRole(target: AdminUser, role: UserRole) {
    setNotice(null);
    try {
      await setUserRole(target.id, role);
      setUsers((all) => all.map((u) => (u.id === target.id ? { ...u, role } : u)));
      setNotice(`${target.name} is now ${role === "operator" ? "an operator" : "a regular user"}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <section className="grid max-w-5xl gap-6">
      <PageHeader title="Users">
        Everyone who has signed in. Operators see this Admin section. A role change shows up for
        them within five minutes.
      </PageHeader>

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name or email"
        aria-label="Search users"
        className="max-w-sm"
      />

      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr className="border-b">
              <th className="px-4 py-2 font-medium">User</th>
              <th className="px-4 py-2 font-medium">Workspaces</th>
              <th className="px-4 py-2 font-medium">Joined</th>
              <th className="px-4 py-2 font-medium">Role</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((u) => (
              <tr key={u.id} className="border-b last:border-0">
                <td className="px-4 py-3">
                  <div className="font-medium">{u.name}</div>
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                </td>
                <td className="px-4 py-3">{u.workspaces}</td>
                <td className="px-4 py-3 whitespace-nowrap" title={u.createdAt}>
                  {timeAgo(u.createdAt, now)}
                </td>
                <td className="px-4 py-3">
                  <Select
                    value={u.role ?? "user"}
                    // The API refuses to demote yourself, so the control doesn't offer it.
                    disabled={u.id === me?.id}
                    onValueChange={(value) =>
                      void changeRole(u, value === "operator" ? "operator" : null)
                    }
                  >
                    <SelectTrigger aria-label={`Role for ${u.name}`} className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
