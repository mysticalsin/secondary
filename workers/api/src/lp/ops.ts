// Landing Page Studio and the operations around it: the switch that takes public pages offline, the
// right to erasure, and what happens after a restore. Each takes the public objects down first (from then
// on the URL is a 404, whatever happens next) and only then changes the record.

import { appendReceipt, newReceiptId } from "../audit.ts";
import { expireLandingPages } from "./retention.ts";
import { deletePage, readStats } from "./stats.ts";
import { lpStub } from "./stub.ts";

const BATCH = 200;
const MAX_ROUNDS = 25;

const receipt = (
  env: Env,
  tenantId: string,
  principalId: string,
  action: string,
  nodeId: string | null,
  reason: string,
  now: number,
): Promise<boolean> =>
  appendReceipt(env, {
    receiptId: newReceiptId(),
    at: new Date(now).toISOString(),
    tenantId,
    principalId,
    action,
    nodeId,
    scopeId: null,
    decision: "allow",
    reason,
    revision: null,
    requestId: null,
    clientId: null,
    tool: null,
  });

/**
 * Admin action behind the `lp` kill switch: every published page goes offline. The record stays (as
 * unpublished, counts kept, its approval intact), so the owner can publish it again once the switch is
 * back on. One receipt per page, ids only. Returns how many pages were taken down.
 */
export async function takeLandingPagesOffline(
  env: Env,
  tenantId: string,
  actor: string,
  now: number,
): Promise<number> {
  const store = lpStub(env, tenantId);
  let n = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const live = await store.published(BATCH);
    if (!live.length) break;
    for (const rec of live) {
      const stats = rec.slug ? await readStats(env, rec.slug) : null;
      if (rec.slug) await deletePage(env, rec.slug);
      const res = await store.markUnpublished(rec.id, stats, now);
      if (res.ok) {
        n++;
        await receipt(env, tenantId, actor, "lp.take_offline", rec.id, "lp switch off", now);
      }
    }
  }
  return n;
}

/**
 * A person's right to erasure. Their pages are removed with the prospect data on them; a page of someone
 * else that names them as the contact loses that name and, if it was public, goes offline. Idempotent.
 */
export async function erasePersonPages(
  env: Env,
  tenantId: string,
  ids: string[],
  emails: string[],
  pseudonym: string,
  now: number,
): Promise<{ removed: number; redacted: number }> {
  const store = lpStub(env, tenantId);
  const { owned, named } = await store.ofPerson(ids, emails);
  for (const p of [...owned, ...named])
    if (p.slug && p.status === "published") await deletePage(env, p.slug);
  // An unpublished page keeps no object either, but a stray one is cheap to remove.
  for (const p of [...owned, ...named])
    if (p.slug && p.status !== "published") await deletePage(env, p.slug);
  return store.erasePerson(ids, emails, pseudonym, now);
}

/**
 * After a restore of the page store: a page whose clock ran out since the snapshot was taken is expired
 * again at once (its prospect data must not come back), and a page restored as public whose object is
 * gone is no longer public.
 */
export async function afterLandingRestore(env: Env, tenantId: string, now: number): Promise<void> {
  await expireLandingPages(env, tenantId, now);
  const store = lpStub(env, tenantId);
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const live = await store.published(BATCH);
    const gone: string[] = [];
    for (const rec of live)
      if (rec.slug && !(await env.PAGES.head(`p/${rec.slug}.html`))) gone.push(rec.id);
    if (!gone.length) break;
    for (const id of gone) await store.markUnpublished(id, null, now);
    if (gone.length < live.length) break;
  }
}

/** Dev reseed: the public objects of every page go, then the store is emptied. */
export async function resetLandingPages(env: Env, tenantId: string): Promise<void> {
  const store = lpStub(env, tenantId);
  for (const slug of await store.slugs()) await deletePage(env, slug);
  await store.wipe();
}
