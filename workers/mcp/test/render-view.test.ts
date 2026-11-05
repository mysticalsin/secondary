import { beforeEach, describe, expect, it } from "vitest";
import { sanitizeViewPlan } from "../src/view/plan.ts";
import { VIEW_HTML } from "../src/view/ui.ts";
import {
  apiCalls,
  auditEvents,
  callTool,
  clearApiCalls,
  clearAudit,
  getToken,
  type Loose,
  rpc,
} from "./helpers.ts";

beforeEach(async () => {
  await clearAudit();
  await clearApiCalls();
});

const ALL_EIGHT = {
  version: 1,
  title: "Account review",
  components: [
    { type: "KpiRow", props: { lens: "departments", metrics: ["items", "open"] } },
    { type: "NodeCard", props: { nodeId: "a_acme" } },
    {
      type: "ItemList",
      props: { nodeId: "c_bid:pricing-models", filter: { evidence: "supported" }, limit: 5 },
    },
    { type: "AccountSummary", props: { accountId: "a_acme" } },
    { type: "StageBoard", props: {} },
    { type: "MapMini", props: { lens: "departments" } },
    { type: "Callout", props: { template: "gap", tone: "warning" } },
    {
      type: "Table",
      props: {
        lens: "departments",
        columns: ["label", "items"],
        sort: { by: "items", dir: "desc" },
        limit: 10,
      },
    },
  ],
};

async function render(plan: unknown, scope = "secondary.read") {
  const t = await getToken({ scope });
  return callTool(t.token as string, "render_view", { viewPlan: plan });
}
const result = (r: { json: Loose }) => r.json?.result;

