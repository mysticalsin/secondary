// Internal service auth: workers/mcp -> workers/api over a service binding.
//
// The MCP worker never forwards the OAuth access token it received (no token passthrough).
// It sends the API a signed principal instead. This module is shared: workers/mcp signs with
// `signInternalRequest`, workers/api verifies with `verifyInternalRequest`. It only needs WebCrypto,
// so it runs unchanged in workerd, Node and Vitest.
//
// Wire format (all three headers are required, names are lower-case, HTTP header names are case-insensitive):
//   X-Secondary-Principal  base64url(JSON InternalPrincipal)
//   X-Secondary-Timestamp  unix seconds, integer
//   X-Secondary-Signature  "v1=" + lowercase hex HMAC-SHA256(secret, signingString)
// signingString = ["v1", timestamp, METHOD, path+search, sha256hex(body), principalHeaderValue].join("\n")
// The signature binds method, path, query, body and principal, so a captured header set cannot be reused for
// another request. Timestamps older or newer than 60 s are rejected. There is no nonce: within the 60 s window
// an identical request can be replayed by someone who can already call the service binding.

export const HEADER_PRINCIPAL = "x-secondary-principal";
export const HEADER_TIMESTAMP = "x-secondary-timestamp";
export const HEADER_SIGNATURE = "x-secondary-signature";
export const SIGNATURE_VERSION = "v1";
export const MAX_SKEW_SECONDS = 60;
export const MIN_SECRET_LENGTH = 32;

export interface InternalPrincipal {
  v: 1;
  iss: "secondary-mcp";
  aud: "secondary-api";
  /** Opaque, stable user id (the Cloudflare Access `sub`). */
  sub: string;
  /** Verified Access email. The API maps it to a Principal exactly as it does for the web app. */
  email: string;
  /** Dev only: synthetic persona (role id), the MCP equivalent of `X-Demo-Persona`. The API ignores it unless ENVIRONMENT=dev. */
  persona?: string;
  /** OAuth client id of the host (Claude, ChatGPT, Dust, ...). */
  client_id: string;
  /** OAuth scopes on the access token. The API must refuse writes the scopes do not cover. */
  scope: string[];
  /** MCP tool that caused the call, for the API's audit receipt. */
  tool: string;
}

export type InternalAuthFailure =
  | "no_secret"
  | "missing_headers"
  | "bad_version"
  | "bad_timestamp"
  | "stale_timestamp"
  | "bad_signature"
  | "bad_principal";

export type InternalAuthResult =
  | { ok: true; principal: InternalPrincipal }
  | { ok: false; reason: InternalAuthFailure };

const enc = new TextEncoder();
const utf8 = (s: string) => enc.encode(s) as Uint8Array<ArrayBuffer>;
const dec = new TextDecoder();

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/.test(hex)) return null;
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function base64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function base64urlDecode(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const bin = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
    const out = new Uint8Array(new ArrayBuffer(bin.length));
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function sha256Hex(data: Uint8Array<ArrayBuffer>): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", data)));
}

async function hmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", utf8(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    usage,
  ]);
}

function pathAndQuery(url: string): string {
  const u = new URL(url);
  return `${u.pathname}${u.search}`;
}

async function signingString(
  timestamp: string,
  method: string,
  url: string,
  body: Uint8Array<ArrayBuffer>,
  principalHeader: string,
): Promise<string> {
  return [
    SIGNATURE_VERSION,
    timestamp,
    method.toUpperCase(),
    pathAndQuery(url),
    await sha256Hex(body),
    principalHeader,
  ].join("\n");
}

export interface SignInput {
  secret: string;
  method: string;
  url: string;
  /** Exact request body bytes as sent. Omit for GET. */
  body?: string;
  principal: InternalPrincipal;
  /** Unix seconds. Defaults to now. */
  now?: number;
}

/** Returns the three headers to add to a service-binding request. Throws if the secret is too short. */
export async function signInternalRequest(input: SignInput): Promise<Record<string, string>> {
  if (input.secret.length < MIN_SECRET_LENGTH) throw new Error("INTERNAL_HMAC_KEY too short");
  const timestamp = String(Math.floor(input.now ?? Date.now() / 1000));
  const principalHeader = base64urlEncode(enc.encode(JSON.stringify(input.principal)));
  const body = utf8(input.body ?? "");
  const data = await signingString(timestamp, input.method, input.url, body, principalHeader);
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", await hmacKey(input.secret, "sign"), utf8(data)),
  );
  return {
    [HEADER_PRINCIPAL]: principalHeader,
    [HEADER_TIMESTAMP]: timestamp,
    [HEADER_SIGNATURE]: `${SIGNATURE_VERSION}=${toHex(sig)}`,
  };
}

export interface VerifyOptions {
  /** Unix seconds. Defaults to now. */
  now?: number;
  maxSkewSeconds?: number;
}

function isPrincipal(p: unknown): p is InternalPrincipal {
  if (typeof p !== "object" || p === null) return false;
  const o = p as Record<string, unknown>;
  const str = (v: unknown) => typeof v === "string" && v.length > 0 && v.length <= 320;
  return (
    o.v === 1 &&
    o.iss === "secondary-mcp" &&
    o.aud === "secondary-api" &&
    str(o.sub) &&
    str(o.email) &&
    str(o.client_id) &&
    str(o.tool) &&
    (o.persona === undefined || str(o.persona)) &&
    Array.isArray(o.scope) &&
    o.scope.every((s) => typeof s === "string")
  );
}

/**
 * Verify a request signed by `signInternalRequest`. Fail closed: any problem returns `{ok:false}`.
 * Does not consume the body (reads a clone). Call it before any other auth path in workers/api.
 */
export async function verifyInternalRequest(
  request: Request,
  secret: string | undefined,
  options: VerifyOptions = {},
): Promise<InternalAuthResult> {
  if (!secret || secret.length < MIN_SECRET_LENGTH) return { ok: false, reason: "no_secret" };
  const principalHeader = request.headers.get(HEADER_PRINCIPAL);
  const timestamp = request.headers.get(HEADER_TIMESTAMP);
  const signature = request.headers.get(HEADER_SIGNATURE);
  if (!principalHeader || !timestamp || !signature) return { ok: false, reason: "missing_headers" };

  const prefix = `${SIGNATURE_VERSION}=`;
  if (!signature.startsWith(prefix)) return { ok: false, reason: "bad_version" };

  if (!/^[0-9]{1,12}$/.test(timestamp)) return { ok: false, reason: "bad_timestamp" };
  const now = Math.floor(options.now ?? Date.now() / 1000);
  const skew = options.maxSkewSeconds ?? MAX_SKEW_SECONDS;
  if (Math.abs(now - Number(timestamp)) > skew) return { ok: false, reason: "stale_timestamp" };

  const sigBytes = fromHex(signature.slice(prefix.length));
  if (!sigBytes) return { ok: false, reason: "bad_signature" };

  const body = new Uint8Array(await request.clone().arrayBuffer()) as Uint8Array<ArrayBuffer>;
  const data = await signingString(timestamp, request.method, request.url, body, principalHeader);
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret, "verify"),
    sigBytes,
    utf8(data),
  );
  if (!valid) return { ok: false, reason: "bad_signature" };

  const raw = base64urlDecode(principalHeader);
  if (!raw) return { ok: false, reason: "bad_principal" };
  let principal: unknown;
  try {
    principal = JSON.parse(dec.decode(raw));
  } catch {
    return { ok: false, reason: "bad_principal" };
  }
  if (!isPrincipal(principal)) return { ok: false, reason: "bad_principal" };
  return { ok: true, principal };
}
