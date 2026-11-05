import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import generated from "../src/generated/view-plan.validator.js?raw";
import { validateViewPlan } from "../src/genui.ts";
import { createApp } from "../src/index.ts";
import { detectSensitivity } from "../src/sensitivity.ts";
import { inJurisdiction } from "../src/stubs.ts";
import { publicJwk, rawEnv, sign, tenantDo, testEnv, wsOf } from "./helpers.ts";

const NOW = Date.UTC(2026, 10, 4, 12);
const HOUR = 3_600_000;
const ceoSeed = { id: "u_ceo", email: "ceo@example.invalid", roleIds: ["ceo"], memberships: [] };
const cfg = { tenantId: "tenant_unit", seed: 1, personalOwners: ["u_ceo"] };

describe("TenantPolicy", () => {
  it("resolves stored principals, unknown emails get no roles and a stable id", async () => {
    const t = tenantDo("tenant_unit_a");
    await t.seed(cfg, [{ ...ceoSeed, memberships: [{ scope_type: "circle", scope_id: "c_bid" }] }]);
    const known = await t.session({
      email: "CEO@example.invalid",
      actAs: null,
      now: NOW,
      limit: 100,
    });
    expect(known.principal).toMatchObject({
      id: "u_ceo",
      roleIds: ["ceo"],
      memberships: [{ scope_type: "circle", scope_id: "c_bid" }],
    });
    const a = await t.session({ email: "new@example.invalid", actAs: null, now: NOW, limit: 100 });
    const b = await t.session({ email: "NEW@example.invalid ", actAs: null, now: NOW, limit: 100 });
    expect(a.principal.roleIds).toEqual([]);
    expect(a.principal.id).toMatch(/^u_[0-9a-f]{16}$/);
    expect(b.principal.id).toBe(a.principal.id);
    expect(a.config).toEqual(cfg);
  });

  it("every directory change bumps the revocation epoch, and revokeAll removes access", async () => {
    const t = tenantDo("tenant_unit_b");
    await t.seed(cfg, [ceoSeed]);
    let e = await t.epoch();
    const step = async (n: number | null) => expect(n).toBe(++e);
    await step(await t.setRoles("u_ceo", ["auditor"]));
    await step(await t.addMembership("u_ceo", { scope_type: "account", scope_id: "a_acme" }));
    await step(await t.grantNda("u_ceo", "a_calypso"));
    await step(await t.elevate("u_ceo", 1, "Review", NOW));
    let s = await t.session({ email: "ceo@example.invalid", actAs: null, now: NOW, limit: 100 });
    expect(s).toMatchObject({ epoch: e, ndaGrants: ["a_calypso"], elevatedUntil: NOW + HOUR });
    expect(s.principal.roleIds).toEqual(["auditor"]);
    await step(await t.revokeAll("u_ceo"));
    s = await t.session({ email: "ceo@example.invalid", actAs: null, now: NOW, limit: 100 });
    expect(s).toMatchObject({ ndaGrants: [], elevatedUntil: null });
    expect(s.principal).toMatchObject({ roleIds: [], memberships: [] });
  });

  it("an elevation expires; it needs a reason and is capped at 24 hours", async () => {
    const t = tenantDo("tenant_unit_c");
    await t.seed(cfg, [ceoSeed]);
    await t.elevate("u_ceo", 3, "Incident", NOW);
    const at = (now: number) =>
      t.session({ email: "ceo@example.invalid", actAs: null, now, limit: 100 });
    expect((await at(NOW + 2 * HOUR)).elevatedUntil).toBe(NOW + 3 * HOUR);
    expect((await at(NOW + 3 * HOUR)).elevatedUntil).toBeNull();
    expect(await t.elevate("u_ceo", 1, "  ", NOW)).toBeNull();
    await t.elevate("u_ceo", 999, "Long", NOW);
    expect((await at(NOW + 1)).elevatedUntil).toBe(NOW + 24 * HOUR);
  });

  it("counts requests per window and resets", async () => {
    const t = tenantDo("tenant_unit_d");
    const hit = (now: number) =>
      t.session({ email: "x@example.invalid", actAs: null, now, limit: 2 });
    expect((await hit(NOW)).limited).toBe(false);
    expect((await hit(NOW)).limited).toBe(false);
    const third = await hit(NOW + 10_000);
    expect(third.limited).toBe(true);
    expect(third.retryAfter).toBeGreaterThan(0);
    expect((await hit(NOW + 61_000)).limited).toBe(false);
  });

  it("uses SQLite storage", async () => {
    const t = tenantDo("tenant_unit_e");
    await runInDurableObject(t, async (_i, state) => {
      const tables = state.storage.sql
        .exec("SELECT name FROM sqlite_master WHERE type = 'table'")
        .toArray()
        .map((r) => r.name);
      for (const n of [
        "principals",
        "role_assignments",
        "memberships",
        "nda_grants",
        "elevations",
        "revocation",
        "rate",
        "config",
      ])
        expect(tables).toContain(n);
    });
  });
});

