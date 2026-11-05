import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createWorkspace, slugify } from "@/lib/workspace";

/**
 * Names and creates a workspace owned by the signed-in user, which becomes the active one.
 * Used on /workspaces/new and inline in the /device onboarding steps.
 */
export function CreateWorkspaceForm({ onCreated }: { onCreated: () => Promise<void> }) {
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
      await onCreated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the workspace");
      setPending(false);
    }
  }

  const slug = slugify(name);

  return (
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
  );
}
