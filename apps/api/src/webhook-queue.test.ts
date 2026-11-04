import { describe, expect, test, vi } from 'vitest';
import { WEBHOOK_DLQ, WEBHOOK_QUEUE, type WebhookMessage } from '@relayrunner/github-webhooks';
import type { Env } from './env.ts';
import * as consumer from './webhook-queue.ts';

const env = {} as Env;

function message(body: WebhookMessage, attempts = 1) {
  return { body, attempts, ack: vi.fn(), retry: vi.fn() };
}

function batch(queue: string, messages: ReturnType<typeof message>[]) {
  return { queue, messages } as unknown as MessageBatch<WebhookMessage>;
}

const installation: WebhookMessage = { event: 'installation', deliveryId: 'd-1', action: 'created', installationId: 7, receivedAt: new Date().toISOString(), repositories: [] };
const malformed = { ...installation, event: 'workflow_job', deliveryId: 'd-2' } as unknown as WebhookMessage; // no repository/job

describe('webhook queue consumer', () => {
  test('acks a processed message', async () => {
    const msg = message(installation);
    await consumer.handleWebhookBatch(batch(WEBHOOK_QUEUE, [msg]), env);
    expect(msg.ack).toHaveBeenCalledOnce();
    expect(msg.retry).not.toHaveBeenCalled();
  });

  test('retries only the failing message, with backoff', async () => {
    const good = message(installation);
    const bad = message(malformed, 3);
    await consumer.handleWebhookBatch(batch(WEBHOOK_QUEUE, [bad, good]), env);
    expect(bad.retry).toHaveBeenCalledWith({ delaySeconds: 120 });
    expect(bad.ack).not.toHaveBeenCalled();
    expect(good.ack).toHaveBeenCalledOnce();
  });

  test('logs and acks dead letters without processing them', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const msg = message(malformed, 7);
    await consumer.handleWebhookBatch(batch(WEBHOOK_DLQ, [msg]), env);
    expect(msg.ack).toHaveBeenCalledOnce();
    expect(msg.retry).not.toHaveBeenCalled();
    expect(JSON.parse(error.mock.calls[0][0])).toMatchObject({ msg: 'github webhook dead-lettered', deliveryId: 'd-2' });
    error.mockRestore();
  });

  test('backs off from 30 seconds up to 15 minutes', () => {
    expect([1, 2, 3, 6, 10].map(consumer.retryDelaySeconds)).toEqual([30, 60, 120, 900, 900]);
  });
});