describe("Workspace", () => {
  const row = (id: string, label: string, over: Record<string, unknown> = {}) => ({
    id,
    label,
    kind: "topic",
    plane: "TEAM_RESTRICTED",
    status: "approved",
    revision: 1,
    authorId: null as string | null,
    tags: [] as string[],
    reviewedBy2: false,
    ...over,
  });

  it("indexes labels with FTS5, supports prefixes, and re-seeding replaces the index", async () => {
    const w = wsOf("tenant_unit", "ws_fts");
    await w.seed(
      [row("n1", "Pricing models for bids"), row("n2", "Quality gates"), row("n3", "Price lists")],
      true,
      NOW,
    );
    expect((await w.search('"pric"*', 10)).map((h) => h.id).sort()).toEqual(["n1", "n3"]);
    expect((await w.search('"gates"*', 10)).map((h) => h.id)).toEqual(["n2"]);
    await w.seed([row("n2", "Release runbooks")], false, NOW);
    expect(await w.search('"gates"*', 10)).toEqual([]);
    expect((await w.search('"runbooks"*', 10)).map((h) => h.id)).toEqual(["n2"]);
    await w.seed([row("only", "Other")], true, NOW);
    expect(await w.search('"pric"*', 10)).toEqual([]);
    await runInDurableObject(w, async (_i, state) => {
      const rows = state.storage.sql
        .exec("SELECT name, sql FROM sqlite_master WHERE name = 'items_fts'")
        .toArray();
      expect(String(rows[0]?.sql)).toMatch(/fts5/i);
    });
  });

  it("enforces revisions, one approval per person and no self-approval on the data itself", async () => {
    const w = wsOf("tenant_unit", "ws_rules");
    const made = await w.create(
      {
        id: "cand:c_bid:aaaaaaaa",
        label: "Draft",
        kind: "candidate",
        plane: "GLOBAL_NONPERSONAL",
        origin: "candidate",
        status: "candidate",
        authorId: "u_author",
        body: "b",
        targetNode: "c_bid",
      },
      NOW,
    );
    expect(made).toMatchObject({ revision: 1, required: 2 });
    expect(
      await w.create(
        {
          id: "cand:c_bid:aaaaaaaa",
          label: "x",
          kind: "candidate",
          plane: "x",
          origin: "candidate",
          status: "candidate",
          authorId: "u",
          body: null,
        },
        NOW,
      ),
    ).toMatchObject({ ok: false, code: "exists" });
    expect(await w.approve("cand:c_bid:aaaaaaaa", 1, "u_author", NOW)).toMatchObject({
      ok: false,
      code: "self_approval",
    });
    expect(await w.approve("cand:c_bid:aaaaaaaa", 2, "u_a", NOW)).toMatchObject({
      ok: false,
      code: "conflict",
      currentRevision: 1,
    });
    expect(await w.approve("cand:c_bid:aaaaaaaa", 1, "u_a", NOW)).toMatchObject({
      ok: true,
      released: false,
      approvals: 1,
    });
    expect(await w.approve("cand:c_bid:aaaaaaaa", 1, "u_a", NOW)).toMatchObject({
      ok: false,
      code: "already_done",
    });
    // An edit starts a new revision with no approvals: the earlier approval does not carry over.
    expect(
      await w.edit("cand:c_bid:aaaaaaaa", 1, { title: "Draft v2" }, NOW, "u_author"),
    ).toMatchObject({
      ok: true,
      revision: 2,
    });
    expect(await w.get("cand:c_bid:aaaaaaaa")).toMatchObject({
      approvals: 0,
      revision: 2,
      label: "Draft v2",
    });
    expect(await w.approve("cand:c_bid:aaaaaaaa", 1, "u_b", NOW)).toMatchObject({
      ok: false,
      code: "conflict",
    });
    await w.approve("cand:c_bid:aaaaaaaa", 2, "u_a", NOW);
    expect(await w.approve("cand:c_bid:aaaaaaaa", 2, "u_b", NOW)).toMatchObject({
      ok: true,
      released: true,
      approvals: 2,
    });
    expect(await w.get("cand:c_bid:aaaaaaaa")).toMatchObject({
      status: "approved",
      reviewedBy2: true,
    });
    // Editing a released item sends it back to review.
    expect(
      await w.edit("cand:c_bid:aaaaaaaa", 2, { body: "changed" }, NOW, "u_author"),
    ).toMatchObject({
      ok: true,
      status: "candidate",
      revision: 3,
    });
  });

  it("H1: only the contributor edits a candidate, and an editor can never approve or review it", async () => {
    const w = wsOf("tenant_unit", "ws_h1");
    const id = "cand:c_bid:cccccccc";
    await w.create(
      {
        id,
        label: "x",
        kind: "candidate",
        plane: "TEAM_RESTRICTED",
        origin: "candidate",
        status: "candidate",
        authorId: "u_author",
        body: "b",
        targetNode: "c_bid",
      },
      NOW,
    );
    // A steward cannot rewrite a colleague's candidate...
    expect(await w.edit(id, 1, { body: "mine" }, NOW, "u_steward")).toMatchObject({
      ok: false,
      code: "not_author",
    });
    expect(await w.get(id)).toMatchObject({ revision: 1, body: "b" });
    // ...but the contributor can, and then still cannot approve or review it.
    expect(await w.edit(id, 1, { body: "b2" }, NOW, "u_author")).toMatchObject({ ok: true });
    expect(await w.approve(id, 2, "u_author", NOW)).toMatchObject({ code: "self_approval" });
    // A seeded item has no candidate rule, but whoever edits it counts as an author of it.
    await w.seed(
      [
        {
          id: "item_1",
          label: "Seeded",
          kind: "topic",
          plane: "TEAM_RESTRICTED",
          status: "approved",
          revision: 1,
          authorId: "u_other",
          tags: [],
          reviewedBy2: false,
        },
      ],
      false,
      NOW,
    );
    expect(await w.edit("item_1", 1, { title: "Seeded v2" }, NOW, "u_steward")).toMatchObject({
      ok: true,
      status: "candidate",
    });
    expect(await w.approve("item_1", 2, "u_steward", NOW)).toMatchObject({
      ok: false,
      code: "self_approval",
    });
    expect(await w.review("item_1", 2, "u_steward", "accept", NOW)).toMatchObject({
      ok: false,
      code: "self_approval",
    });
    expect(await w.approve("item_1", 2, "u_second", NOW)).toMatchObject({ ok: true });
  });

  it("writes an outbox row for contributions and releases", async () => {
    const w = wsOf("tenant_unit", "ws_outbox");
    await w.create(
      {
        id: "cand:c_bid:bbbbbbbb",
        label: "x",
        kind: "candidate",
        plane: "TEAM_RESTRICTED",
        origin: "candidate",
        status: "candidate",
        authorId: "u1",
        body: null,
        targetNode: "c_bid",
      },
      NOW,
    );
    await w.approve("cand:c_bid:bbbbbbbb", 1, "u2", NOW);
    expect((await w.outboxPending(10)).map((o) => o.kind)).toEqual([
      "candidate.created",
      "item.released",
    ]);
  });
});

