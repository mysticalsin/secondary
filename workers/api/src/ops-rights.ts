// Data subject rights: export and erasure of one person's data inside a tenant.
//
// Export: Personal Brain, authored company items, comments and approvals, and receipt metadata.
// Erase: wipe the Personal Brain, replace the person's id with a keyed pseudonym in every company
// workspace and in every audit receipt, remove the directory entry. The pseudonym is
// HMAC-SHA256(PSEUDONYM_KEY, tenant:id), so the same person always maps to the same pseudonym
// (references stay consistent) and nobody without the key can map it back.

import type { Org } from "@secondary/policy";
import { fetchReceipts, pseudonymiseReceipts } from "./audit.ts";
import { forgetSourceAccess } from "./connector.ts";
import { MIN_PSEUDONYM_KEY } from "./pseudonym-key.ts";
import { scopeOfNode } from "./scope.ts";
import { tenantStub, workspaceStub } from "./stubs.ts";
import { KeyUnavailable, keyOf } from "./v8-keys.ts";

export const SUBJECT_PARAM = /^[A-Za-z0-9_.:@+-]{1,254}$/;
const MIN_KEY = MIN_PSEUDONYM_KEY;
/** How long an erasure is remembered for a restore: twice the 35 day backup retention, plus margin. */
export const TOMBSTONE_DAYS = 90;

/** Accepts a principal id or an email and returns the principal id. */
export async function resolveSubject(env: Env, tenantId: string, raw: string): Promise<string> {
  return raw.includes("@") ? tenantStub(env, tenantId).resolvePrincipalId(raw) : raw;
}

/** Every workspace scope of the organisation (company scopes only, no Personal Brains). */
export function companyScopes(org: Org): string[] {
  const out = new Set<string>();
  for (const n of org.nodes.values()) {
    const s = scopeOfNode(n);
    if (s && !s.startsWith("personal:")) out.add(s);
  }
  return [...out].sort();
}

const toHex = (b: ArrayBuffer) =>
  [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/** The pseudonym for a person, or null when PSEUDONYM_KEY is not configured. */
export async function pseudonymFor(
  env: Env,
  tenantId: string,
  principalId: string,
): Promise<string | null> {
  const k = env.PSEUDONYM_KEY;
  if (!k || k.length < MIN_KEY) return null;
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
    new TextEncoder().encode(`${tenantId}:${principalId}`),
  );
  return `pz_${toHex(sig).slice(0, 32)}`;
}

export async function exportSubject(env: Env, tenantId: string, org: Org, principalId: string) {
  const personal = (await workspaceStub(
    env,
    tenantId,
    `personal:${principalId}`,
  ).exportAll()) as Record<string, unknown[]>;
  const authored = await Promise.all(
    companyScopes(org).map(async (scope) => ({
      scope,
      ...(await workspaceStub(env, tenantId, scope).authoredBy(principalId)),
    })),
  );
  const receipts = await fetchReceipts(env, tenantId, principalId, 30);
  // The v8 records name people by keyed id: this person's own rows only, never anyone else's.
  const v8Records = await v8RecordsOf(env, tenantId, org, principalId);
  return {
    format: "secondary-subject-export/1",
    generatedAt: new Date().toISOString(),
    tenantId,
    principalId,
    personalBrain: {
      items: personal.items ?? [],
      comments: personal.comments ?? [],
      contributions: personal.contributions ?? [],
      // The personal wiki is the person's own data too (M-02).
      wiki: {
        pages: personal.wiki_pages ?? [],
        revisions: personal.wiki_page_revisions ?? [],
        facts: personal.wiki_facts ?? [],
        sources: personal.wiki_sources ?? [],
        log: personal.wiki_log ?? [],
        schema: personal.wiki_schema ?? [],
      },
    },
    authoredCompany: authored.filter(
      (a) =>
        a.items.length ||
        a.comments.length ||
        a.approvals.length ||
        a.edits.length ||
        a.wiki.revisions.length ||
        a.wiki.factsVerified.length ||
        a.wiki.log.length,
    ),
    v8Records,
    receipts: { windowDays: 30, available: receipts !== null, items: receipts ?? [] },
  };
}

