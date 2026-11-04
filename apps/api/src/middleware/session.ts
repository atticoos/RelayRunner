import { createMiddleware } from 'hono/factory';
import { createAuth } from '../auth.ts';
import type { AppEnv } from '../app.ts';

// Builds this request's auth instance and attaches the signed-in user and session, or null.
export const attachSession = createMiddleware<AppEnv>(async (c, next) => {
  const auth = createAuth(c.env);
  const result = await auth.api.getSession({ headers: c.req.raw.headers });
  c.set('auth', auth);
  c.set('user', result?.user ?? null);
  c.set('session', result?.session ?? null);
  await next();
});

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.var.user) return c.json({ error: 'unauthorized' }, 401);
  await next();
});
