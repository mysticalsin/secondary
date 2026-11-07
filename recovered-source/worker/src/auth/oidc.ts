// Microsoft Entra ID OpenID Connect: authorization code flow with PKCE, a confidential client.
// Discovery comes from the configured tenant only. The ID token is verified here with jose:
// signature (RS256, keys from the discovery jwks_uri), issuer, audience, expiry, tenant and nonce.

import { createRemoteJWKSet, errors, type JWTVerifyGetKey, jwtVerify } from "jose";
import { safeEqual } from "../security.ts";
import type { EntraConfig } from "./config.ts";

export const AUTHORITY_HOST = "login.microsoftonline.com";
const HTTP_TIMEOUT_MS = 10_000;
const DISCOVERY_TTL_MS = 3_600_000;

/** Test seams. Production uses global fetch and the remote JWKS. */
export interface EntraDeps {
  fetch?: typeof fetch;
  jwks?: (jwksUri: URL) => JWTVerifyGetKey;
}

export class OidcError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export type Discovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
};

export const issuerOf = (cfg: EntraConfig): string =>
  `https://${AUTHORITY_HOST}/${cfg.tenantId}/v2.0`;

const microsoftUrl = (v: unknown): v is string => {
  if (typeof v !== "string") return false;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && u.hostname === AUTHORITY_HOST;
  } catch {
    return false;
  }
};

const cache = new Map<string, { at: number; doc: Discovery }>();

export async function discover(cfg: EntraConfig, deps: EntraDeps, now: number): Promise<Discovery> {
  const cached = deps.fetch ? undefined : cache.get(cfg.tenantId);
  if (cached && now - cached.at < DISCOVERY_TTL_MS) return cached.doc;
  const f = deps.fetch ?? fetch;
  let body: Record<string, unknown>;
  try {
    const res = await f(`${issuerOf(cfg)}/.well-known/openid-configuration`, {
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!res.ok) throw new OidcError("discovery_failed");
    body = (await res.json()) as Record<string, unknown>;
  } catch (e) {
    throw e instanceof OidcError ? e : new OidcError("discovery_failed");
  }
  // The document must describe this tenant and point only at Microsoft's sign-in host.
  if (
    body.issuer !== issuerOf(cfg) ||
    !microsoftUrl(body.authorization_endpoint) ||
    !microsoftUrl(body.token_endpoint) ||
    !microsoftUrl(body.jwks_uri)
  )
    throw new OidcError("discovery_invalid");
  const doc: Discovery = {
    issuer: body.issuer,
    authorization_endpoint: body.authorization_endpoint,
    token_endpoint: body.token_endpoint,
    jwks_uri: body.jwks_uri,
  };
  if (!deps.fetch) cache.set(cfg.tenantId, { at: now, doc });
  return doc;
}

const b64url = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};

export const randomToken = (bytes = 32): string =>
  b64url(crypto.getRandomValues(new Uint8Array(bytes)));

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function pkceChallenge(verifier: string): Promise<string> {
  return b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
}

export function authorizeUrl(
  cfg: EntraConfig,
  doc: Discovery,
  p: { redirectUri: string; state: string; nonce: string; challenge: string },
): string {
  const u = new URL(doc.authorization_endpoint);
  u.search = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: "code",
    redirect_uri: p.redirectUri,
    response_mode: "query",
    scope: "openid profile email",
    state: p.state,
    nonce: p.nonce,
    code_challenge: p.challenge,
    code_challenge_method: "S256",
  }).toString();
  return u.toString();
}

/** Redeems the code. The PKCE verifier is mandatory: without it nothing is sent. */
export async function exchangeCode(
  cfg: EntraConfig,
  doc: Discovery,
  deps: EntraDeps,
  p: { code: string; verifier: string; redirectUri: string },
): Promise<string> {
  if (!p.verifier) throw new OidcError("missing_pkce_verifier");
  if (!p.code) throw new OidcError("missing_code");
  const f = deps.fetch ?? fetch;
  let res: Response;
  try {
    res = await f(doc.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        code: p.code,
        redirect_uri: p.redirectUri,
        code_verifier: p.verifier,
      }).toString(),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch {
    throw new OidcError("token_request_failed");
  }
  if (!res.ok) throw new OidcError("token_exchange_rejected");
  const body = (await res.json().catch(() => null)) as { id_token?: unknown } | null;
  if (!body || typeof body.id_token !== "string" || !body.id_token)
    throw new OidcError("no_id_token");
  return body.id_token;
}

