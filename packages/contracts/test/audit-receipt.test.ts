import { describe, expect, it } from "vitest";
import { newReceiptId, parseReceipt } from "../src/audit-receipt.ts";

const base = () => ({
  receiptId: newReceiptId(),
  at: new Date().toISOString(),
  tenantId: "tenant_alpha",
  principalId: "u_ceo",
  action: "comment",
  nodeId: "c_bid",
  scopeId: "c_bid",
  decision: "allow",
  reason: "Granted",
  revision: 3,
  requestId: crypto.randomUUID(),
});

describe("audit receipt contract", () => {
  it("accepts an API receipt and fills the MCP-only fields", () => {
    const r = parseReceipt(base(), "api");
    expect(r).toMatchObject({ source: "api", scopeIds: [], resultCount: null, oauthScopes: [] });
  });

  it("stamps source from the caller, whatever the body says", () => {
    expect(parseReceipt({ ...base(), source: "api" }, "mcp")?.source).toBe("mcp");
  });

  it("drops fields outside the allowlist", () => {
    const r = parseReceipt({ ...base(), content: "SECRET", title: "SECRET" }, "api");
    expect(JSON.stringify(r)).not.toContain("SECRET");
  });

  it("rejects malformed receipts", () => {
    for (const bad of [
      { ...base(), decision: "maybe" },
      { ...base(), principalId: "../x y" },
      { ...base(), action: "Bad Action!" },
      { ...base(), tenantId: "T" },
      { ...base(), scopeIds: ["ok", "has space"] },
      { ...base(), resultCount: -1 },
      { nope: 1 },
      null,
    ])
      expect(parseReceipt(bad, "api")).toBeNull();
  });
});