describe("sensitivity detector", () => {
  const types = (t: string, b?: string) =>
    detectSensitivity({ title: t, ...(b ? { body: b } : {}) }).map((f) => f.type);

  it("flags emails, phone numbers and health, family and HR wording", () => {
    expect(types("Call", "a.b@example.invalid")).toEqual(["email"]);
    expect(types("x", "+33 6 12 34 56 78")).toEqual(["phone"]);
    expect(types("x", "(514) 555-0199")).toEqual(["phone"]);
    expect(types("My diagnosis and sick leave")).toEqual(expect.arrayContaining(["health"]));
    expect(types("Because my daughter is ill")).toEqual(["family"]);
    expect(types("Salary review and layoffs")).toEqual(["hr", "hr"]);
  });

  it("leaves ordinary work text alone", () => {
    expect(
      types(
        "Pricing models for fixed-fee bids",
        "Dates like 2026-11-04 and ids BID-26-45, version 1.2.3, 4 items.",
      ),
    ).toEqual([]);
  });

  it("is deterministic, ordered and gives stable ids and short excerpts", () => {
    const input = { title: "Salary", body: "mail me at someone@example.invalid" };
    const a = detectSensitivity(input);
    expect(detectSensitivity(input)).toEqual(a);
    expect(a.map((f) => f.id)).toEqual(["hr:title:0", "email:body:11"]);
    expect(
      detectSensitivity({ title: "x", body: `${"y".repeat(50)}@${"z".repeat(60)}.com` })[0]?.excerpt
        .length,
    ).toBeLessThanOrEqual(40);
  });
});

