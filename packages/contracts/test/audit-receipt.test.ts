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

  it("carries the brain rule and replay metadata, from a fixed vocabulary, and nothing else", () => {
    const meta = {
      action: "export",
      actor: "agent",
      host: "claude",
      brainId: "c_bid",
      brainType: "team",
      flags: ["client_name"],
      pages: 60,
      contract: "unknown",
      expiresAfterMin: null,
      content: "SECRET",
    };
    const r = parseReceipt({ ...base(), rule: "r_ab12@3", ruleMode: "monitor", meta }, "api");
    expect(r?.rule).toBe("r_ab12@3");
    expect(r?.ruleMode).toBe("monitor");
    expect(r?.meta).toEqual({
      action: "export",
      actor: "agent",
      host: "claude",
      brainId: "c_bid",
      brainType: "team",
      flags: ["client_name"],
      pages: 60,
      contract: "unknown",
      expiresAfterMin: null,
    });
    expect(JSON.stringify(r)).not.toContain("SECRET");
    // Receipts without them still parse, with nulls.
    expect(parseReceipt(base(), "api")).toMatchObject({ rule: null, ruleMode: null, meta: null });
    for (const bad of [
      { rule: "no version" },
      { ruleMode: "live" },
      { meta: { ...meta, action: "delete_everything" } },
      { meta: { ...meta, flags: ["a secret note"] } },
      { meta: { ...meta, host: "evil" } },
      { meta: { ...meta, pages: -1 } },
      { meta: "text" },
    ])
      expect(parseReceipt({ ...base(), ...bad }, "api")).toBeNull();
  });

  it("L-4: only the API's receipts can name a rule or carry replay metadata", () => {
    const meta = {
      action: "export",
      actor: "agent",
      host: "claude",
      brainId: "c_bid",
      brainType: "team",
      flags: [],
      pages: 60,
      contract: null,
      expiresAfterMin: null,
    };
    const forged = { ...base(), rule: "r_ab12@3", ruleMode: "enforced", meta };
    expect(parseReceipt(forged, "mcp")).toMatchObject({ rule: null, ruleMode: null, meta: null });
    expect(parseReceipt(forged, "api")).toMatchObject({ rule: "r_ab12@3", ruleMode: "enforced" });
  });
});
