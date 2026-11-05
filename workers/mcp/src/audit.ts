// Audit receipts go to workers/audit through the AUDIT service binding. A receipt carries identity
// and counts only: who (opaque id), host client id, tool, policy scope ids, result count, outcome.
// Never titles, bodies, search text or any node content.

import type { Receipt } from "../../../packages/contracts/src/audit-receipt.ts";

export interface AuditEvent {
  kind: "mcp.tool_call" | "mcp.oauth";
  /** What happened: tool name, or "authorize.approve" / "authorize.deny" / "authorize.rejected" / "register.rejected". */
  action: string;
  /** Opaque user id (Access sub). Absent when the caller is not authenticated. */
  who?: string;
  client_id?: string;
  /** OAuth scopes on the token or in the consent. */
  oauth_scopes?: string[];
  /** Policy scope / node ids the call targeted (ids only). */
  scope_ids?: string[];
  result_count?: number;
  outcome: "ok" | "denied" | "error";
  /** Short machine reason, never user content. */
  reason?: string;
  /** Host of a rejected redirect URI. */
  redirect_host?: string;
}

const ID = /^[A-Za-z0-9_.:@-]{1,128}$/;

/** Client ids can be URLs (metadata documents). The receipt id grammar has no slash, so hash those. */
async function receiptId(v: string): Promise<string> {
  if (ID.test(v)) return v;
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v));
  return `h_${Array.from(new Uint8Array(d).slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

const DECISION = { ok: "allow", denied: "deny", error: "rejected" } as const;

/** Maps an MCP event onto the shared receipt contract (packages/contracts audit-receipt). */
export async function toReceipt(env: Env, event: AuditEvent, now = new Date()): Promise<Receipt> {
  return {
    receiptId: `rcpt_${crypto.randomUUID()}`,
    at: now.toISOString(),
    tenantId: env.DEFAULT_TENANT_ID,
    principalId: event.who ? await receiptId(event.who) : "anonymous",
    action: event.action
      .toLowerCase()
      .replace(/[^a-z_.]/g, "_")
      .slice(0, 40),
    nodeId: null,
    scopeId: null,
    decision: DECISION[event.outcome],
    reason: event.reason ?? "",
    revision: null,
    requestId: null,
    clientId: event.client_id ? await receiptId(event.client_id) : null,
    tool: event.kind === "mcp.tool_call" ? event.action.slice(0, 60) : null,
    scopeIds: (event.scope_ids ?? []).filter((s) => ID.test(s)).slice(0, 20),
    resultCount: event.result_count ?? null,
    oauthScopes: (event.oauth_scopes ?? [])
      .filter((s) => /^[a-z][a-z0-9_.]{0,59}$/.test(s))
      .slice(0, 20),
    redirectHost: event.redirect_host ? event.redirect_host.toLowerCase().slice(0, 255) : null,
    source: "mcp",
  };
}

/** True when the audit worker accepted the receipt. Tool calls fail closed on false. */
export async function writeAudit(env: Env, event: AuditEvent): Promise<boolean> {
  try {
    const receipt = await toReceipt(env, event);
    const res = await env.AUDIT.fetch("https://audit.internal/append", {
      method: "POST",
      headers: { "content-type": "application/json", "x-audit-key": env.AUDIT_KEY_MCP ?? "" },
      body: JSON.stringify(receipt),
    });
    return res.status === 202;
  } catch {
    return false;
  }
}
