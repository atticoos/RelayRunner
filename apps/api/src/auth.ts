import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createDb, schema } from './db/index.ts';
import type { Env } from './env.ts';

// Workers only expose bindings per request, so build the auth instance per request too. It is
// cheap: no I/O happens until a handler runs.
export function createAuth(env: Env) {
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(createDb(env.DB), { provider: 'sqlite', schema }),
    socialProviders: {
      github: {
        clientId: env.GITHUB_APP_CLIENT_ID,
        clientSecret: env.GITHUB_APP_CLIENT_SECRET,
      },
    },
    session: {
      // Keep a signed copy of the session in a cookie so most getSession calls skip D1.
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    plugins: [
      // Next: deviceAuthorization() for `relayrunner login` and bearer() for per-machine
      // credentials, both from better-auth/plugins. Each adds tables, so regenerate migrations.
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth['$Infer']['Session'];
