import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createWorkspace, slugify } from "@/lib/workspace";

export const Route = createFileRoute("/_authed/workspaces/new")({
  component: NewWorkspacePage,
});

function NewWorkspacePage() {
  const { session } = Route.useRouteContext();
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    setPending(true);
    try {
      await createWorkspace(trimmed);
      // Re-run route guards so the new active workspace is loaded.
      await router.invalidate();
      await router.navigate({ to: "/settings/github" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the workspace");
      setPending(false);
    }
  }

  const slug = slugify(name);

  return (
    <main className="grid min-h-screen place-items-center p-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        <Brand />
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Create a workspace</CardTitle>
            <CardDescription>
              A workspace holds your GitHub orgs, your machines and how jobs are routed between
              them. You'll be its owner.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
              <label className="grid gap-1.5 text-sm font-medium">
                Name
                <Input
                  autoFocus
                  required
                  maxLength={80}
                  placeholder="Acme"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              {slug && <p className="font-mono text-xs text-muted-foreground">{slug}</p>}
              <Button
                type="submit"
                size="lg"
                className="w-full font-bold"
                disabled={pending || !name.trim()}
              >
                {pending ? "Creating…" : "Create workspace"}
              </Button>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </form>
          </CardContent>
        </Card>
        {session?.session.activeOrganizationId && (
          <Link to="/runners" className="text-sm text-muted-foreground hover:text-foreground">
            Back to dashboard
          </Link>
        )}
      </div>
    </main>
  );
}
