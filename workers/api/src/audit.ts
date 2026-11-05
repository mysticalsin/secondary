// Client for workers/audit through the AUDIT service binding. Receipts carry who, what, where and
// the decision. They never carry content.

export type Receipt = {
  receiptId: string;
  at: string;
  tenantId: string;
  principalId: string;
  action: string;
  nodeId: string | null;
  scopeId: string | null;
  decision: "allow" | "deny" | "rejected";
  reason: string;
  revision: number | null;
  requestId: string | null;
  /** Set for calls that came through MCP. */
  clientId: string | null;
  tool: string | null;
};

const AUDIT_ORIGIN = "https://audit.internal";

export const newReceiptId = (): string => `rcpt_${crypto.randomUUID()}`;

/** True when the audit worker accepted the receipt. Callers that mutate fail closed on false. */
export async function appendReceipt(env: Env, r: Receipt): Promise<boolean> {
  try {
    const res = await env.AUDIT.fetch(`${AUDIT_ORIGIN}/append`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
): Promise<Receipt[] | null> {
  try {
    const q = new URLSearchParams({ tenant: tenantId, days: String(days) });
    if (principalId !== null) q.set("principal", principalId);
    const res = await env.AUDIT.fetch(`${AUDIT_ORIGIN}/receipts?${q}`);
    if (!res.ok) return null;
    return ((await res.json()) as { receipts: Receipt[] }).receipts;
  } catch {
    return null;
  }
}
