import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const receipt = (over: Record<string, unknown> = {}) => ({
  receiptId: `rcpt_${crypto.randomUUID()}`,
  at: new Date().toISOString(),
  tenantId: "tenant_alpha",
  principalId: "u_ceo",
  action: "comment",
  nodeId: "c_bid:pricing-models",
  scopeId: "c_bid",
  decision: "allow",
  reason: "Granted on Bid & Pre-sales",
  revision: 3,
  requestId: crypto.randomUUID(),
  ...over,
});

const call = (path: string, init: RequestInit = {}, headers: Record<string, string> = {}) =>
  exports.default.fetch(
    new Request(`https://audit.internal${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Audit-Key": path.startsWith("/receipts") ? env.AUDIT_KEY_READ : env.AUDIT_KEY_API,
        ...headers,
      },
    }),
  );

const append = (r: unknown, headers: Record<string, string> = {}) =>
  call("/append", { method: "POST", body: JSON.stringify(r) }, headers);

describe("audit worker", () => {
  it("appends a receipt as a JSON line in R2, keyed by date and tenant", async () => {
    const r = receipt();
    const res = await append(r);
    expect(res.status).toBe(202);
    const { key } = (await res.json()) as { key: string };
    expect(key).toMatch(
      new RegExp(`^\\d{4}-\\d{2}-\\d{2}/tenant_alpha/\\d+-${r.receiptId}\\.jsonl$`),
    );
    const stored = await (await env.AUDIT_LOG.get(key))?.text();
    expect(stored?.endsWith("\n")).toBe(true);
    expect(JSON.parse(stored as string)).toMatchObject({
      receiptId: r.receiptId,
      principalId: "u_ceo",
    });
  });

  it("rejects public requests (edge sets CF-Connecting-IP) on every route", async () => {
    expect((await append(receipt(), { "CF-Connecting-IP": "203.0.113.9" })).status).toBe(403);
    expect(
      (
        await call(
          "/receipts?tenant=tenant_alpha&principal=u_ceo",
          {},
          { "CF-Connecting-IP": "203.0.113.9" },
        )
      ).status,
    ).toBe(403);
  });

  it("drops fields outside the allowlist, so content cannot ride along", async () => {
    const res = await append(receipt({ content: "SECRET-BODY", title: "SECRET-TITLE" }));
    const { key } = (await res.json()) as { key: string };
    const stored = await (await env.AUDIT_LOG.get(key))?.text();
    expect(stored).not.toContain("SECRET");
  });

  it("validates receipts and size", async () => {
    expect((await append(receipt({ decision: "maybe" }))).status).toBe(400);
    expect((await append(receipt({ principalId: "../x y" }))).status).toBe(400);
    expect((await append({ nope: 1 })).status).toBe(400);
    expect((await append(receipt({ reason: "x".repeat(5_000) }))).status).toBe(413);
    expect((await call("/append", { method: "POST", body: "{not json" })).status).toBe(400);
  });

  it("lists receipts for one principal in one tenant only", async () => {
    await append(receipt({ principalId: "u_target", action: "edit" }));
    await append(receipt({ principalId: "u_other" }));
    await append(receipt({ principalId: "u_target", tenantId: "tenant_beta" }));
    const res = await call("/receipts?tenant=tenant_alpha&principal=u_target");
    const { receipts } = (await res.json()) as {
      receipts: { principalId: string; tenantId: string }[];
    };
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ principalId: "u_target", tenantId: "tenant_alpha" });
    expect((await call("/receipts?tenant=tenant_alpha&principal=..%20x")).status).toBe(400);
    const all = (await (await call("/receipts?tenant=tenant_alpha")).json()) as {
      receipts: unknown[];
    };
    expect(all.receipts.length).toBeGreaterThan(1);
  });

  it("needs a valid key on every route (M4)", async () => {
    const r = receipt();
    expect((await append(r, { "X-Audit-Key": "" })).status).toBe(401);
    expect(
      (await append(r, { "X-Audit-Key": "wrong-key-wrong-key-wrong-key-wrong-key" })).status,
    ).toBe(401);
    expect((await call("/receipts?tenant=tenant_alpha", {}, { "X-Audit-Key": "" })).status).toBe(
      401,
    );
  });

  it("splits append and read keys, and stamps the source from the key", async () => {
    // The MCP worker can append but never read.
    const viaMcp = await append(receipt({ source: "api" }), { "X-Audit-Key": env.AUDIT_KEY_MCP });
    expect(viaMcp.status).toBe(202);
    const { key } = (await viaMcp.json()) as { key: string };
    const stored = JSON.parse((await (await env.AUDIT_LOG.get(key))?.text()) as string);
    expect(stored.source).toBe("mcp");
    expect(
      (await call("/receipts?tenant=tenant_alpha", {}, { "X-Audit-Key": env.AUDIT_KEY_MCP }))
        .status,
    ).toBe(403);
    expect(
      (await call("/receipts?tenant=tenant_alpha", {}, { "X-Audit-Key": env.AUDIT_KEY_API }))
        .status,
    ).toBe(403);
    // The read key cannot write.
    expect((await append(receipt(), { "X-Audit-Key": env.AUDIT_KEY_READ })).status).toBe(403);
  });

  it("has no update or delete route", async () => {
    for (const method of ["PUT", "PATCH", "DELETE"])
      expect((await call("/append", { method })).status).toBe(404);
  });
});