describe("render_view", () => {
  it("renders all 8 catalog components from data resolved as the caller", async () => {
    const r = await render(ALL_EIGHT);
    const res = result(r);
    expect(res.isError).toBeUndefined();
    const view = res.structuredContent.view;
    expect(view.title).toBe("Account review");
    expect(view.dropped).toEqual([]);
    expect(view.components.map((c: Loose) => [c.type, c.status])).toEqual(
      ALL_EIGHT.components.map((c) => [c.type, "ok"]),
    );
    const byType = Object.fromEntries(view.components.map((c: Loose) => [c.type, c.data]));
    expect(byType.KpiRow.metrics).toEqual([
      { key: "items", label: "Items", value: 12 },
      { key: "open", label: "Open", value: 2 },
    ]);
    expect(byType.NodeCard).toMatchObject({
      id: "a_acme",
      label: "Acme",
      plane: "ACCOUNT_RESTRICTED",
    });
    expect(byType.ItemList.items).toHaveLength(1); // evidence filter applied
    expect(byType.AccountSummary.sections[0]).toMatchObject({ label: "Relationship", count: 2 });
    expect(byType.StageBoard.governances[0]).toMatchObject({ label: "Data & AI" });
    expect(byType.MapMini.hubs).toHaveLength(2);
    expect(byType.Callout.message).toMatch(/gap/i);
    expect(byType.Table.rows[0]).toMatchObject({ label: "Bid & Pre-sales", items: 12 });
    // every datum came through the signed API path as the caller
    const calls = await apiCalls();
    expect(calls.length).toBeGreaterThan(0);
    expect(
      calls.every(
        (c) => c.principal?.tool === "render_view" && c.principal.email === "alice@example.invalid",
      ),
    ).toBe(true);
    // identical reads are fetched once
    const paths = calls.map((c) => c.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("returns a markdown fallback for hosts without MCP Apps", async () => {
    const text = result(await render(ALL_EIGHT)).content[0].text as string;
    expect(text).toContain("## Account review");
    expect(text).toContain("Items: 12 | Open: 2");
    expect(text).toContain("| label | items |");
    expect(text.length).toBeLessThan(4000);
  });

  it("drops component types that are not in the catalog and says so", async () => {
    const r = await render({
      version: 1,
      title: "Mixed",
      components: [
        { type: "RawHtml", props: { html: "<script>alert(1)</script>" } },
        { type: "KpiRow", props: { lens: "departments" } },
        { type: "Iframe", props: { src: "https://evil.example" } },
      ],
    });
    const view = result(r).structuredContent.view;
    expect(view.components.map((c: Loose) => c.type)).toEqual(["KpiRow"]);
    expect(view.dropped).toEqual([
      { index: 0, type: "RawHtml" },
      { index: 2, type: "Iframe" },
    ]);
    expect(result(r).content[0].text).toContain("Dropped 2 component(s)");
  });

  it("rejects a plan with no catalog component, and calls no API", async () => {
    const r = await render({ version: 1, title: "x", components: [{ type: "Nope", props: {} }] });
    expect(result(r).isError).toBe(true);
    expect(result(r).content[0].text).toContain("invalid_view_plan");
    expect(await apiCalls()).toEqual([]);
  });

  it("rejects inline data props: queries only, never data", async () => {
    const bad: unknown[] = [
      { type: "Table", props: { lens: "departments", rows: [{ label: "Injected", items: 999 }] } },
      { type: "ItemList", props: { nodeId: "c_bid", items: [{ title: "Injected" }] } },
      { type: "Callout", props: { template: "empty", text: "free text from the model" } },
      { type: "KpiRow", props: { lens: "departments", values: { items: 1000000 } } },
      { type: "NodeCard", props: { nodeId: "a_acme", label: "Fake label", counts: { items: 1 } } },
      {
        type: "ItemList",
        props: { nodeId: "c_bid", filter: { evidence: "supported", title: "x" } },
      },
      { type: "Table", props: { rows: [] } },
    ];
    for (const c of bad) {
      const r = await render({ version: 1, title: "x", components: [c] });
      expect(result(r).isError, JSON.stringify(c)).toBe(true);
      expect(result(r).content[0].text).toContain("invalid_view_plan");
    }
    expect(await apiCalls()).toEqual([]);
  });

  it("rejects an inline-data plan even when valid components sit next to it", async () => {
    const r = await render({
      version: 1,
      title: "x",
      components: [
        { type: "KpiRow", props: { lens: "departments" } },
        { type: "Table", props: { lens: "departments", rows: [{ a: 1 }] } },
      ],
    });
    expect(result(r).isError).toBe(true);
    expect(await apiCalls()).toEqual([]);
  });

  it("a plan cannot raise permission: a denied node yields no data", async () => {
    const r = await render({
      version: 1,
      title: "Peek",
      components: [
        { type: "NodeCard", props: { nodeId: "denied" } },
        { type: "ItemList", props: { nodeId: "denied" } },
        { type: "NodeCard", props: { nodeId: "missing" } },
        { type: "KpiRow", props: { lens: "departments" } },
      ],
    });
    const comps = result(r).structuredContent.view.components;
    expect(comps.map((c: Loose) => c.status)).toEqual(["denied", "denied", "missing", "ok"]);
    expect(comps[0].data).toBeUndefined();
    expect(comps[1].data).toBeUndefined();
    expect(JSON.stringify(result(r))).not.toContain("Pricing models");
    expect(result(r).content[0].text).toContain("Not available to you");
  });

  it("audits ids and counts, no content", async () => {
    await render(ALL_EIGHT);
    const ev = (await auditEvents()).find((e) => e.action === "render_view");
    expect(ev).toMatchObject({ outcome: "ok", result_count: 8 });
    expect(ev?.scope_ids).toEqual(expect.arrayContaining(["a_acme", "c_bid:pricing-models"]));
    expect(JSON.stringify(ev)).not.toContain("Account review");
  });
});

describe("ViewPlan validator (precompiled, no runtime compile)", () => {
  const ok = (c: unknown) => sanitizeViewPlan({ version: 1, title: "t", components: [c] });
  it("accepts every catalog type and enforces schema limits", () => {
    for (const c of ALL_EIGHT.components) expect(ok(c).ok, c.type).toBe(true);
    expect(ok({ type: "ItemList", props: { nodeId: "c_bid", limit: 51 } }).ok).toBe(false);
    expect(ok({ type: "ItemList", props: { nodeId: "../x" } }).ok).toBe(false);
    expect(ok({ type: "ItemList", props: { nodeId: "A/B" } }).ok).toBe(false);
    expect(ok({ type: "MapMini", props: { lens: "secrets" } }).ok).toBe(false);
    expect(ok({ type: "Table", props: {} }).ok).toBe(false); // needs nodeId or lens
    expect(
      sanitizeViewPlan({ version: 2, title: "t", components: [{ type: "KpiRow", props: {} }] }).ok,
    ).toBe(false);
    expect(
      sanitizeViewPlan({ version: 1, title: "", components: [{ type: "KpiRow", props: {} }] }).ok,
    ).toBe(false);
    expect(
      sanitizeViewPlan({
        version: 1,
        title: "t",
        extra: 1,
        components: [{ type: "KpiRow", props: {} }],
      }).ok,
    ).toBe(false);
    expect(sanitizeViewPlan(null).ok).toBe(false);
    // garbage entries are dropped like unknown types; the SDK input schema already refuses them over the wire
    const garbage = sanitizeViewPlan({
      version: 1,
      title: "t",
      components: ["x", 7, null, { type: "KpiRow", props: {} }],
    });
    expect(garbage.ok && garbage.dropped.map((d) => d.index)).toEqual([0, 1, 2]);
    expect(sanitizeViewPlan({ version: 1, title: "t" }).ok).toBe(false);
  });
});

describe("ui://secondary/view resource", () => {
  it("is served with the MCP Apps mime type", async () => {
    const t = await getToken();
    const { json } = await rpc(t.token, "resources/read", { uri: "ui://secondary/view" });
    const c = json?.result.contents[0];
    expect(c.uri).toBe("ui://secondary/view");
    expect(c.mimeType).toBe("text/html;profile=mcp-app");
    expect(c.text).toBe(VIEW_HTML);
    expect(c._meta.ui.csp).toEqual({});
  });

  it("is self-contained, Mantu branded, and writes strings only through textContent", () => {
    expect(VIEW_HTML).not.toMatch(/<script[^>]*\ssrc=/i);
    expect(VIEW_HTML).not.toMatch(/<link\b|@import|url\(|<img\b|<iframe|<object|<embed/i);
    expect(VIEW_HTML).not.toMatch(
      /\bfetch\(|XMLHttpRequest|WebSocket|importScripts|eval\(|new Function|document\.write|innerHTML|outerHTML|insertAdjacentHTML/,
    );
    const urls = VIEW_HTML.match(/https?:\/\/[^\s"'<>)]+/g) ?? [];
    expect(urls).toEqual(["http://www.w3.org/2000/svg"]); // SVG namespace, not a network reference
    expect(VIEW_HTML).toContain("default-src 'none'");
    expect(VIEW_HTML).toMatch(/class="wm">mantu</);
    expect(VIEW_HTML).toContain("#6600AE");
    expect(VIEW_HTML).toContain("#F8F060");
    expect(VIEW_HTML).toContain("Carlito");
    for (const type of [
      "KpiRow",
      "NodeCard",
      "ItemList",
      "AccountSummary",
      "StageBoard",
      "MapMini",
      "Callout",
      "Table",
    ]) {
      expect(VIEW_HTML, type).toContain(`${type}:`);
    }
    expect(VIEW_HTML).toContain("ui/notifications/tool-result");
    expect(VIEW_HTML).toContain("ui/initialize");
  });
});
