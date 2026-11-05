// Signed calls between the ops worker, the mcp worker and the API (service bindings only).
// Pure WebCrypto, no dependencies, safe in workerd. Workers import this file by relative path.
//
// Wire format: two headers.
//   X-Secondary-Ops-Timestamp  unix seconds
//   X-Secondary-Ops-Signature  "v1=" + lowercase hex HMAC-SHA256(secret, signingString)
// signingString = ["ops-v1", timestamp, METHOD, path+search, sha256hex(body)].join("\n")
// The prefix "ops-v1" keeps these signatures apart from the MCP principal signatures that use the same key.

export const OPS_HEADER_TIMESTAMP = "x-secondary-ops-timestamp";
export const OPS_HEADER_SIGNATURE = "x-secondary-ops-signature";
export const OPS_MAX_SKEW_SECONDS = 60;
export const OPS_MIN_SECRET_LENGTH = 32;

const enc = new TextEncoder();
const utf8 = (s: string) => enc.encode(s) as Uint8Array<ArrayBuffer>;
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

function fromHex(h: string): Uint8Array<ArrayBuffer> | null {
  if (h.length === 0 || h.length % 2 !== 0 || !/^[0-9a-f]+$/.test(h)) return null;
  const out = new Uint8Array(new ArrayBuffer(h.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function signingString(
  ts: string,
  method: string,
  url: string,
  body: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const u = new URL(url);
  const digest = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", body)));
  return ["ops-v1", ts, method.toUpperCase(), `${u.pathname}${u.search}`, digest].join("\n");
}

const key = (secret: string, usage: "sign" | "verify") =>
  crypto.subtle.importKey("raw", utf8(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);

export interface OpsSignInput {
  secret: string;
  method: string;
  url: string;
  /** Exact body bytes as sent. Omit for GET. */
  body?: string;
  /** Unix seconds. Defaults to now. */
  now?: number;
}

/** Headers to add to a service-binding request. Throws when the secret is too short. */
export async function signOpsRequest(i: OpsSignInput): Promise<Record<string, string>> {
  if (i.secret.length < OPS_MIN_SECRET_LENGTH) throw new Error("ops secret too short");
  const ts = String(Math.floor(i.now ?? Date.now() / 1000));
  const data = await signingString(ts, i.method, i.url, utf8(i.body ?? ""));
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", await key(i.secret, "sign"), utf8(data)),
  );
  return { [OPS_HEADER_TIMESTAMP]: ts, [OPS_HEADER_SIGNATURE]: `v1=${hex(sig)}` };
}

/** True only for a fresh, correctly signed request. Fail closed on every problem. Does not consume the body. */
export async function verifyOpsRequest(
  request: Request,
  secret: string | undefined,
  o: { now?: number } = {},
): Promise<boolean> {
  if (!secret || secret.length < OPS_MIN_SECRET_LENGTH) return false;
  const ts = request.headers.get(OPS_HEADER_TIMESTAMP);
  const sig = request.headers.get(OPS_HEADER_SIGNATURE);
  if (!ts || !sig?.startsWith("v1=") || !/^[0-9]{1,12}$/.test(ts)) return false;
  const now = Math.floor(o.now ?? Date.now() / 1000);
  if (Math.abs(now - Number(ts)) > OPS_MAX_SKEW_SECONDS) return false;
  const bytes = fromHex(sig.slice(3));
  if (!bytes) return false;
  const body = new Uint8Array(await request.clone().arrayBuffer()) as Uint8Array<ArrayBuffer>;
  const data = await signingString(ts, request.method, request.url, body);
  return crypto.subtle.verify("HMAC", await key(secret, "verify"), bytes, utf8(data));
}
