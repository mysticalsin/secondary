// Cloudflare Access in front of the ops admin surface (M-02). The ops worker verifies the Access JWT
// itself with WebCrypto (RS256, issuer, audience, expiry), in addition to the static X-Ops-Key, so a
// leaked key alone is not enough. Dev stays key-only; staging and prod need Access.

const TEAM = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const CERTS_TTL_MS = 3_600_000;

type Jwk = JsonWebKey & { kid?: string };
export type CertsFetcher = (team: string) => Promise<{ keys: Jwk[] }>;

const fetchCerts: CertsFetcher = async (team) => {
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error("certs");
  return (await res.json()) as { keys: Jwk[] };
};

const cache = new Map<string, { at: number; keys: Jwk[] }>();

function b64urlBytes(t: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(t)) return null;
  try {
    const bin = atob(t.replaceAll("-", "+").replaceAll("_", "/"));
    const out = new Uint8Array(new ArrayBuffer(bin.length));
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

const json = (t: string): Record<string, unknown> | null => {
  const b = b64urlBytes(t);
  if (!b) return null;
  try {
    const v = JSON.parse(new TextDecoder().decode(b)) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/** Whether Access is configured for this environment (both values set and well formed). */
export const accessConfigured = (env: { ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string }) =>
  TEAM.test((env.ACCESS_TEAM_DOMAIN ?? "").trim().toLowerCase()) && !!env.ACCESS_AUD?.trim();

/** True only for a valid Access JWT for this team and application. Every other case is false. */
export async function verifyAccess(
  token: string | undefined | null,
  env: { ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string },
  certs: CertsFetcher = fetchCerts,
  now = Date.now(),
): Promise<boolean> {
  if (!token || !accessConfigured(env)) return false;
  const team = (env.ACCESS_TEAM_DOMAIN as string).trim().toLowerCase();
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [h, p, sig] = parts as [string, string, string];
  const header = json(h);
  const claims = json(p);
  const sigBytes = b64urlBytes(sig);
  if (!header || !claims || !sigBytes || header.alg !== "RS256" || typeof header.kid !== "string")
    return false;
  try {
    let entry = cache.get(team);
    if (!entry || now - entry.at > CERTS_TTL_MS || !entry.keys.some((k) => k.kid === header.kid)) {
      entry = { at: now, keys: (await certs(team)).keys };
      cache.set(team, entry);
    }
    const jwk = entry.keys.find((k) => k.kid === header.kid);
    if (!jwk) return false;
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      sigBytes,
      new TextEncoder().encode(`${h}.${p}`),
    );
    if (!ok) return false;
  } catch {
    return false;
  }
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const s = now / 1000;
  return (
    claims.iss === `https://${team}` &&
    aud.includes((env.ACCESS_AUD as string).trim()) &&
    typeof claims.exp === "number" &&
    claims.exp + 30 > s &&
    (claims.nbf === undefined || (typeof claims.nbf === "number" && claims.nbf - 30 <= s))
  );
}
