import { describe, expect, test } from 'vitest';
import { toWebhookMessage } from './message.ts';

describe('toWebhookMessage', () => {
  test('returns null for events RelayRunner ignores or payloads missing what it needs', () => {
    expect(toWebhookMessage('star', 'd', { action: 'created' })).toBeNull();
    expect(toWebhookMessage('workflow_job', 'd', null)).toBeNull();
    expect(toWebhookMessage('workflow_job', 'd', { action: 'queued', repository: { full_name: 'a/b' } })).toBeNull();
  });

  test('keeps only the installation repo fields', () => {
    const message = toWebhookMessage('installation_repositories', 'd', {
      action: 'added',
      installation: { id: 7 },
      repositories_added: [{ id: 1, full_name: 'acme/app', private: true, node_id: 'x' }],
      repositories_removed: [],
    }, '2026-11-04T00:00:00Z');
    expect(message).toEqual({
      deliveryId: 'd',
      action: 'added',
      installationId: 7,
      receivedAt: '2026-11-04T00:00:00Z',
      event: 'installation_repositories',
      added: [{ id: 1, fullName: 'acme/app', private: true }],
      removed: [],
    });
  });
});
