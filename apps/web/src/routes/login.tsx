import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { authDisabled, getSession, signIn } from "../lib/auth-client";

type LoginSearch = { redirect?: string };

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  beforeLoad: async ({ search }) => {
    if (authDisabled || (await getSession())) {
      throw redirect({ to: search.redirect ?? "/repos" });
    }
  },
  component: LoginPage,
});

function LoginPage() {
  const { redirect: next } = Route.useSearch();
  const [error, setError] = useState<string | null>(null);

  async function signInWithGitHub() {
    setError(null);
    const { error } = await signIn.social({
      provider: "github",
      callbackURL: next ?? "/repos",
    });
    if (error) setError(error.message ?? "Sign-in failed");
  }

  return (
    <main className="center">
      <h1>RelayRunner</h1>
      <p className="mute">Route your GitHub Actions to the right runner.</p>
      <button type="button" className="primary" onClick={signInWithGitHub}>
        Sign in with GitHub
      </button>
      {error && <p className="error">{error}</p>}
    </main>
  );
}
