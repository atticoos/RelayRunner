// Talking to GitHub as the RelayRunner App: App JWTs, installation tokens, and one-job (JIT) runner
// configs. Signed-in-user calls live in github.ts.

const API = "https://api.github.com";

const headers = (token: string) => ({
  accept: "application/vnd.github+json",
  authorization: `Bearer ${token}`,
  "user-agent": "relayrunner-gateway",
  "x-github-api-version": "2022-11-28",
});

// The org's "Default" runner group. GitHub always gives it id 1.
export const DEFAULT_RUNNER_GROUP_ID = 1;

/**
 * Import the App's private key for RS256. Accepts PKCS#8 (`BEGIN PRIVATE KEY`) or GitHub's own
 * PKCS#1 download (`BEGIN RSA PRIVATE KEY`), with or without its line breaks, since a key pasted
 * into the Secrets Store dashboard can come through either way.
 */
export async function importAppPrivateKey(pem: string): Promise<CryptoKey> {
  const pkcs1 = /BEGIN RSA PRIVATE KEY/.test(pem);
  const body = pem.replace(/-----(BEGIN|END)[A-Z ]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (character) => character.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    pkcs1 ? pkcs1ToPkcs8(der) : der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

// PrivateKeyInfo ::= SEQUENCE { version 0, AlgorithmIdentifier rsaEncryption, OCTET STRING pkcs1 }
function pkcs1ToPkcs8(pkcs1: Uint8Array) {
  const version = [0x02, 0x01, 0x00];
  const rsaEncryption = [
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
  ];
  const key = der(0x04, pkcs1);
  return der(0x30, new Uint8Array([...version, ...rsaEncryption, ...key]));
}

function der(tag: number, content: Uint8Array) {
  const length =
    content.length < 0x80
      ? [content.length]
      : (() => {
          const bytes: number[] = [];
          for (let n = content.length; n > 0; n >>= 8) bytes.unshift(n & 0xff);
          return [0x80 | bytes.length, ...bytes];
        })();
  return new Uint8Array([tag, ...length, ...content]);
}

const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const jsonBase64Url = (value: unknown) =>
  base64Url(new TextEncoder().encode(JSON.stringify(value)));

/** A short-lived JWT that authenticates as the App itself. */
export async function appJwt(appId: string, key: CryptoKey, now = Date.now()) {
  // Backdated a minute for clock drift; GitHub caps the lifetime at 10 minutes.
  const issuedAt = Math.floor(now / 1000) - 60;
  const unsigned = `${jsonBase64Url({ alg: "RS256", typ: "JWT" })}.${jsonBase64Url({ iat: issuedAt, exp: issuedAt + 540, iss: appId })}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${base64Url(new Uint8Array(signature))}`;
}

export async function installationToken(jwt: string, installationId: number): Promise<string> {
  const response = await fetch(`${API}/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: headers(jwt),
  });
  if (!response.ok)
    throw new Error(
      `POST /app/installations/${installationId}/access_tokens failed with ${response.status}: ${(await response.text()).slice(0, 300)}`,
    );
  return ((await response.json()) as { token: string }).token;
}

/** Register a one-job runner in an org and return its id and encoded config. */
export async function generateOrgJitConfig(
  token: string,
  org: string,
  runner: { name: string; labels: string[]; runnerGroupId: number },
) {
  const response = await fetch(`${API}/orgs/${org}/actions/runners/generate-jitconfig`, {
    method: "POST",
    headers: { ...headers(token), "content-type": "application/json" },
    body: JSON.stringify({
      name: runner.name,
      labels: runner.labels,
      runner_group_id: runner.runnerGroupId,
      work_folder: "_work",
    }),
  });
  if (!response.ok)
    throw new Error(
      `POST /orgs/${org}/actions/runners/generate-jitconfig failed with ${response.status}: ${(await response.text()).slice(0, 300)}`,
    );
  const body = (await response.json()) as { runner: { id: number }; encoded_jit_config: string };
  return { runnerId: body.runner.id, encodedJitConfig: body.encoded_jit_config };
}

/** Remove a runner that never got a job. A JIT runner that ran one removes itself. */
export async function deleteOrgRunner(token: string, org: string, runnerId: number) {
  const response = await fetch(`${API}/orgs/${org}/actions/runners/${runnerId}`, {
    method: "DELETE",
    headers: headers(token),
  });
  if (!response.ok && response.status !== 404)
    throw new Error(
      `DELETE /orgs/${org}/actions/runners/${runnerId} failed with ${response.status}`,
    );
}
