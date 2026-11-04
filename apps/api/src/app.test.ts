import { describe, expect, test } from 'vitest';
import { app } from './app.ts';
import type { Env } from './env.ts';

const secret = 'test-secret';
const env = { GITHUB_WEBHOOK_SECRET: secret } as Env;

async function sign(body: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  return `sha256=${[...digest].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function webhook(body: string, headers: Record<string, string>) {
  return app.request('/api/webhooks/github', { method: 'POST', body, headers }, env);
}

describe('api', () => {
  test('health responds without auth or D1', async () => {
    const response = await app.request('/api/health', {}, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  test('webhook rejects a missing or wrong signature', async () => {
    expect((await webhook('{}', { 'x-github-event': 'ping' })).status).toBe(401);
    expect((await webhook('{}', { 'x-github-event': 'ping', 'x-hub-signature-256': `sha256=${'0'.repeat(64)}` })).status).toBe(401);
  });

  test('webhook accepts a signed event', async () => {
    const body = JSON.stringify({ action: 'queued' });
    const response = await webhook(body, { 'x-github-event': 'workflow_job', 'x-hub-signature-256': await sign(body) });
    expect(response.status).toBe(202);
  });

  test('webhook answers ping with ok', async () => {
    const body = JSON.stringify({ zen: 'Keep it logically awesome.', hook_id: 1 });
    const response = await webhook(body, { 'x-github-event': 'ping', 'x-hub-signature-256': await sign(body) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  test('webhook fails loudly when the secret is not configured', async () => {
    const response = await app.request('/api/webhooks/github', { method: 'POST', body: '{}', headers: { 'x-github-event': 'ping' } }, {} as Env);
    expect(response.status).toBe(500);
  });
});