const jwksCache = new Map<string, JWTVerifyGetKey>();
const defaultJwks = (uri: URL): JWTVerifyGetKey => {
  let k = jwksCache.get(uri.href);
  if (!k) {
    k = createRemoteJWKSet(uri, { cooldownDuration: 30_000, cacheMaxAge: 3_600_000 });
    jwksCache.set(uri.href, k);
  }
  return k;
};

export type EntraIdentity = {
  /** Directory (tenant) id, lower case. */
  tid: string;
  /** Object id of the user in that directory: immutable. With `tid` it is the only identity key. */
  oid: string;
  /**
   * A mutable attribute, never a key. The UPN (preferred_username) when the token has one, else the
   * `email` claim, which Entra does not guarantee to be verified (nOAuth).
   */
  email: string;
  /** True when `email` came from the UPN, which only a directory admin can change. */
  emailIsUpn: boolean;
  /** B2B guest: `acct` = 1 or a `#EXT#` UPN. Refused unless ENTRA_ALLOW_GUESTS is set. */
  guest: boolean;
  groups: string[];
  /** The token carried an overage marker: the groups claim was too large and is absent. */
  groupsOverage: boolean;
};

const EMAIL = /^[^\s@]+@[^\s@]+$/;
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const mail = (v: unknown): string | null => {
  const e = typeof v === "string" ? v.trim().toLowerCase() : "";
  return EMAIL.test(e) && e.length <= 254 ? e : null;
};

export async function verifyIdToken(
  idToken: string,
  cfg: EntraConfig,
  doc: Discovery,
  deps: EntraDeps,
  expectedNonce: string,
  now: number,
): Promise<EntraIdentity> {
  let payload: Record<string, unknown>;
  try {
    const key = (deps.jwks ?? defaultJwks)(new URL(doc.jwks_uri));
    ({ payload } = await jwtVerify(idToken, key, {
      issuer: issuerOf(cfg),
      audience: cfg.clientId,
      algorithms: ["RS256"],
      clockTolerance: 30,
      currentDate: new Date(now),
      requiredClaims: ["exp", "iat", "sub", "tid", "nonce"],
    }));
  } catch (e) {
    throw new OidcError(
      e instanceof errors.JWTExpired
        ? "token_expired"
        : e instanceof errors.JWTClaimValidationFailed
          ? `claim_${e.claim}`
          : "token_invalid",
    );
  }
  if (typeof payload.tid !== "string" || payload.tid.toLowerCase() !== cfg.tenantId)
    throw new OidcError("wrong_tenant");
  if (typeof payload.nonce !== "string" || !safeEqual(payload.nonce, expectedNonce))
    throw new OidcError("nonce_mismatch");
  if (payload.ver !== undefined && payload.ver !== "2.0") throw new OidcError("token_version");

  if (typeof payload.oid !== "string" || !GUID_RE.test(payload.oid)) throw new OidcError("no_oid");
  const upn = mail(payload.preferred_username);
  const email = upn ?? mail(payload.email);
  if (!email) throw new OidcError("no_email");
  const guest = String(payload.acct) === "1" || (upn?.includes("#ext#") ?? false);

  const claimNames = payload._claim_names as Record<string, unknown> | undefined;
  const groupsOverage = !!claimNames && typeof claimNames === "object" && "groups" in claimNames;
  const groups = Array.isArray(payload.groups)
    ? payload.groups.filter((g): g is string => typeof g === "string")
    : [];
  return {
    tid: (payload.tid as string).toLowerCase(),
    oid: payload.oid.toLowerCase(),
    email,
    emailIsUpn: upn !== null,
    guest,
    groups,
    groupsOverage,
  };
}