describe("GenUI validator", () => {
  const ok = {
    version: 1,
    title: "T",
    components: [{ type: "NodeCard", props: { nodeId: "core" } }],
  };

  it("accepts a catalog plan and rejects anything else", () => {
    expect(validateViewPlan(ok)).toBe(true);
    const bad: unknown[] = [
      { ...ok, version: 2 },
      { ...ok, title: "" },
      { ...ok, extra: 1 },
      { ...ok, components: [] },
      { ...ok, components: Array.from({ length: 13 }, () => ok.components[0]) },
      { ...ok, components: [{ type: "Script", props: { code: "alert(1)" } }] },
      { ...ok, components: [{ type: "NodeCard", props: { nodeId: "core", html: "<b>" } }] },
      { ...ok, components: [{ type: "NodeCard", props: { nodeId: "../core" } }] },
      { ...ok, components: [{ type: "NodeCard", props: {} }] },
      { ...ok, components: [{ type: "Callout", props: { template: "free text here" } }] },
      null,
      "plan",
    ];
    for (const b of bad) expect(validateViewPlan(b), JSON.stringify(b)).toBe(false);
  });

  it("is precompiled: the module holds no runtime compiler", () => {
    expect(generated).not.toMatch(/new Function|new Ajv|\beval\(|require\(/);
    expect(generated).toContain("export default");
  });
});

describe("jurisdiction", () => {
  const ns = (calls: string[]) =>
    ({
      jurisdiction: (j: string) => {
        calls.push(j);
        return "scoped";
      },
    }) as unknown as DurableObjectNamespace;
  it("is EU unless a dev run explicitly turns it off", () => {
    const c: string[] = [];
    inJurisdiction({ ENVIRONMENT: "prod", DO_JURISDICTION: "eu" }, ns(c));
    inJurisdiction({ ENVIRONMENT: "prod", DO_JURISDICTION: "off" }, ns(c));
    inJurisdiction({ ENVIRONMENT: "dev" }, ns(c));
    inJurisdiction({ ENVIRONMENT: "dev", DO_JURISDICTION: "eu" }, ns(c));
    expect(c).toEqual(["eu", "eu", "eu", "eu"]);
    const off = inJurisdiction({ ENVIRONMENT: "dev", DO_JURISDICTION: "off" }, ns(c));
    expect(c).toHaveLength(4);
    expect(off).toBeDefined();
  });
});

describe("remote JWKS", () => {
  it("fetches the team's certs URL when no test key resolver is injected", async () => {
    const team = "remote-test.cloudflareaccess.com";
    const seen: string[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith("https://remote-test.")) {
        seen.push(url);
        return Response.json({ keys: [publicJwk] });
      }
      return real(input, init);
    }) as typeof fetch;
    try {
      const token = await sign("remote@example.invalid", { iss: `https://${team}` });
      const res = await createApp().fetch(
        new Request("https://secondary.example.test/v1/me", {
          headers: { "Cf-Access-Jwt-Assertion": token },
        }),
        testEnv({ ACCESS_TEAM_DOMAIN: team }),
      );
      expect(res.status).toBe(200);
      expect(seen).toEqual([`https://${team}/cdn-cgi/access/certs`]);
    } finally {
      globalThis.fetch = real;
    }
    expect(rawEnv).toBeDefined();
  });
});
