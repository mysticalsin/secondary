// Client for workers/audit through the AUDIT service binding. Receipts carry who, what, where and
// the decision. They never carry content.

import {
  newReceiptId as newId,
  type Receipt as StoredReceipt,
} from "../../packages/contracts/src/audit-receipt.ts";
import {
  decodeReceiptCursor,
  type ReceiptErase,
} from "../state/erasure-request.ts";

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

function scanFrom(prior: ReceiptErase | null): { rewritten: number; cursor?: string; done: boolean } {
  if (!prior || prior.tag === "rejected" || !("rewritten" in prior)) return { rewritten: 0, done: false };
  if (prior.tag === "done") return { rewritten: prior.rewritten, done: true };
  if (prior.cursor) return { rewritten: prior.rewritten, cursor: prior.cursor, done: false };
  return { rewritten: 0, done: false };
}

/**
 * Right to erasure: ask workers/audit to replace a principal id with its pseudonym in every stored
 * receipt of the tenant. Each saved page is the next cursor. A finished scan does not run again.
 * A missing or unusable cursor starts at the first page. The caller persists each page.
 */
export async function pseudonymiseReceipts(
  env: Env,
  tenantId: string,
  from: string,
  to: string,
  prior: ReceiptErase | null,
  persist: (result: ReceiptErase) => Promise<void>,
): Promise<ReceiptErase> {
  const start = scanFrom(prior);
  if (start.done) return { tag: "done", rewritten: start.rewritten };
  let rewritten = start.rewritten;
  let cursor = start.cursor;
  const failed = (
    reason: "unavailable" | "refused" | "malformed",
  ): ReceiptErase => ({ tag: "failed", reason, rewritten, cursor: cursor ?? null });
  // Each page is one subrequest; a Worker may make 1000, and the other steps of an erase need some.
  for (let page = 0; page < MAX_ERASE_PAGES; page++) {
    let res: Response;
    try {
      res = await env.AUDIT.fetch(`${AUDIT_ORIGIN}/pseudonymise`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Audit-Key": env.AUDIT_KEY_ERASE ?? "" },
        body: JSON.stringify({ tenant: tenantId, from, to, ...(cursor ? { cursor } : {}) }),
      });
    } catch {
      return failed("unavailable");
    }
    if (!res.ok) return failed("refused");
    let out: unknown;
    try {
      out = await res.json();
    } catch {
      return failed("malformed");
    }
    if (!out || typeof out !== "object") return failed("malformed");
    const body = out as { rewritten?: unknown; cursor?: unknown };
    if (typeof body.rewritten !== "number" || !Number.isSafeInteger(body.rewritten) || body.rewritten < 0)
      return failed("malformed");
    rewritten += body.rewritten;
    if (body.cursor === undefined || body.cursor === null) {
      const done: ReceiptErase = { tag: "done", rewritten };
      await persist(done);
      return done;
    }
    const next = decodeReceiptCursor(body.cursor);
    if (!next) return failed("malformed");
    cursor = next;
    await persist({ tag: "partial", rewritten, cursor });
  }
  if (!cursor) return failed("malformed");
  const partial: ReceiptErase = { tag: "partial", rewritten, cursor };
  await persist(partial);
  return partial;
}
