// Audit receipts go to workers/audit through the AUDIT service binding. A receipt carries identity
// and counts only: who (opaque id), host client id, tool, policy scope ids, result count, outcome.
// Never titles, bodies, search text or any node content.

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

export async function writeAudit(env: Env, event: AuditEvent): Promise<boolean> {
  try {
    const res = await env.AUDIT.fetch("https://audit.internal/append", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ at: new Date().toISOString(), source: "secondary-mcp", ...event }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
