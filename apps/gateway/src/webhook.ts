interface WorkflowJobEvent {
  action?: string;
  repository?: { full_name?: string };
  workflow_job?: { id: number; labels: string[] };
}

export function constantTimeEqual(left: string, right: string) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  return a.reduce((difference, byte, index) => difference | (byte ^ b[index]), 0) === 0;
}

export async function validSignature(secret: string, body: string, signature: string | null) {
  if (!signature) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(body)));
  const expected = `sha256=${[...digest].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
  return constantTimeEqual(expected, signature);
}

// GitHub sends this event for every job, so keep only queued jobs on the gateway's own label.
export function queuedJobId(event: WorkflowJobEvent, repository: string, label: string) {
  const job = event.workflow_job;
  if (event.action !== 'queued' || event.repository?.full_name !== repository || !job?.labels.includes(label)) return null;
  return job.id;
}
