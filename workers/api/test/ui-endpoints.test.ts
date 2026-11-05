import { beforeAll, describe, expect, it } from "vitest";
import { as, json, type Loose, seed } from "./helpers.ts";

beforeAll(async () => {
  await seed();
});

const act = (persona: string, body: unknown) => as(persona, "/v1/actions", { body });

describe("/v1/me capabilities", () => {
  it("tell the rail what to show", async () => {
    const cap = async (p: string) => (await json(await as(p, "/v1/me"))).capabilities;
    expect(await cap("platform_admin")).toEqual({ configure: true, review: false });
    expect(await cap("reviewer")).toEqual({ configure: false, review: true });
    expect(await cap("ceo")).toEqual({ configure: false, review: true });
    expect(await cap("auditor")).toEqual({ configure: false, review: false });
    expect(await cap("consultant")).toEqual({ configure: false, review: false });
  });
});

describe("accounts", () => {
  it("cards carry the web's fields", async () => {
    const cards = await json(await as("acme_lead", "/v1/accounts"));
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      id: "a_acme",
      name: "Acme Synthetic SA",
      country: "France",
      sector: "Retail",
      status: "Active",
      aiProcessing: "allowed",
      plane: "ACCOUNT_RESTRICTED",
    });
    expect(cards[0].region).toBeTruthy();
    expect(typeof cards[0].openItems).toBe("number");
    expect(typeof cards[0].stars).toBe("number");
    const ceo = await json(await as("ceo", "/v1/accounts"));
    expect(ceo.length).toBeGreaterThan(5);
    expect(ceo.map((a: { id: string }) => a.id)).not.toContain("a_calypso");
  });

  it("detail has sections of records; contacts only for members", async () => {
    const d = await json(await as("acme_lead", "/v1/accounts/a_acme"));
    expect(d.account.id).toBe("a_acme");
    expect(d.members).toBeNull();
    const keys = d.sections.map((s: { key: string }) => s.key);
    expect(keys).toEqual(expect.arrayContaining(["eng", "out", "con", "meetings", "bids"]));
    const rec = d.sections.find((s: { key: string }) => s.key === "eng").items[0];
    expect(rec).toMatchObject({
      id: expect.stringMatching(/^a_acme:eng:/),
      title: expect.any(String),
      revision: expect.any(String),
    });
    const story = d.sections
      .find((s: { key: string }) => s.key === "out")
      .items.find((i: Loose) => i.story);
    expect(story.story.external).toEqual({ available: true, reason: expect.any(String) });
    const ceo = await json(await as("ceo", "/v1/accounts/a_acme"));
    expect(ceo.sections.map((s: { key: string }) => s.key)).not.toContain("con");
    expect((await as("acme_lead", "/v1/accounts/a_ember")).status).toBe(404);
  });
});

