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
): Promise<StoredReceipt[] | null> {
  try {
    const q = new URLSearchParams({ tenant: tenantId, days: String(days) });
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
