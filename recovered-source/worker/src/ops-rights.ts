// Data subject rights: export and erasure of one person's data inside a tenant.
//
// Export: Personal Brain, authored company items, comments and approvals, and receipt metadata.
// Erase: wipe the Personal Brain, replace the person's id with a keyed pseudonym in every company
// workspace and in every audit receipt, remove the directory entry. The pseudonym is
// HMAC-SHA256(PSEUDONYM_KEY, tenant:id), so the same person always maps to the same pseudonym
// (references stay consistent) and nobody without the key can map it back.

import type { Org } from "@secondary/policy";
import {
  decodeErasureLedger,
  encodeErasure,
  erasureOutcome,
  ledgerVersion,
  withLedgerVersion,
  erasurePlan,
  runErasure as applyLedger,
  stepsForRestore,
  type ErasureEvent,
  type StoredErasure,
} from "../../../src/state/erasure-request.ts";
import { fetchReceipts, pseudonymiseReceipts } from "./audit.ts";
import { forgetSourceAccess } from "./connector.ts";
import { scopeOfNode } from "./scope.ts";
import { tenantStub, workspaceStub } from "./stubs.ts";

export const SUBJECT_PARAM = /^[A-Za-z0-9_.:@+-]{1,254}$/;
const MIN_KEY = 32;
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

export type PseudonymRefusal = { tag: "refused"; reason: "pseudonym_key" };

/** The pseudonym for a person, or a refusal when the key is missing, empty, or shorter than 32 characters. */
export async function pseudonymKey(
  env: Parameters<typeof pseudonymFor>[0],
  tenantId: string,
  principalId: string,
): Promise<{ tag: "ok"; pseudonym: string } | PseudonymRefusal> {
  const pseudonym = await pseudonymFor(env, tenantId, principalId);
  if (!pseudonym) return { tag: "refused", reason: "pseudonym_key" };
  return { tag: "ok", pseudonym };
}

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
    receipts: { windowDays: 30, available: receipts !== null, items: receipts ?? [] },
  };
}

export type EraseSummary = {
  pseudonym: string;
  personalItemsDeleted: number;
  authored: { items: number; comments: number; approvals: number; edits: number };
  receiptsPseudonymised: number;
  /** The connector confirmed it dropped the person's cached read decisions (M-03). */
  connectorCacheForgotten: boolean;
};

export type ErasureRun = EraseSummary & { status: string; step: string | null };

async function runErasure(
  env: Parameters<typeof exportSubject>[0],
  tenantId: string,
  principalId: string,
  pseudonym: string,
  aliases: string[],
  email: string | null,
  event: ErasureEvent,
): Promise<ErasureRun | PseudonymRefusal> {
  const key = await pseudonymKey(env, tenantId, principalId);
  if (key.tag === "refused") return key;
  const tenant = tenantStub(env, tenantId);
  const summary: EraseSummary = {
    pseudonym,
    personalItemsDeleted: 0,
    authored: { items: 0, comments: 0, approvals: 0, edits: 0 },
    receiptsPseudonymised: 0,
    connectorCacheForgotten: false,
  };
  const state = await applyLedger(
    decodeErasureLedger(await tenant.erasureLoad(principalId), principalId),
    event,
    async (step, report) => {
      if (step === "receipts") {
        const prior = decodeErasureLedger(await tenant.erasureLoad(principalId), principalId).receipts;
        const result = await pseudonymiseReceipts(env, tenantId, principalId, pseudonym, prior, report);
        if (result.tag === "done" || result.tag === "partial" || result.tag === "failed")
          summary.receiptsPseudonymised = result.rewritten;
        return result.tag === "done";
      }
      if (step === "tombstone") {
        await tenant.tombstoneAdd(
          principalId,
          pseudonym,
          [...new Set(aliases)],
          event.now,
          event.now + TOMBSTONE_DAYS * 86_400_000,
        );
        return true;
      }
      if (step === "personal") {
        summary.personalItemsDeleted = await workspaceStub(env, tenantId, `personal:${principalId}`).wipe();
        return true;
      }
      if (step === "connector") {
        if (!email) return true;
        summary.connectorCacheForgotten = await forgetSourceAccess(env, tenantId, { id: principalId, email });
        return summary.connectorCacheForgotten;
      }
      if (step === "directory") {
        await tenant.erasePrincipal(principalId, pseudonym);
        return true;
      }
      if (step.startsWith("scope:")) {
        const r = await workspaceStub(env, tenantId, step.slice("scope:".length)).pseudonymise(
          principalId,
          pseudonym,
          aliases,
        );
        summary.authored.items += r.items;
        summary.authored.comments += r.comments;
        summary.authored.approvals += r.approvals;
        summary.authored.edits += r.edits;
        return true;
      }
      return false;
    },
    async (next: StoredErasure) => {
      const stored = encodeErasure(next);
      const version = ledgerVersion((await tenant.erasureLoad(principalId))?.ledger) + 1;
      await tenant.erasureSaveAtomic(
        principalId,
        stored.status,
        withLedgerVersion(stored.ledger, version),
        event.now,
      );
    },
  );
  return { ...summary, ...erasureOutcome(state) };
}

/** One erasure record per subject. A later call resumes the ledger. The clock is `now`. */
export async function eraseSubject(
  env: Env,
  tenantId: string,
  org: Org,
  principalId: string,
  pseudonym: string,
  now: number,
): Promise<ErasureRun | PseudonymRefusal> {
  const email = await tenantStub(env, tenantId).emailOfPrincipal(principalId);
  const aliases = email ? [email, email.toLowerCase()] : [];
  return runErasure(env, tenantId, principalId, pseudonym, aliases, email, {
    type: "request",
    now,
    steps: erasurePlan(companyScopes(org)),
  });
}

/**
 * After a restore: erase again everyone who was erased since the snapshot was taken (M-03). A tenant
 * restore brings back the directory rows of erased people; a workspace restore brings back their items,
 * comments and Personal Brain. Both steps are idempotent. A row runs only when its own grant passes
 * the same check as a resume, and only for steps that grant approved. A row without that grant is
 * skipped and listed. Restore does not write a grant of its own.
 */
export async function reapplyErasures(
  env: Env,
  tenantId: string,
  kind: "tenant" | "workspace",
  scope: string,
  now: number,
): Promise<{ applied: number; skipped: string[] }> {
  const t = tenantStub(env, tenantId);
  const stones = await t.tombstoneList(now);
  const skipped: string[] = [];
  let applied = 0;
  for (const s of stones) {
    const wanted = stepsForRestore(kind, scope, s.principalId);
    if (wanted.length === 0) continue;
    const state = decodeErasureLedger(await t.erasureLoad(s.principalId), s.principalId);
    const grant = state.grant;
    // decodeErasureLedger is the gate. It returns no grant unless the grant covers this subject and order.
    if (!grant) {
      skipped.push(s.principalId);
      continue;
    }
    const steps = wanted.filter((step) => grant.steps.includes(step));
    if (steps.length === 0) continue;
    const email = await t.emailOfPrincipal(s.principalId);
    const outcome = await runErasure(env, tenantId, s.principalId, s.pseudonym, s.aliases, email, {
      type: "restore",
      now,
      steps,
    });
    if ("reason" in outcome) {
      skipped.push(s.principalId);
      continue;
    }
    applied++;
  }
  return { applied, skipped };
}
