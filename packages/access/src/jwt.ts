// Verifies the JWT that Cloudflare Access adds to every request it lets through
// (Cf-Access-Jwt-Assertion). Access already blocks unauthenticated requests at the edge; checking
// the token in the Worker as well means a route stays closed if the Access app is removed or
// misconfigured, and tells the Worker who the caller is (a person or a service token).
// Uses WebCrypto so it runs in Workers and in Node tests.
// https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/

export const ACCESS_JWT_HEADER = "Cf-Access-Jwt-Assertion";

export interface AccessEnv {
  // The Zero Trust team domain, e.g. relayrunner.cloudflareaccess.com.
  ACCESS_TEAM_DOMAIN?: string;
  // Comma-separated Application Audience (AUD) tags of the Access apps allowed to reach this
  // Worker. Each Access app has its own tag (Zero Trust > Access > Applications > the app).
  ACCESS_AUD?: string;
}

export interface AccessConfig {
  issuer: string;
  audiences: string[];
}

export type AccessIdentity =
  | { kind: "user"; email: string; sub: string }
  // A service token's JWT carries its Client ID as common_name and no email.
  | { kind: "service"; clientId: string };

export type AccessResult = { ok: true; identity: AccessIdentity } | { ok: false; reason: string };

interface Jwk extends JsonWebKey {
  kid?: string;
}

type CertsFetcher = (url: string) => Promise<{ keys: Jwk[] }>;

// Clock skew allowed on exp and nbf, in seconds.
const LEEWAY = 60;
// How long a fetched key set is reused before it is fetched again. An unknown kid refetches early,
// so key rotation never waits for this.
const CERTS_TTL_MS = 10 * 60 * 1000;

// Returns null when Access isn't configured, so callers can fail closed.
export function accessConfig(env: AccessEnv): AccessConfig | null {
  const domain = env.ACCESS_TEAM_DOMAIN?.trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  const audiences = (env.ACCESS_AUD ?? "")
    .split(",")
    .map((aud) => aud.trim())
    .filter(Boolean);
  if (!domain || audiences.length === 0) return null;
  return { issuer: `https://${domain}`, audiences };
}

export function verifyAccessRequest(
  request: Request,
  config: AccessConfig,
  options?: VerifyOptions,
): Promise<AccessResult> {
  const token = request.headers.get(ACCESS_JWT_HEADER);
  if (!token) return Promise.resolve({ ok: false, reason: "missing_token" });
  return verifyAccessJwt(token, config, options);
}

export interface VerifyOptions {
  fetchCerts?: CertsFetcher;
  now?: () => number;
}

export async function verifyAccessJwt(
  token: string,
  config: AccessConfig,
  { fetchCerts = defaultFetchCerts, now = Date.now }: VerifyOptions = {},
): Promise<AccessResult> {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed_token" };
  const [rawHeader, rawPayload, rawSignature] = parts as [string, string, string];

  let header: { alg?: string; kid?: string };
  let payload: Record<string, unknown>;
  let signature: Uint8Array<ArrayBuffer>;
  try {
    header = JSON.parse(decodeText(rawHeader));
    payload = JSON.parse(decodeText(rawPayload));
    signature = base64UrlDecode(rawSignature);
  } catch {
    return { ok: false, reason: "malformed_token" };
  }
  if (header.alg !== "RS256" || !header.kid) return { ok: false, reason: "unsupported_alg" };

  let jwk: Jwk | null;
  try {
    jwk = await findKey(config.issuer, header.kid, fetchCerts);
  } catch {
    return { ok: false, reason: "certs_unavailable" };
  }
  if (!jwk) return { ok: false, reason: "unknown_key" };
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signed = new TextEncoder().encode(`${rawHeader}.${rawPayload}`);
  if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signed))) {
    return { ok: false, reason: "bad_signature" };
  }

  if (payload.iss !== config.issuer) return { ok: false, reason: "wrong_issuer" };
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.some((value) => config.audiences.includes(value as string))) {
    return { ok: false, reason: "wrong_audience" };
  }
  const seconds = now() / 1000;
  if (typeof payload.exp !== "number" || payload.exp + LEEWAY < seconds) {
    return { ok: false, reason: "expired" };
  }
  if (typeof payload.nbf === "number" && payload.nbf - LEEWAY > seconds) {
    return { ok: false, reason: "not_yet_valid" };
  }

  if (typeof payload.email === "string" && payload.email) {
    return {
      ok: true,
      identity: { kind: "user", email: payload.email, sub: String(payload.sub ?? "") },
    };
  }
  if (typeof payload.common_name === "string" && payload.common_name) {
    return { ok: true, identity: { kind: "service", clientId: payload.common_name } };
  }
  return { ok: false, reason: "no_identity" };
}

// Per-isolate key cache, keyed by issuer.
const certsCache = new Map<string, { keys: Jwk[]; fetchedAt: number }>();

async function findKey(issuer: string, kid: string, fetchCerts: CertsFetcher) {
  const cached = certsCache.get(issuer);
  const fresh = cached && Date.now() - cached.fetchedAt < CERTS_TTL_MS;
  const hit = fresh ? cached.keys.find((key) => key.kid === kid) : undefined;
  if (hit) return hit;
  const { keys } = await fetchCerts(`${issuer}/cdn-cgi/access/certs`);
  certsCache.set(issuer, { keys, fetchedAt: Date.now() });
  return keys.find((key) => key.kid === kid) ?? null;
}

async function defaultFetchCerts(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Access certs fetch failed: ${response.status}`);
  return (await response.json()) as { keys: Jwk[] };
}

// Test hook: forget fetched keys.
export function clearAccessCertsCache() {
  certsCache.clear();
}

function base64UrlDecode(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function decodeText(value: string) {
  return new TextDecoder().decode(base64UrlDecode(value));
}
