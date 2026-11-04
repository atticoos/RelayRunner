import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { authDisabled, getSession, signIn } from "@/lib/auth-client";

type LoginSearch = { redirect?: string };

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  beforeLoad: async ({ search }) => {
    if (authDisabled || (await getSession())) {
      throw redirect({ to: search.redirect ?? "/activity" });
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
      callbackURL: next ?? "/activity",
    });
    if (error) setError(error.message ?? "Sign-in failed");
  }

  return (
    <main className="grid min-h-screen place-items-center p-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        <Brand />
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>Route your GitHub Actions to the right runner.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button size="lg" className="w-full font-bold" onClick={signInWithGitHub}>
              Sign in with GitHub
            </Button>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
