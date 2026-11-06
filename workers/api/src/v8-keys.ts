// Keys for the v8 sidecar records (review desk state, knowledge gaps). A person is never stored there by
// principal id: the record holds HMAC-SHA256(PSEUDONYM_KEY, label:tenant:id), so a snapshot, an export
// or a directory listing cannot be used to enumerate who snoozed, was assigned, or asked. `label` keeps
// uses apart ("person" for review state and assignments, "asker:<scope>" for the askers of one brain).
// Without the key nothing is written: callers fail closed.

import { MIN_PSEUDONYM_KEY } from "./pseudonym-key.ts";

/** The author of every v8 sidecar item. Never a person: the items hold keyed ids and no content owner. */
export const V8_ACTOR = "svc:v8";

export class KeyUnavailable extends Error {
  constructor() {
    super("pseudonym_key_missing");
  }
}

const toHex = (b: ArrayBuffer) =>
  [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export async function keyOf(
  env: Env,
  tenantId: string,
  principalId: string,
  label = "person",
): Promise<string> {
  const k = env.PSEUDONYM_KEY;
  if (!k || k.length < MIN_PSEUDONYM_KEY) throw new KeyUnavailable();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(k),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`v8:${label}:${tenantId}:${principalId}`),
  );
  return `k_${toHex(sig).slice(0, 24)}`;
}

/** Keys for a set of people, computed once so synchronous code can look them up. */
export interface Keyed {
  of(id: string): string;
  /** The person behind a key, among the people this was built for. */
  idOf(key: string | null | undefined): string | null;
}

export async function keyed(
  env: Env,
  tenantId: string,
  ids: Iterable<string>,
  label = "person",
): Promise<Keyed> {
  const fwd = new Map<string, string>();
  const rev = new Map<string, string>();
  for (const id of new Set(ids)) {
    const k = await keyOf(env, tenantId, id, label);
    fwd.set(id, k);
    rev.set(k, id);
  }
  return {
    of: (id) => {
      const k = fwd.get(id);
      if (!k) throw new Error("key not prepared");
      return k;
    },
    idOf: (key) => (key ? (rev.get(key) ?? null) : null),
  };
}
