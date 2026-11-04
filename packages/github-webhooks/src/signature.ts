// Verifies GitHub's X-Hub-Signature-256 header: an HMAC-SHA256 of the raw body with the webhook
// secret. Uses WebCrypto so it runs in Workers and in Node tests.
export async function verifyGitHubSignature(secret: string, body: string, signature: string | null) {
  if (!secret || !signature?.startsWith('sha256=')) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const digest = hexToBytes(signature.slice('sha256='.length));
  if (!digest) return false;
  return crypto.subtle.verify('HMAC', key, digest, encoder.encode(body));
}

function hexToBytes(hex: string) {
  if (hex.length !== 64 || !/^[0-9a-f]+$/i.test(hex)) return null;
  return Uint8Array.from(hex.match(/../g)!, byte => Number.parseInt(byte, 16));
}
