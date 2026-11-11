// Shared pieces of the HMAC-signed service calls (workers/mcp -> api, api <-> connector, ops -> api):
// key ids, nonces and the replay store contract. Pure WebCrypto, safe in workerd, Node and Vitest.
//
// Every signed call carries a key id (`kid`) and a random nonce, both inside the signed string.
//  - kid: the verifier holds a ring {kid: secret}, so a key can be rotated with an overlap (the new key
//    is current, the old one stays as `*_PREVIOUS` until every sender has moved) instead of a lockstep deploy.
//  - nonce: the verifier stores it until after the last millisecond that timestamp can still pass
//    the clock check. Both verifiers use MAX_SKEW_SECONDS and CLOCK_GRANULARITY_MS below.

export const DEFAULT_KID = "k1";
export const PREVIOUS_KID = "k0";
export const KID_PATTERN = /^[A-Za-z0-9_.-]{1,32}$/;
export const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
/** Clock skew both signed-call verifiers allow, in whole unix seconds. */
export const MAX_SKEW_SECONDS = 60;
/**
 * Verifiers floor the clock to this many milliseconds. A timestamp T is still accepted at
 * (T + MAX_SKEW_SECONDS) * CLOCK_GRANULARITY_MS + (CLOCK_GRANULARITY_MS - 1).
 */
export const CLOCK_GRANULARITY_MS = 1_000;
/**
 * Passed through to the replay store. The stored expiry is `nonceExpiresAt`, not receipt plus this.
 * The span is from the earliest accepted millisecond to that expiry.
 */
export const REPLAY_TTL_MS = (MAX_SKEW_SECONDS * 2 + 1) * CLOCK_GRANULARITY_MS;

/** Last millisecond a verifier can accept a token time of `tokenExpMs` with `maxSkewMs`. */
export function lastAcceptedMs(tokenExpMs: number, maxSkewMs: number): number {
  return tokenExpMs + maxSkewMs + (CLOCK_GRANULARITY_MS - 1);
}

/**
 * Nonce expiry derived from the token time and the acceptance window. Strictly after
 * `lastAcceptedMs`: for one-second clocks that is (T + skew + 1) * CLOCK_GRANULARITY_MS.
 */
export function nonceExpiresAt(tokenExpMs: number, maxSkewMs: number): number {
  return tokenExpMs + maxSkewMs + CLOCK_GRANULARITY_MS;
}

/** Unix seconds from a millisecond clock, floored by CLOCK_GRANULARITY_MS. */
export function unixSeconds(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / CLOCK_GRANULARITY_MS);
}

export type KeyRing = Readonly<Record<string, string>>;

/** Token exp and the verifier's max clock skew, both in milliseconds. */
export type NonceWindow = { tokenExpMs: number; maxSkewMs: number };

/** Remembers nonces. `first` is true only the first time a key is seen inside its TTL. */
export interface ReplayStore {
  first(key: string, ttlMs: number, window?: NonceWindow): Promise<boolean>;
}

export function newNonce(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** A single secret is the ring {k1: secret}; a ring is used as is; nothing is an empty ring. */
export function ringOf(keys: string | KeyRing | undefined): KeyRing {
  if (!keys) return {};
  return typeof keys === "string" ? { [DEFAULT_KID]: keys } : keys;
}

/** The ring a verifier builds from env: the current key and, during a rotation, the previous one. */
export function keyringFromEnv(
  current: string | undefined,
  currentKid: string | undefined,
  previous?: string | undefined,
  previousKid?: string | undefined,
): KeyRing {
  const ring: Record<string, string> = {};
  const prevKid = previousKid && KID_PATTERN.test(previousKid) ? previousKid : PREVIOUS_KID;
  const curKid = currentKid && KID_PATTERN.test(currentKid) ? currentKid : DEFAULT_KID;
  if (previous) ring[prevKid] = previous;
  if (current) ring[curKid] = current;
  return ring;
}

/** The signer's kid for a secret: the configured one, else the default. */
export const signingKid = (kid: string | undefined): string =>
  kid && KID_PATTERN.test(kid) ? kid : DEFAULT_KID;
