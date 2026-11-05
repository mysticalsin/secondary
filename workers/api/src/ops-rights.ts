// Data subject rights: export and erasure of one person's data inside a tenant.
//
// Export: Personal Brain, authored company items, comments and approvals, and receipt metadata.
// Erase: wipe the Personal Brain, replace the person's id with a keyed pseudonym in every company
// workspace and in every audit receipt, remove the directory entry. The pseudonym is
// HMAC-SHA256(PSEUDONYM_KEY, tenant:id), so the same person always maps to the same pseudonym
// (references stay consistent) and nobody without the key can map it back.

import type { Org } from "@secondary/policy";
import { fetchReceipts, pseudonymiseReceipts } from "./audit.ts";
import { scopeOfNode } from "./scope.ts";
import { tenantStub, workspaceStub } from "./stubs.ts";

export const SUBJECT_PARAM = /^[A-Za-z0-9_.:@+-]{1,254}$/;
const MIN_KEY = 32;

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
  return {
    format: "secondary-subject-export/1",
    generatedAt: new Date().toISOString(),
    tenantId,
    principalId,
    personalBrain: {
      items: personal.items ?? [],
      comments: personal.comments ?? [],
      contributions: personal.contributions ?? [],
    },
    authoredCompany: authored.filter(
      (a) => a.items.length || a.comments.length || a.approvals.length || a.edits.length,
    ),
    receipts: { windowDays: 30, available: receipts !== null, items: receipts ?? [] },
  };
}

export type EraseSummary = {
  pseudonym: string;
  personalItemsDeleted: number;
  authored: { items: number; comments: number; approvals: number; edits: number };
  receiptsPseudonymised: number;
};

/** Returns null when the audit worker could not complete (nothing after that step has run). */
export async function eraseSubject(
  env: Env,
  tenantId: string,
  org: Org,
  principalId: string,
  pseudonym: string,
): Promise<EraseSummary | null> {
  const authored = { items: 0, comments: 0, approvals: 0, edits: 0 };
  for (const scope of companyScopes(org)) {
    const r = await workspaceStub(env, tenantId, scope).pseudonymise(principalId, pseudonym);
    authored.items += r.items;
    authored.comments += r.comments;
    authored.approvals += r.approvals;
    authored.edits += r.edits;
  }
  const receiptsPseudonymised = await pseudonymiseReceipts(env, tenantId, principalId, pseudonym);
  if (receiptsPseudonymised === null) return null;
  const personalItemsDeleted = await workspaceStub(env, tenantId, `personal:${principalId}`).wipe();
  await tenantStub(env, tenantId).erasePrincipal(principalId);
  return { pseudonym, personalItemsDeleted, authored, receiptsPseudonymised };
}
