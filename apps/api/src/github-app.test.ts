import { generateKeyPairSync, createPublicKey, verify } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { appJwt, importAppPrivateKey } from './github-app.ts';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pkcs1 = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
const pkcs8 = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicKey = createPublicKey(privateKey);

function verifies(jwt: string) {
  const [header, payload, signature] = jwt.split('.');
  return verify('sha256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url'));
}

describe('GitHub App auth', () => {
  test.each([
    ['PKCS#8', pkcs8],
    ['PKCS#1 (GitHub download)', pkcs1],
    ['PKCS#1 pasted without line breaks', pkcs1.replace(/\n/g, ' ')],
    ['PKCS#8 pasted without line breaks', pkcs8.replace(/\n/g, '')],
  ])('signs a verifiable App JWT from a %s key', async (_name, pem) => {
    const jwt = await appJwt('5605512', await importAppPrivateKey(pem), Date.UTC(2026, 10, 4));
    expect(verifies(jwt)).toBe(true);
    const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
    expect(claims).toEqual({ iss: '5605512', iat: Date.UTC(2026, 10, 4) / 1000 - 60, exp: Date.UTC(2026, 10, 4) / 1000 + 480 });
  });
});
