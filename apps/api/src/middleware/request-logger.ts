import { withContext } from '@logtape/logtape';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../app.ts';
import { logger, setupLogging } from '../logger.ts';

const log = logger('http');

// Tags every log line written during the request with its requestId (Cloudflare's Ray ID when
// present), and writes one `http.request` line when the response is ready.
export const requestLogger = createMiddleware<AppEnv>(async (c, next) => {
  setupLogging(c.env);
  const requestId = c.req.header('cf-ray') ?? crypto.randomUUID();

  await withContext({ requestId }, async () => {
    const started = Date.now();
    await next();

    const status = c.res.status;
    const fields = {
      method: c.req.method,
      route: c.req.routePath,
      path: c.req.path,
      status,
      durationMs: Date.now() - started,
      userId: c.get('user')?.id,
    };
    if (status >= 500) log.error('http.request', fields);
    else log.info('http.request', fields);
  });
});
