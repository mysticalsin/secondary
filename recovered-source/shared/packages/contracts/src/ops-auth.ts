// Signed calls between the ops worker, the mcp worker and the API (service bindings only).
// Pure WebCrypto, no dependencies, safe in workerd. Workers import this file by relative path.
//
// Wire format: four headers.
//   X-Secondary-Ops-Timestamp  unix seconds
//   X-Secondary-Ops-Key-Id     which key signed (the verifier holds a ring, so keys rotate with an overlap)
//   X-Secondary-Ops-Nonce      random, remembered by the verifier so a request cannot be replayed
//   X-Secondary-Ops-Signature  "v2=" + lowercase hex HMAC-SHA256(secret, signingString)
// signingString = ["ops-v2", kid, nonce, timestamp, METHOD, path+search, sha256hex(body)].join("\n")
// The prefix "ops-v2" keeps these signatures apart from the MCP principal signatures. The ops key is
// its own secret (OPS_HMAC_KEY), never shared with the internet-facing MCP worker.

export const OPS_HEADER_TIMESTAMP = "x-secondary-ops-timestamp";
export const OPS_HEADER_SIGNATURE = "x-secondary-ops-signature";
export const OPS_HEADER_KID = "x-secondary-ops-key-id";
export const OPS_HEADER_NONCE = "x-secondary-ops-nonce";
export const OPS_MAX_SKEW_SECONDS = 60;
export const OPS_MIN_SECRET_LENGTH = 32;

import {
  type KeyRing,
  KID_PATTERN,
  NONCE_PATTERN,
  newNonce,
  REPLAY_TTL_MS,
  type ReplayStore,
  ringOf,
  signingKid,
} from "./signed-call.ts";

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
  kid: string,
  nonce: string,
  ts: string,
  method: string,
  url: string,
  body: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const u = new URL(url);
  const digest = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", body)));
  return ["ops-v2", kid, nonce, ts, method.toUpperCase(), `${u.pathname}${u.search}`, digest].join(
    "\n",
  );
}

const key = (secret: string, usage: "sign" | "verify") =>
  crypto.subtle.importKey("raw", utf8(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);

export interface OpsSignInput {
  secret: string;
  /** Key id of `secret`. Defaults to "k1". */
  kid?: string;
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
  const kid = signingKid(i.kid);
  const nonce = newNonce();
  const data = await signingString(kid, nonce, ts, i.method, i.url, utf8(i.body ?? ""));
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", await key(i.secret, "sign"), utf8(data)),
  );
  return {
    [OPS_HEADER_TIMESTAMP]: ts,
    [OPS_HEADER_KID]: kid,
    [OPS_HEADER_NONCE]: nonce,
    [OPS_HEADER_SIGNATURE]: `v2=${hex(sig)}`,
  };
}

/**
 * True only for a fresh, correctly signed request whose nonce has not been seen. Fail closed on every
 * problem. `keys` is one secret (key id k1) or a ring {kid: secret}. Does not consume the body.
 */
export async function verifyOpsRequest(
  request: Request,
  keys: string | KeyRing | undefined,
  o: { now?: number; replay?: ReplayStore; channel?: string } = {},
): Promise<boolean> {
  const ring = ringOf(keys);
  const ts = request.headers.get(OPS_HEADER_TIMESTAMP);
  const sig = request.headers.get(OPS_HEADER_SIGNATURE);
  const kid = request.headers.get(OPS_HEADER_KID);
  const nonce = request.headers.get(OPS_HEADER_NONCE);
  if (!ts || !sig?.startsWith("v2=") || !/^[0-9]{1,12}$/.test(ts)) return false;
  if (!kid || !KID_PATTERN.test(kid) || !nonce || !NONCE_PATTERN.test(nonce)) return false;
  const secret = Object.hasOwn(ring, kid) ? ring[kid] : undefined;
  if (!secret || secret.length < OPS_MIN_SECRET_LENGTH) return false;
  const now = Math.floor(o.now ?? Date.now() / 1000);
  if (Math.abs(now - Number(ts)) > OPS_MAX_SKEW_SECONDS) return false;
  const bytes = fromHex(sig.slice(3));
  if (!bytes) return false;
  const body = new Uint8Array(await request.clone().arrayBuffer()) as Uint8Array<ArrayBuffer>;
  const data = await signingString(kid, nonce, ts, request.method, request.url, body);
  if (!(await crypto.subtle.verify("HMAC", await key(secret, "verify"), bytes, utf8(data))))
    return false;
  // Only a request that carries a valid signature may spend a nonce.
  if (o.replay && !(await o.replay.first(`${o.channel ?? "ops"}:${kid}:${nonce}`, REPLAY_TTL_MS)))
    return false;
  return true;
}
