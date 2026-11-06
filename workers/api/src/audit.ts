// Client for workers/audit through the AUDIT service binding. Receipts carry who, what, where and
// the decision. They never carry content.

import {
  newReceiptId as newId,
  type Receipt as StoredReceipt,
} from "../../../packages/contracts/src/audit-receipt.ts";

/** What the API sends. The audit worker fills the MCP-only fields with defaults and stamps `source`. */
export type Receipt = Omit<
  StoredReceipt,
  "scopeIds" | "resultCount" | "oauthScopes" | "redirectHost" | "source"
>;

const AUDIT_ORIGIN = "https://audit.internal";
const MAX_ERASE_PAGES = 800;

export const newReceiptId = newId;

/** True when the audit worker accepted the receipt. Callers that mutate fail closed on false. */
export async function appendReceipt(env: Env, r: Receipt): Promise<boolean> {
  try {
    const res = await env.AUDIT.fetch(`${AUDIT_ORIGIN}/append`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Audit-Key": env.AUDIT_KEY_API ?? "" },
      body: JSON.stringify(r),
    });
    return res.status === 202;
  } catch {
    return false;
  }
}

export async function fetchReceipts(
  env: Env,
  tenantId: string,
  principalId: string | null,
  days: number,
  limit?: number,
): Promise<StoredReceipt[] | null> {
  try {
    const q = new URLSearchParams({ tenant: tenantId, days: String(days) });
    if (limit !== undefined) q.set("limit", String(limit));
    if (principalId !== null) q.set("principal", principalId);
    const res = await env.AUDIT.fetch(`${AUDIT_ORIGIN}/receipts?${q}`, {
      headers: { "X-Audit-Key": env.AUDIT_KEY_READ ?? "" },
    });
    if (!res.ok) return null;
    return ((await res.json()) as { receipts: StoredReceipt[] }).receipts;
  } catch {
    return null;
  }
}

/**
 * Right to erasure: ask workers/audit to replace a principal id with its pseudonym in every stored
 * receipt of the tenant. Pages through the bucket. Returns the number of receipts rewritten, or
 * null when the audit worker is unavailable or refuses.
 */
export async function pseudonymiseReceipts(
  env: Env,
  tenantId: string,
  from: string,
  to: string,
): Promise<number | null> {
  let rewritten = 0;
  let cursor: string | undefined;
  try {
    // Each page is one subrequest; a Worker may make 1000, and the other steps of an erase need some.
    for (let page = 0; page < MAX_ERASE_PAGES; page++) {
      const res = await env.AUDIT.fetch(`${AUDIT_ORIGIN}/pseudonymise`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Audit-Key": env.AUDIT_KEY_ERASE ?? "" },
        body: JSON.stringify({ tenant: tenantId, from, to, ...(cursor ? { cursor } : {}) }),
      });
      if (!res.ok) return null;
      const out = (await res.json()) as { rewritten: number; cursor?: string };
      rewritten += out.rewritten;
      if (!out.cursor) return rewritten;
      cursor = out.cursor;
    }
  } catch {
    return null;
  }
  return null;
}
