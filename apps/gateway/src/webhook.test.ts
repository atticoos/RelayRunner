import { createHmac } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { constantTimeEqual, queuedJobId, validSignature } from './webhook.ts';

const sign = (secret: string, body: string) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

describe('validSignature', () => {
  test('accepts GitHub signatures', async () => {
    await expect(validSignature('secret', '{"a":1}', sign('secret', '{"a":1}'))).resolves.toBe(true);
  });

  test('rejects missing, altered, and wrongly signed bodies', async () => {
    await expect(validSignature('secret', '{}', null)).resolves.toBe(false);
    await expect(validSignature('secret', '{"a":2}', sign('secret', '{"a":1}'))).resolves.toBe(false);
    await expect(validSignature('secret', '{}', sign('other', '{}'))).resolves.toBe(false);
  });
});

test('constantTimeEqual compares length and content', () => {
  expect(constantTimeEqual('abc', 'abc')).toBe(true);
  expect(constantTimeEqual('abc', 'abd')).toBe(false);
  expect(constantTimeEqual('abc', 'abcd')).toBe(false);
});

describe('queuedJobId', () => {
  const event = {
    action: 'queued',
    repository: { full_name: 'owner/repo' },
    workflow_job: { id: 7, labels: ['relayrunner'] },
  };

  test('returns queued jobs on the gateway label', () => {
    expect(queuedJobId(event, 'owner/repo', 'relayrunner')).toBe(7);
  });

  test('ignores other actions, repositories, and labels', () => {
    expect(queuedJobId({ ...event, action: 'completed' }, 'owner/repo', 'relayrunner')).toBeNull();
    expect(queuedJobId(event, 'owner/other', 'relayrunner')).toBeNull();
    expect(queuedJobId({ ...event, workflow_job: { id: 7, labels: ['ubuntu-latest'] } }, 'owner/repo', 'relayrunner')).toBeNull();
  });
});
