import { describe, expect, test } from 'vitest';
import { app } from './app.ts';
import type { Env } from './env.ts';

const env = {} as Env;

describe('api', () => {
  test('health responds without auth or D1', async () => {
    const response = await app.request('/api/health', {}, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

});
