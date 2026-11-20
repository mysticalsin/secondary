// One in-flight raw tree read per tenant and scope, in this isolate only.
// The value is wikiPages plus wikiSchema. Filtering stays with the request.

export const INFLIGHT_CAP = 64;
export const INFLIGHT_TTL_MS = 30_000;

export type InflightValue<P, S> = { ok: true; pages: P; schema: S } | { ok: false };

type Slot<T> = { promise: Promise<T>; startedAt: number };

const slots = new Map<string, Slot<InflightValue<unknown, unknown>>>();

/** A separator inside a tenant or a scope must not collide with another pair. */
export function inflightKey(tenantId: string, scope: string): string {
  return JSON.stringify([tenantId, scope]);
}

export function dropInflight(tenantId: string, scope: string): void {
  slots.delete(inflightKey(tenantId, scope));
}

/** Test isolation. A settled read has already deleted its slot. */
export function clearInflight(): void {
  slots.clear();
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as object)) deepFreeze(child);
  Object.freeze(value);
  return value;
}

function logRejected(): void {
  console.log(JSON.stringify({ event: "tree_inflight", outcome: "rejected" }));
}

async function readOnce<P, S>(
  read: () => Promise<{ pages: P; schema: S }>,
): Promise<InflightValue<P, S>> {
  try {
    const value = await read();
    return { ok: true, pages: deepFreeze(value.pages), schema: deepFreeze(value.schema) };
  } catch {
    logRejected();
    return { ok: false };
  }
}

/**
 * Join the running raw read, or start one. A full map does not evict a hung read:
 * the caller gets an unshared read that is not stored. The promise never rejects.
 * Settle deletes the slot only when it is still this one.
 */
export function loadRaw<P, S>(input: {
  tenantId: string;
  scope: string;
  now: number;
  hold: ((promise: Promise<unknown>) => void) | null;
  read: () => Promise<{ pages: P; schema: S }>;
}): Promise<InflightValue<P, S>> {
  if (!input.hold) return readOnce(input.read);
  const key = inflightKey(input.tenantId, input.scope);
  const current = slots.get(key);
  if (current && input.now - current.startedAt < INFLIGHT_TTL_MS) {
    return current.promise as Promise<InflightValue<P, S>>;
  }
  if (!current && slots.size >= INFLIGHT_CAP) return readOnce(input.read);
  const slot: Slot<InflightValue<P, S>> = {
    startedAt: input.now,
    promise: Promise.resolve({ ok: false }),
  };
  const promise = (async () => {
    try {
      return await readOnce(input.read);
    } finally {
      if (slots.get(key) === slot) slots.delete(key);
    }
  })();
  slot.promise = promise;
  slots.set(key, slot);
  try {
    input.hold(promise);
  } catch {
    if (slots.get(key) === slot) slots.delete(key);
    return readOnce(input.read);
  }
  return promise;
}