/** The review desk state and knowledge-gap rows of one person, per company brain. */
async function v8RecordsOf(env: Env, tenantId: string, org: Org, principalId: string) {
  try {
    const person = await keyOf(env, tenantId, principalId);
    const rows = await Promise.all(
      companyScopes(org).map(async (scope) => ({
        scope,
        ...(await workspaceStub(env, tenantId, scope).v8Subject(
          person,
          await keyOf(env, tenantId, principalId, `asker:${scope}`),
        )),
      })),
    );
    return rows.filter((r) => r.review.length || r.gaps.length);
  } catch (e) {
    if (e instanceof KeyUnavailable) return [];
    throw e;
  }
}

/** Remove one person from the v8 records of a workspace (idempotent). */
async function forgetV8(env: Env, tenantId: string, scope: string, principalId: string) {
  try {
    await workspaceStub(env, tenantId, scope).v8Forget(
      await keyOf(env, tenantId, principalId),
      await keyOf(env, tenantId, principalId, `asker:${scope}`),
    );
  } catch (e) {
    // Without the secret no key was ever written, so there is nothing to remove.
    if (!(e instanceof KeyUnavailable)) throw e;
  }
}

export type EraseSummary = {
  pseudonym: string;
  personalItemsDeleted: number;
  authored: { items: number; comments: number; approvals: number; edits: number };
  receiptsPseudonymised: number;
  /** The connector confirmed it dropped the person's cached read decisions (M-03). */
  connectorCacheForgotten: boolean;
};

/** Returns null when the audit worker could not complete (nothing after that step has run). */
export async function eraseSubject(
  env: Env,
  tenantId: string,
  org: Org,
  principalId: string,
  pseudonym: string,
): Promise<EraseSummary | null> {
  // The audit pass goes first (M-03): if it cannot finish, nothing else has changed and the whole erase
  // can be asked for again. Every later step is idempotent.
  const receiptsPseudonymised = await pseudonymiseReceipts(env, tenantId, principalId, pseudonym);
  if (receiptsPseudonymised === null) return null;
  const authored = { items: 0, comments: 0, approvals: 0, edits: 0 };
  // The address can be typed into wiki text (an owner, a note): it is replaced with the id.
  const email = await tenantStub(env, tenantId).emailOfPrincipal(principalId);
  const aliases = email ? [email, email.toLowerCase()] : [];
  // Remembered before anything is deleted, so a restore of an older snapshot can apply it again (M-03).
  const at = Date.now();
  await tenantStub(env, tenantId).tombstoneAdd(
    principalId,
    pseudonym,
    [...new Set(aliases)],
    at,
    at + TOMBSTONE_DAYS * 86_400_000,
  );
  for (const scope of companyScopes(org)) {
    const r = await workspaceStub(env, tenantId, scope).pseudonymise(
      principalId,
      pseudonym,
      aliases,
    );
    authored.items += r.items;
    authored.comments += r.comments;
    authored.approvals += r.approvals;
    authored.edits += r.edits;
    await forgetV8(env, tenantId, scope, principalId);
  }
  const personalItemsDeleted = await workspaceStub(env, tenantId, `personal:${principalId}`).wipe();
  const connectorCacheForgotten = email
    ? await forgetSourceAccess(env, tenantId, { id: principalId, email })
    : false;
  await tenantStub(env, tenantId).erasePrincipal(principalId);
  return {
    pseudonym,
    personalItemsDeleted,
    authored,
    receiptsPseudonymised,
    connectorCacheForgotten,
  };
}

/**
 * After a restore: erase again everyone who was erased since the snapshot was taken (M-03). A tenant
 * restore brings back the directory rows of erased people; a workspace restore brings back their items,
 * comments and Personal Brain. Both steps are idempotent. Returns how many erasures were applied.
 */
export async function reapplyErasures(
  env: Env,
  tenantId: string,
  kind: "tenant" | "workspace",
  scope: string,
): Promise<number> {
  const t = tenantStub(env, tenantId);
  const stones = await t.tombstoneList(Date.now());
  for (const s of stones) {
    if (kind === "tenant") {
      await t.erasePrincipal(s.principalId);
      continue;
    }
    const w = workspaceStub(env, tenantId, scope);
    if (scope === `personal:${s.principalId}`) await w.wipe();
    else if (!scope.startsWith("personal:")) {
      await w.pseudonymise(s.principalId, s.pseudonym, s.aliases);
      await forgetV8(env, tenantId, scope, s.principalId);
    }
  }
  return stones.length;
}
