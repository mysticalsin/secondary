import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { parseReceipt } from "../../../packages/contracts/src/audit-receipt.ts";
import { type AuditEvent, toReceipt } from "../src/audit.ts";

// H2 (security review): MCP audit events must satisfy the audit worker's real parser.

const events: AuditEvent[] = [
  {
    kind: "mcp.tool_call",
    action: "search",
    who: "dev-1a2b3c4d5e6f7a8b",
    client_id: "https://client.example/metadata.json",
    oauth_scopes: ["secondary.read"],
    scope_ids: ["c_bid:pricing-models", "a_acme"],
    result_count: 3,
    outcome: "ok",
  },
  { kind: "mcp.tool_call", action: "get_node", outcome: "denied", reason: "insufficient_scope" },
  {
    kind: "mcp.oauth",
    action: "authorize.rejected",
    outcome: "denied",
    reason: "redirect_host_not_allowed",
    redirect_host: "evil.example",
  },
  { kind: "mcp.oauth", action: "authorize.approve", who: "access-sub-1", outcome: "ok" },
  { kind: "mcp.oauth", action: "register.rejected", outcome: "error", reason: "x" },
];

describe("MCP audit events against the shared receipt parser (H2)", () => {
  for (const ev of events) {
    it(`${ev.action} becomes a valid receipt`, async () => {
      const wire = JSON.parse(JSON.stringify(await toReceipt(env, ev)));
      const parsed = parseReceipt(wire, "mcp");
      expect(parsed).not.toBeNull();
      expect(parsed?.source).toBe("mcp");
      expect(parsed?.tenantId).toBe("tenant_mantu_synthetic");
    });
  }

  it("hashes a URL client id and keeps content out", async () => {
    const r = await toReceipt(env, events[0] as AuditEvent);
    expect(r.clientId).toMatch(/^h_[0-9a-f]{16}$/);
    expect(JSON.stringify(r)).not.toContain("client.example");
  });

  it("the pre-fix event shape is refused by the parser", () => {
    const old = { at: new Date().toISOString(), source: "secondary-mcp", ...events[0] };
    expect(parseReceipt(old, "mcp")).toBeNull();
  });
});
