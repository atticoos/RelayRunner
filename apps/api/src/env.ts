import type { MachineLink } from "./durable-objects/machine-link.ts";
import type { PickRunner } from "./durable-objects/pick-runner.ts";
import type { Router } from "./durable-objects/router.ts";

// Bindings from wrangler.jsonc, plus secrets set with `wrangler secret put` (or .dev.vars locally).
export interface Env {
  DB: D1Database;
  PICK_RUNNER: DurableObjectNamespace<PickRunner>;
  ROUTER: DurableObjectNamespace<Router>;
  MACHINE_LINK: DurableObjectNamespace<MachineLink>;

  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  // Comma-separated origin patterns of dashboard previews allowed to sign in (see auth.ts).
  PREVIEW_ORIGINS?: string;
  // The RelayRunner GitHub App's OAuth credentials, used as Better Auth's GitHub provider.
  GITHUB_APP_CLIENT_ID: string;
  GITHUB_APP_CLIENT_SECRET: string;
  // The App's URL slug (github.com/apps/<slug>), for the "Connect GitHub org" install link.
  GITHUB_APP_SLUG: string;
  // The App's numeric ID and its private key (PKCS#8 PEM, from the Secrets Store). Together they
  // sign the App JWTs that mint installation tokens. Nothing reads them yet.
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: SecretsStoreSecret;
}