describe("governances", () => {
  it("cards and detail", async () => {
    const cards = await json(await as("ceo", "/v1/governances"));
    const lbc = cards.find((g: { id: string }) => g.id === "g_lbc");
    expect(lbc).toMatchObject({
      label: "LittleBig Connection",
      group: "Business line",
      useCases: 92,
    });
    expect(Object.keys(lbc.stages)).toEqual([
      "Discover",
      "In design",
      "Building",
      "Piloting",
      "Deployed",
    ]);
    expect(Object.values(lbc.stages as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(92);
    expect(cards.find((g: { id: string }) => g.id === "g_it").group).toBe("Corporate function");
    const d = await json(await as("ceo", "/v1/governances/g_lbc"));
    expect(d.governance.id).toBe("g_lbc");
    expect(d.useCases).toHaveLength(92);
    expect(d.useCases[0]).toMatchObject({
      id: expect.any(String),
      stage: expect.any(String),
      evidence: expect.any(String),
    });
    expect((await as("ceo", "/v1/governances/nope")).status).toBe(404);
    const admin = await json(await as("platform_admin", "/v1/governances/g_lbc"));
    expect(admin.useCases).toEqual([]);
  });
});

describe("review", () => {
  it("returns candidates with diff, flags, two-person state and what the caller may do", async () => {
    const q = await json(await as("reviewer", "/v1/review"));
    const c = q.find((x: { nodeId: string }) => x.nodeId === "c_bid:pricing-models");
    expect(c).toMatchObject({
      title: "Pricing models",
      scopeLabel: "Pricing models",
      plane: "TEAM_RESTRICTED",
      author: "u_head_bid",
      previousRevision: expect.anything(),
      flags: [],
      twoPerson: { required: false, approvals: 0, needed: 1 },
      approve: { allowed: true },
      requestChanges: { allowed: true },
    });
    expect(c.diff[0]).toEqual({ type: "add", text: expect.any(String) });
    expect(typeof c.revision).toBe("string");
    expect(Date.parse(c.submittedAt)).toBeGreaterThan(0);
  });

  it("request changes goes through the review action", async () => {
    const q = await json(await as("reviewer", "/v1/review"));
    const c = q.find((x: { nodeId: string }) => x.nodeId === "c_delivery:quality-gates");
    const r = await act("reviewer", {
      nodeId: c.nodeId,
      action: "review",
      revision: Number(c.revision),
      payload: { verdict: "changes_requested" },
    });
    expect(r.status).toBe(200);
  });
});

describe("personal items and server-side flags", () => {
  it("returns the web shape, kind, targets and contribution history", async () => {
    const made = await as("ceo", "/v1/personal/items", {
      body: { title: "Offsite brief", body: "Plain text", kind: "brief" },
    });
    expect(made.status).toBe(201);
    const item = await json(made);
    expect(item).toMatchObject({ title: "Offsite brief", body: "Plain text", kind: "brief" });
    expect(Date.parse(item.updatedAt)).toBeGreaterThan(0);
    expect(
      (await as("ceo", "/v1/personal/items", { body: { title: "x", kind: "poem" } })).status,
    ).toBe(400);
    const targets = await json(await as("ceo", "/v1/personal/targets"));
    expect(targets.map((t: { id: string }) => t.id)).toEqual(
      expect.arrayContaining(["c_bid", "a_acme"]),
    );
    expect(targets[0]).toEqual({
      id: expect.any(String),
      label: expect.any(String),
      group: expect.any(String),
    });
    const ok = await as("ceo", `/v1/personal/items/${item.id}/contribute`, {
      body: {
        targetScopeId: "c_bid",
        user_validated: { by: "u_ceo", at: new Date().toISOString(), revision: item.revision },
      },
    });
    expect(ok.status).toBe(201);
    const { candidateId } = await json(ok);
    const list = await json(await as("ceo", "/v1/personal/items"));
    expect(list.find((i: { id: string }) => i.id === item.id).contributedTo).toEqual([
      { scopeId: "c_bid", candidateId, at: expect.any(String) },
    ]);
  });

  it("ignores any flags or scan result the client sends", async () => {
    const item = await json(
      await as("ceo", "/v1/personal/items", {
        body: { title: "Contact", body: "write to jo@example.invalid" },
      }),
    );
    expect(item.sensitivity_flags.map((f: { type: string }) => f.type)).toEqual(["email"]);
    const res = await as("ceo", `/v1/personal/items/${item.id}/contribute`, {
      body: {
        targetScopeId: "c_bid",
        user_validated: { by: "u_ceo", at: new Date().toISOString(), revision: item.revision },
        sensitivity_flags: [],
        flags: [],
        scanned: true,
        acknowledged_flags: [],
      },
    });
    expect(res.status).toBe(422);
    expect((await json(res)).error).toBe("sensitivity_flags_pending");
    // Direct contribute through /v1/actions is scanned the same way.
    const direct = await act("ceo", {
      nodeId: "c_bid",
      action: "contribute",
      payload: {
        title: "Call +33 6 12 34 56 78",
        sensitivity_flags: [],
        user_validated: { by: "u_ceo", at: new Date().toISOString(), revision: 1 },
      },
    });
    expect(direct.status).toBe(422);
    // Flags shown to a reviewer are the stored server scan.
    const ack = await as("ceo", `/v1/personal/items/${item.id}/contribute`, {
      body: {
        targetScopeId: "c_bid",
        user_validated: { by: "u_ceo", at: new Date().toISOString(), revision: item.revision },
        acknowledged_flags: ["email:body:9"],
      },
    });
    expect(ack.status).toBe(201);
    const q = await json(await as("reviewer", "/v1/review"));
    const cand = q.find((x: { title: string }) => x.title === "Contact");
    expect(cand.flags).toEqual([
      { kind: "email", span: "jo@example.invalid", reason: expect.any(String) },
    ]);
  });
});

describe("admin", () => {
  it("roles list with member counts, for platform admin and auditor only", async () => {
    const roles = await json(await as("platform_admin", "/v1/admin/roles"));
    expect(roles).toHaveLength(7);
    expect(roles.find((r: { id: string }) => r.id === "ceo")).toMatchObject({
      label: "CEO",
      members: 1,
      grants: expect.any(Array),
      exclusions: expect.any(Array),
      never: expect.any(Array),
    });
    expect((await as("auditor", "/v1/admin/roles")).status).toBe(200);
    for (const p of ["ceo", "head_bid", "reviewer", "consultant", "acme_lead"])
      expect((await as(p, "/v1/admin/roles")).status, p).toBe(403);
  });

  it("audit lists the tenant's recent receipts without content", async () => {
    await act("consultant", { nodeId: "c_bid", action: "comment", payload: { text: "SECRET-77" } });
    await act("ceo", { nodeId: "core", action: "comment", payload: { text: "SECRET-78" } });
    const rows = await json(await as("platform_admin", "/v1/admin/audit"));
    expect(rows.length).toBeGreaterThan(1);
    expect(rows[0]).toMatchObject({
      id: expect.stringMatching(/^rcpt_/),
      at: expect.any(String),
      actor: expect.any(String),
      action: expect.any(String),
      scope: expect.any(String),
      result: expect.stringMatching(/allow|deny|rejected/),
      // The console's audit viewer also shows the server's reason code (never content).
      reason: expect.any(String),
    });
    expect(JSON.stringify(rows)).not.toContain("SECRET");
    for (const p of ["ceo", "head_bid", "consultant"])
      expect((await as(p, "/v1/admin/audit")).status, p).toBe(403);
  });
});

describe("activity", () => {
  it("lists recent edits and releases in scopes the caller can read", async () => {
    const node = "c_sales:renewal-motions";
    const detail = await json(await as("acme_lead", `/v1/nodes/${node}`));
    await act("acme_lead", {
      nodeId: node,
      action: "edit",
      revision: detail.record.revision,
      payload: { title: "Renewal motions v2" },
    });
    const mine = await json(await as("acme_lead", "/v1/activity"));
    expect(mine[0]).toMatchObject({
      title: "Renewal motions v2",
      nodeId: node,
      revision: String(detail.record.revision + 1),
      scopeLabel: expect.any(String),
    });
    expect(Date.parse(mine[0].at)).toBeGreaterThan(0);
    const ceo = await json(await as("ceo", "/v1/activity"));
    expect(ceo.map((e: { nodeId: string }) => e.nodeId)).toContain(node);
    // No one without content access to that circle sees it.
    for (const p of ["consultant", "platform_admin", "auditor"]) {
      const a = await json(await as(p, "/v1/activity"));
      expect(
        a.map((e: { nodeId: string }) => e.nodeId),
        p,
      ).not.toContain(node);
    }
  });
});
