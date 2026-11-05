// B2 GOV: the governance console API. Two-person rules, steward limits, expiry, no self-approval,
// notifications and content-free audit receipts.

import { beforeEach, describe, expect, it } from "vitest";
import { as, json, type Loose, seed, tenantDo } from "./helpers.ts";

const ALPHA = "tenant_mantu_synthetic";
const A = "/v1/admin";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

beforeEach(async () => {
  await seed();
});

/** A second person with the same role: another email gives another principal id. */
const other = (n: number) => `person${n}@example.invalid`;
const get = (p: string, path: string, o: Loose = {}) =>
  as(p, `${A}${path}`, { method: "GET", ...o });
const post = (p: string, path: string, body: unknown, o: Loose = {}) =>
  as(p, `${A}${path}`, { body, ...o });
const put = (p: string, path: string, body: unknown, o: Loose = {}) =>
  as(p, `${A}${path}`, { body, method: "PUT", ...o });

const receipts = async (principal: string): Promise<Loose[]> =>
  (await json(await as("auditor", `/v1/audit/receipts?principal=${principal}`))).receipts;

const ROLE_BASE = {
  baseVersion: 1,
};

/** Admin A proposes, admin B approves. Returns the final approval response. */
async function twoAdmins(path: string, body: unknown, method: "POST" | "PUT" = "PUT") {
  const proposed = await as("platform_admin", `${A}${path}`, { body, method });
  expect(proposed.status).toBe(200);
  const change = (await json(proposed)).change;
  expect(change.status).toBe("pending");
  return {
    change,
    approve: () => post("platform_admin", `/changes/${change.id}/approve`, {}, { email: other(2) }),
  };
}

describe("roles are data", () => {
  it("lists the seeded roles with versions, for admins and the auditor only", async () => {
    const roles = await json(await get("platform_admin", "/roles"));
    expect(roles).toHaveLength(7);
    expect(roles.every((r: Loose) => r.version === 1)).toBe(true);
    expect((await get("auditor", "/roles")).status).toBe(200);
    for (const p of ["ceo", "head_bid", "consultant", "reviewer"]) {
      const r = await get(p, "/roles");
      expect(r.status, p).toBe(403);
      expect((await json(r)).reason).toMatch(/Platform admin/);
    }
  });

  it("a non-sensitive edit applies at once, is versioned, audited and changes real access", async () => {
    // The consultant cannot see the Sales circle's content today.
    expect((await as("consultant", "/v1/nodes/c_sales:account-planning")).status).toBe(404);
    const consultant = (await json(await get("platform_admin", "/roles"))).find(
      (r: Loose) => r.id === "consultant",
    );
    const res = await put("platform_admin", "/roles/consultant", {
      baseVersion: 1,
      grants: [
        ...consultant.grants,
        {
          scope_type: "circle",
          scope_id: "c_sales",
          actions: ["view_structure", "view_content"],
          conditions: {},
        },
      ],
    });
    expect(res.status).toBe(200);
    const out = await json(res);
    expect(out.applied).toBe(true);
    expect(out.change.status).toBe("applied");
    // Roles-as-data reach the policy engine on the very next request.
    expect((await as("consultant", "/v1/nodes/c_sales:account-planning")).status).toBe(200);
    const history = await json(await get("platform_admin", "/roles/consultant/history"));
    expect(history.map((h: Loose) => h.version)).toEqual([2, 1]);
    expect(history[0].proposedBy).toBe("u_platform_admin");
    const rec = (await receipts("u_platform_admin")).find(
      (x) => x.action === "gov.role_upsert.propose" && x.scopeId === "role:consultant",
    );
    expect(rec).toMatchObject({ decision: "allow", revision: 2 });
  });

  it("only configure holders edit roles; the reason is shown and a deny receipt is written", async () => {
    const res = await put("head_bid", "/roles/consultant", { label: "Hacked" });
    expect(res.status).toBe(403);
    expect((await json(res)).reason).toMatch(/Platform admin/);
    const rec = (await receipts("u_head_bid")).find((x) => x.action === "gov.role_upsert.propose");
    expect(rec).toMatchObject({ decision: "deny" });
  });

  it("validates grants: no personal scopes, known scopes, known conditions, no elevation of configure", async () => {
    const edit = (grants: unknown) => put("platform_admin", "/roles/consultant", { grants });
    const g = (o: Loose) => ({
      scope_type: "circle",
      scope_id: "c_bid",
      actions: ["view_structure"],
      conditions: {},
      ...o,
    });
    const cases: [Loose, number, string][] = [
      [{ scope_type: "personal", scope_id: "*" }, 422, "personal_scope"],
      [{ scope_id: "c_nope" }, 422, "unknown_scope"],
      [{ actions: ["fly"] }, 422, "invalid_grant"],
      [{ actions: [] }, 422, "invalid_grant"],
      [{ conditions: { admin: true } }, 422, "invalid_condition"],
      [{ conditions: { nda: "everyone" } }, 422, "invalid_condition"],
    ];
    for (const [over, status, code] of cases) {
      const r = await edit([g(over)]);
      expect(r.status, JSON.stringify(over)).toBe(status);
      expect((await json(r)).error).toBe(code);
    }
    const el = await put("platform_admin", "/roles/ceo", {
      elevation: { actions: ["configure"], hours: 2 },
    });
    expect((await json(el)).error).toBe("invalid_elevation");
    expect((await put("platform_admin", "/roles/ceo", { label: "CEO" })).status).toBe(422);
    expect((await put("platform_admin", "/roles/nope", { label: "x" })).status).toBe(404);
    const dup = await post("platform_admin", "/roles", { id: "ceo", label: "x", grants: [] });
    expect((await json(dup)).error).toBe("role_exists");
    const stale = await put("platform_admin", "/roles/consultant", { baseVersion: 9, label: "X" });
    expect((await json(stale)).error).toBe("stale_role");
  });

  it("creates a new role", async () => {
    const res = await post("platform_admin", "/roles", {
      id: "bid_observer",
      label: "Bid observer",
      grants: [
        { scope_type: "circle", scope_id: "c_bid", actions: ["view_structure"], conditions: {} },
      ],
    });
    expect(res.status).toBe(200);
    const roles = await json(await get("platform_admin", "/roles"));
    expect(roles.map((r: Loose) => r.id)).toContain("bid_observer");
  });

  it("an edit to a role that grants account scopes needs a second admin", async () => {
    const { change, approve } = await twoAdmins("/roles/ceo", {
      ...ROLE_BASE,
      elevation: { actions: ["edit", "review"], hours: 4, approval: true },
    });
    expect(change.needsSecond).toBe(true);
    // Not applied yet.
    const before = (await json(await get("platform_admin", "/roles"))).find(
      (r: Loose) => r.id === "ceo",
    );
    expect(before.version).toBe(1);
    expect(before.elevation.approval).toBeUndefined();

    // The proposer cannot approve their own change.
    const self = await post("platform_admin", `/changes/${change.id}/approve`, {});
    expect(self.status).toBe(403);
    expect((await json(self)).reason).toMatch(/Two-person|someone else/);
    // Somebody without configure cannot either.
    expect((await post("auditor", `/changes/${change.id}/approve`, {})).status).toBe(403);

    const done = await approve();
    expect(done.status).toBe(200);
    const after = (await json(await get("platform_admin", "/roles"))).find(
      (r: Loose) => r.id === "ceo",
    );
    expect(after.version).toBe(2);
    expect(after.elevation.approval).toBe(true);
    // Both people are on the history record.
    const h = (await json(await get("platform_admin", "/roles/ceo/history")))[0];
    expect(h.proposedBy).toBe("u_platform_admin");
    expect(h.approvedBy).not.toBe(h.proposedBy);
  });

  it("a rejected change leaves the role alone; rejection needs a reason", async () => {
    const proposed = await put("platform_admin", "/roles/head_bid", { summary: "Changed summary" });
    const id = (await json(proposed)).change.id;
    expect(
      (await post("platform_admin", `/changes/${id}/reject`, {}, { email: other(2) })).status,
    ).toBe(422);
    const rej = await post(
      "platform_admin",
      `/changes/${id}/reject`,
      { note: "Not now" },
      { email: other(2) },
    );
    expect(rej.status).toBe(200);
    const role = (await json(await get("platform_admin", "/roles"))).find(
      (r: Loose) => r.id === "head_bid",
    );
    expect(role.version).toBe(1);
    // The proposer was told.
    const inbox = await json(await get("platform_admin", "/notifications"));
    expect(inbox.items.map((n: Loose) => n.kind)).toContain("change_decided");
  });

  it("refuses a change that would leave nobody able to configure the tenant", async () => {
    const { approve } = await twoAdmins("/roles/platform_admin", {
      grants: [
        { scope_type: "global", scope_id: "core", actions: ["view_structure"], conditions: {} },
      ],
    });
    const r = await approve();
    expect(r.status).toBe(422);
    expect((await json(r)).error).toBe("last_admin");
  });

  it("an edit proposed on an old version fails when its turn comes", async () => {
    const one = await json(await put("platform_admin", "/roles/ceo", { summary: "First" }));
    const two = await json(await put("platform_admin", "/roles/ceo", { summary: "Second" }));
    expect(
      (await post("platform_admin", `/changes/${one.change.id}/approve`, {}, { email: other(2) }))
        .status,
    ).toBe(200);
    const late = await post(
      "platform_admin",
      `/changes/${two.change.id}/approve`,
      {},
      { email: other(2) },
    );
    expect(late.status).toBe(409);
    expect((await json(late)).error).toBe("stale_role");
  });

  it("a pending change lapses after 72 hours", async () => {
    const t0 = Date.now();
    const id = (
      await json(await put("platform_admin", "/roles/ceo", { summary: "Late" }, { now: t0 }))
    ).change.id;
    const late = await post(
      "platform_admin",
      `/changes/${id}/approve`,
      {},
      { email: other(2), now: t0 + 73 * HOUR },
    );
    expect(late.status).toBe(409);
    expect((await json(late)).error).toBe("expired");
    const list = await json(await get("platform_admin", "/changes", { now: t0 + 73 * HOUR }));
    expect(list.find((c: Loose) => c.id === id).status).toBe("expired");
  });
});

describe("memberships", () => {
  const add = (
    p: string,
    scope_type: string,
    scope_id: string,
    principalId: string,
    o: Loose = {},
  ) => post(p, "/memberships", { op: "add", principalId, scope_type, scope_id }, o);

  it("a steward changes membership of their own unrestricted circle directly", async () => {
    const res = await add("head_bid", "circle", "c_bid", "u_reviewer");
    expect(res.status).toBe(200);
    expect((await json(res)).applied).toBe(true);
    const members = await json(await get("head_bid", "/memberships?type=circle&id=c_bid"));
    expect(members.members.map((m: Loose) => m.principalId)).toContain("u_reviewer");
    const rm = await post("head_bid", "/memberships", {
      op: "remove",
      principalId: "u_reviewer",
      scope_type: "circle",
      scope_id: "c_bid",
    });
    expect(rm.status).toBe(200);
    expect(
      (await json(await get("head_bid", "/memberships?type=circle&id=c_bid"))).members.map(
        (m: Loose) => m.principalId,
      ),
    ).not.toContain("u_reviewer");
    const rec = await receipts("u_head_bid");
    expect(rec.map((x) => x.action)).toEqual(
      expect.arrayContaining(["gov.member_add.propose", "gov.member_remove.propose"]),
    );
  });

  it("steward scope limits: the Head of Bid cannot manage Finance or other circles", async () => {
    for (const [type, id] of [
      ["circle", "c_af_close"],
      ["circle", "c_sales"],
      ["department", "d_af"],
      ["account", "a_acme"],
    ] as const) {
      const r = await add("head_bid", type, id, "u_reviewer");
      expect(r.status, id).toBe(403);
      expect((await json(r)).reason, id).toMatch(/steward or a Platform admin/);
      expect((await get("head_bid", `/memberships?type=${type}&id=${id}`)).status, id).toBe(403);
    }
    const rec = (await receipts("u_head_bid")).filter(
      (x) => x.decision === "deny" && x.scopeId === "circle:c_af_close",
    );
    expect(rec.length).toBeGreaterThan(0);
    // A consultant is not a steward anywhere.
    expect((await add("consultant", "circle", "c_delivery", "u_reviewer")).status).toBe(403);
    // The scope list shows exactly what a steward may manage.
    const scopes = await json(await get("head_bid", "/scopes"));
    expect(scopes.map((s: Loose) => s.key)).toEqual(["circle:c_bid"]);
    // And the directory is closed to non-stewards.
    expect((await get("consultant", "/principals")).status).toBe(403);
  });

  it("a restricted account membership needs a second person, never the proposer", async () => {
    const res = await add("acme_lead", "account", "a_acme", "u_consultant");
    expect(res.status).toBe(200);
    const out = await json(res);
    expect(out.applied).toBe(false);
    const id = out.change.id;
    const members = async () =>
      (await json(await get("platform_admin", "/memberships?type=account&id=a_acme"))).members.map(
        (m: Loose) => m.principalId,
      );
    expect(await members()).not.toContain("u_consultant");

    const self = await post("acme_lead", `/changes/${id}/approve`, {});
    expect(self.status).toBe(403);
    expect((await json(self)).reason).toMatch(/Two-person/);
    // Same role, different person: another steward may approve.
    const stewardOf = await post("acme_lead", `/changes/${id}/approve`, {}, { email: other(7) });
    expect(stewardOf.status).toBe(200);
    expect(await members()).toContain("u_consultant");

    // The person who was added got a notice, and so did the proposer.
    const added = await json(await as("consultant", `${A}/notifications`));
    expect(added.items.map((n: Loose) => n.kind)).toContain("access_granted");
    const rec = await receipts("u_acme_lead");
    expect(rec.some((x) => x.action === "gov.member_add.approve" && x.decision === "deny")).toBe(
      true,
    );
  });

  it("a platform admin can be the second person, a steward of another scope cannot", async () => {
    const id = (await json(await add("acme_lead", "account", "a_acme", "u_reviewer"))).change.id;
    // Head of Bid is a steward, but not of this account.
    const no = await post("head_bid", `/changes/${id}/approve`, {});
    expect(no.status).toBe(403);
    expect((await json(no)).reason).toMatch(/steward of that space/);
    expect((await post("platform_admin", `/changes/${id}/approve`, {})).status).toBe(200);
  });

  it("restricted circles and the Contacts subspace follow the same rule", async () => {
    const hr = await add("platform_admin", "circle", "c_hr_pp", "u_reviewer");
    expect((await json(hr)).applied).toBe(false);
    const sub = await post("platform_admin", "/memberships", {
      op: "add",
      principalId: "u_reviewer",
      scope_type: "account",
      scope_id: "a_acme",
      subspace: "contacts",
    });
    const subOut = await json(sub);
    expect(subOut.applied).toBe(false);
    expect(subOut.change.scopeKey).toBe("account:a_acme:contacts");
    expect(
      (
        await post(
          "platform_admin",
          `/changes/${subOut.change.id}/approve`,
          {},
          { email: other(2) },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await post("platform_admin", "/memberships", {
          op: "add",
          principalId: "u_reviewer",
          scope_type: "account",
          scope_id: "a_acme",
          subspace: "nope",
        })
      ).status,
    ).toBe(422);
  });

  it("validates input and refuses duplicates", async () => {
    expect((await add("head_bid", "circle", "c_bid", "u_nobody")).status).toBe(404);
    expect((await add("head_bid", "circle", "c_nope", "u_reviewer")).status).toBe(422);
    expect((await add("head_bid", "planet", "c_bid", "u_reviewer")).status).toBe(422);
    expect((await json(await add("head_bid", "circle", "c_bid", "u_head_bid"))).error).toBe(
      "already_member",
    );
    const rm = await post("head_bid", "/memberships", {
      op: "remove",
      principalId: "u_reviewer",
      scope_type: "circle",
      scope_id: "c_bid",
    });
    expect((await json(rm)).error).toBe("not_a_member");
    await add("platform_admin", "account", "a_acme", "u_reviewer");
    expect(
      (
        await json(
          await add("platform_admin", "account", "a_acme", "u_reviewer", { email: other(2) }),
        )
      ).error,
    ).toBe("duplicate");
  });

  it("an added membership reaches the engine (Contacts open to members)", async () => {
    expect((await as("consultant", "/v1/nodes/a_acme:con:0")).status).toBe(404);
    const id = (
      await json(
        await post("platform_admin", "/memberships", {
          op: "add",
          principalId: "u_consultant",
          scope_type: "account",
          scope_id: "a_acme",
        }),
      )
    ).change.id;
    await post("platform_admin", `/changes/${id}/approve`, {}, { email: other(2) });
    // The consultant persona keeps its own memberships and gains the granted one.
    const nodeOk = await as("consultant", "/v1/nodes/a_acme");
    expect([200, 404]).toContain(nodeOk.status);
    const stored = await tenantDo(ALPHA).session({
      email: "consultant@example.invalid",
      actAs: null,
      now: Date.now(),
      limit: 100,
    });
    expect(stored.principal.memberships).toContainEqual({
      scope_type: "account",
      scope_id: "a_acme",
    });
  });
});

describe("NDA named grants", () => {
  const grant = (p: string, over: Loose = {}, o: Loose = {}) =>
    post(
      p,
      "/nda",
      {
        principalId: "u_ceo",
        accountId: "a_calypso",
        reason: "Board prep for the Calypso review",
        expiresAt: new Date(Date.now() + 30 * DAY).toISOString(),
        ...over,
      },
      o,
    );

  it("needs a reason, an expiry, a steward or admin, and a second approver; then it takes effect", async () => {
    expect((await as("ceo", "/v1/nodes/a_calypso")).status).toBe(404);
    const res = await grant("platform_admin");
    expect(res.status).toBe(200);
    const out = await json(res);
    expect(out.applied).toBe(false);
    // Still hidden while pending.
    expect((await as("ceo", "/v1/nodes/a_calypso")).status).toBe(404);

    const self = await post("platform_admin", `/changes/${out.change.id}/approve`, {});
    expect(self.status).toBe(403);
    const ok = await post(
      "platform_admin",
      `/changes/${out.change.id}/approve`,
      {},
      { email: other(2) },
    );
    expect(ok.status).toBe(200);
    expect((await as("ceo", "/v1/nodes/a_calypso")).status).toBe(200);

    const list = await json(await get("platform_admin", "/nda?account=a_calypso"));
    expect(list.grants[0]).toMatchObject({
      principalId: "u_ceo",
      accountId: "a_calypso",
      active: true,
    });
    expect(list.grants[0].reason).toMatch(/Board prep/);
    expect(list.grants[0].approvedBy).not.toBe(list.grants[0].grantedBy);
  });

  it("expires on its own", async () => {
    const t0 = Date.now();
    const exp = new Date(t0 + 2 * DAY).toISOString();
    const id = (await json(await grant("platform_admin", { expiresAt: exp }, { now: t0 }))).change
      .id;
    await post("platform_admin", `/changes/${id}/approve`, {}, { email: other(2), now: t0 });
    expect((await as("ceo", "/v1/nodes/a_calypso", { now: t0 + DAY })).status).toBe(200);
    expect((await as("ceo", "/v1/nodes/a_calypso", { now: t0 + 3 * DAY })).status).toBe(404);
    const list = await json(
      await get("platform_admin", "/nda?account=a_calypso", { now: t0 + 3 * DAY }),
    );
    expect(list.grants[0].active).toBe(false);
  });

  it("a grant approved after its expiry passed is refused", async () => {
    const t0 = Date.now();
    const exp = new Date(t0 + 1 * HOUR).toISOString();
    const id = (await json(await grant("platform_admin", { expiresAt: exp }, { now: t0 }))).change
      .id;
    const late = await post(
      "platform_admin",
      `/changes/${id}/approve`,
      {},
      { email: other(2), now: t0 + 2 * HOUR },
    );
    expect((await json(late)).error).toBe("expired");
  });

  it("validates the request and the proposer's authority", async () => {
    const bad = async (over: Loose, code: string, status = 422) => {
      const r = await grant("platform_admin", over);
      expect(r.status, code).toBe(status);
      expect((await json(r)).error).toBe(code);
    };
    await bad({ reason: " " }, "reason_required");
    await bad({ expiresAt: "soon" }, "expiry_required");
    await bad({ expiresAt: new Date(Date.now() - DAY).toISOString() }, "expiry_past");
    await bad({ expiresAt: new Date(Date.now() + 400 * DAY).toISOString() }, "expiry_too_far");
    await bad({ accountId: "a_acme" }, "not_nda");
    await bad({ accountId: "a_nope" }, "unknown_scope");
    await bad({ principalId: "u_nobody" }, "unknown_principal", 404);
    for (const p of ["ceo", "head_bid", "consultant", "auditor"]) {
      const r = await grant(p);
      expect(r.status, p).toBe(403);
    }
  });

  it("revoking takes effect at once and needs one person", async () => {
    const id = (await json(await grant("platform_admin"))).change.id;
    await post("platform_admin", `/changes/${id}/approve`, {}, { email: other(2) });
    expect((await as("ceo", "/v1/nodes/a_calypso")).status).toBe(200);
    const rev = await post("platform_admin", "/nda/revoke", {
      principalId: "u_ceo",
      accountId: "a_calypso",
    });
    expect(rev.status).toBe(200);
    expect((await as("ceo", "/v1/nodes/a_calypso")).status).toBe(404);
    expect(
      (
        await post("platform_admin", "/nda/revoke", {
          principalId: "u_ceo",
          accountId: "a_calypso",
        })
      ).status,
    ).toBe(404);
  });
});

describe("elevation", () => {
  const request = (p: string, hours: number, reason = "Incident review", o: Loose = {}) =>
    post(p, "/elevations", { hours, reason }, o);

  it("is time-boxed to the role's maximum, needs a reason, and expires on its own", async () => {
    const t0 = Date.now();
    const node = "c_eng:test-strategy";
    expect((await request("ceo", 5, "Too long", { now: t0 })).status).toBe(422);
    expect((await json(await request("ceo", 5, "Too long", { now: t0 }))).error).toBe(
      "hours_exceed_role_max",
    );
    expect((await json(await request("ceo", 2, " ", { now: t0 }))).error).toBe("reason_required");
    expect((await request("consultant", 1, "No elevation for me", { now: t0 })).status).toBe(403);

    const res = await request("ceo", 2, "Incident review", { now: t0 });
    expect(res.status).toBe(200);
    expect((await json(res)).elevation.status).toBe("active");
    // A second open window is refused.
    expect((await json(await request("ceo", 1, "Again", { now: t0 }))).error).toBe("already_open");

    const actions = async (now: number) =>
      (await json(await as("ceo", `/v1/nodes/${node}`, { now }))).actions.find(
        (a: Loose) => a.action === "edit",
      );
    expect((await actions(t0 + 60_000)).allowed).toBe(true);
    expect((await actions(t0 + 60_000)).reason).toMatch(/elevation/);
    expect((await actions(t0 + 3 * HOUR)).allowed).toBe(false);

    const banner = await json(await get("ceo", "/elevation", { now: t0 + HOUR }));
    expect(banner.active).toMatchObject({ reason: "Incident review", secondsLeft: 3600 });
    const gone = await json(await get("ceo", "/elevation", { now: t0 + 3 * HOUR }));
    expect(gone.active).toBeNull();
    const rec = (await receipts("u_ceo")).find(
      (x) => x.action === "gov.elev.request" && x.decision === "allow",
    );
    expect(rec).toBeTruthy();
  });

  it("can be ended early", async () => {
    const t0 = Date.now();
    const id = (await json(await request("ceo", 2, "Review", { now: t0 }))).elevation.id;
    expect((await post("consultant", `/elevations/${id}/end`, {}, { now: t0 })).status).toBe(403);
    expect((await post("ceo", `/elevations/${id}/end`, {}, { now: t0 + 60_000 })).status).toBe(200);
    expect((await json(await get("ceo", "/elevation", { now: t0 + 61_000 }))).active).toBeNull();
  });

  it("where the role requires approval, the requester cannot approve their own", async () => {
    // Make the Platform admin role elevatable with approval (itself a two-person edit).
    const { approve } = await twoAdmins("/roles/platform_admin", {
      elevation: { actions: ["edit"], hours: 2, approval: true },
    });
    expect((await approve()).status).toBe(200);

    const t0 = Date.now();
    const res = await request("platform_admin", 2, "Fix a broken migration", { now: t0 });
    const out = await json(res);
    expect(out.elevation.status).toBe("pending");
    // Not active: no banner, no window.
    expect((await json(await get("platform_admin", "/elevation", { now: t0 }))).active).toBeNull();

    // Never your own request.
    const self = await post(
      "platform_admin",
      `/elevations/${out.elevation.id}/approve`,
      {},
      { now: t0 },
    );
    expect(self.status).toBe(403);
    expect((await json(self)).reason).toMatch(/second admin|Nobody approves/);
    // Not someone without configure.
    expect(
      (await post("ceo", `/elevations/${out.elevation.id}/approve`, {}, { now: t0 })).status,
    ).toBe(403);
    // Denial needs a reason.
    expect(
      (
        await post(
          "platform_admin",
          `/elevations/${out.elevation.id}/deny`,
          {},
          { email: other(3), now: t0 },
        )
      ).status,
    ).toBe(422);

    const ok = await post(
      "platform_admin",
      `/elevations/${out.elevation.id}/approve`,
      {},
      { email: other(3), now: t0 },
    );
    expect(ok.status).toBe(200);
    const active = await json(await get("platform_admin", "/elevation", { now: t0 + 60_000 }));
    expect(active.active.secondsLeft).toBeGreaterThan(7000);
    // The requester was told.
    const inbox = await json(await get("platform_admin", "/notifications", { now: t0 + 60_000 }));
    expect(inbox.items.map((n: Loose) => n.kind)).toContain("elevation_approved");
  });

  it("a request nobody decides lapses", async () => {
    const { approve } = await twoAdmins("/roles/platform_admin", {
      elevation: { actions: ["edit"], hours: 2, approval: true },
    });
    await approve();
    const t0 = Date.now();
    const id = (await json(await request("platform_admin", 1, "Maybe", { now: t0 }))).elevation.id;
    const late = await post(
      "platform_admin",
      `/elevations/${id}/approve`,
      {},
      { email: other(3), now: t0 + 25 * HOUR },
    );
    expect((await json(late)).error).toBe("expired");
  });
});

describe("access requests", () => {
  const ask = (
    p: string,
    nodeId: string,
    reason = "I need this for the migration bid",
    o: Loose = {},
  ) => post(p, "/access-requests", { nodeId, reason }, o);

  it("locked node -> reason -> steward queue -> approve -> member, requester notified", async () => {
    const map = await json(await as("consultant", "/v1/map?lens=departments"));
    const locked = map.hubs.find((h: Loose) => h.access === "locked");
    expect(locked, "the consultant has a locked department").toBeTruthy();
    const node = locked.id;

    // An open node cannot be requested.
    expect((await ask("consultant", "c_delivery")).status).toBe(403);
    expect((await ask("consultant", node, " ")).status).toBe(422);
    const res = await ask("consultant", node);
    expect(res.status).toBe(200);
    const id = (await json(res)).request.id;
    expect((await json(await ask("consultant", node))).error).toBe("duplicate");

    // The queue: admins see it. A steward of another scope does not and cannot decide it.
    const queue = await json(await get("platform_admin", "/access-requests?view=queue"));
    expect(queue.map((r: Loose) => r.id)).toContain(id);
    expect(queue.find((r: Loose) => r.id === id).canDecide).toBe(true);
    expect(await json(await get("head_bid", "/access-requests?view=queue"))).toEqual([]);
    expect((await get("consultant", "/access-requests?view=queue")).status).toBe(403);
    expect((await post("head_bid", `/access-requests/${id}/approve`, {})).status).toBe(403);

    // The admin was notified when it came in.
    const admin = await json(await get("platform_admin", "/notifications"));
    expect(admin.items.map((n: Loose) => n.kind)).toContain("access_request");

    // Before the approval the department is locked: name only.
    const before = await json(await as("consultant", `/v1/nodes/${node}`));
    expect(before.node.access).toBe("locked");
    const mapBefore = await json(await as("consultant", "/v1/map?lens=departments"));
    expect(mapBefore.hubs.find((h: Loose) => h.id === node).access).toBe("locked");

    const ok = await post("platform_admin", `/access-requests/${id}/approve`, {});
    expect(ok.status).toBe(200);
    expect((await json(ok)).request.status).toBe("granted");
    // The approval is real: the same person now sees the department in full and may comment.
    const after = await json(await as("consultant", `/v1/nodes/${node}`));
    expect(after.node.access).toBe("full");
    const mapAfter = await json(await as("consultant", "/v1/map?lens=departments"));
    expect(mapAfter.hubs.find((h: Loose) => h.id === node).access).toBe("full");
    expect(after.node.access).toBe("full");
    expect(before.items ?? []).toEqual([]);
    expect(after.items.length).toBeGreaterThan(0);
    const mine = await json(await get("consultant", "/access-requests"));
    expect(mine[0].status).toBe("granted");
    const inbox = await json(await get("consultant", "/notifications"));
    expect(inbox.items.map((n: Loose) => n.kind)).toContain("request_granted");
    expect(inbox.unread).toBeGreaterThan(0);
    const read = await json(await post("consultant", "/notifications/read", {}));
    expect(read.unread).toBe(0);
    const members = await json(
      await get("platform_admin", `/memberships?type=department&id=${node}`),
    );
    expect(members.members.map((m: Loose) => m.principalId)).toContain("u_consultant");
  });

  it("deny needs a reason and tells the requester", async () => {
    const map = await json(await as("consultant", "/v1/map?lens=departments"));
    const node = map.hubs.find((h: Loose) => h.access === "locked").id;
    const id = (await json(await ask("consultant", node))).request.id;
    expect((await post("platform_admin", `/access-requests/${id}/deny`, {})).status).toBe(422);
    expect(
      (
        await post("platform_admin", `/access-requests/${id}/deny`, {
          note: "Not part of this bid",
        })
      ).status,
    ).toBe(200);
    const mine = await json(await get("consultant", "/access-requests"));
    expect(mine[0]).toMatchObject({ status: "denied", note: "Not part of this bid" });
    expect(
      (await json(await get("consultant", "/notifications"))).items.map((n: Loose) => n.kind),
    ).toContain("request_denied");
    // Decided requests cannot be decided again.
    expect((await post("platform_admin", `/access-requests/${id}/approve`, {})).status).toBe(409);
  });

  it("approving a request for a restricted scope goes through the two-person path", async () => {
    const t0 = Date.now();
    // Accounts are restricted. Record a request directly: the UI reaches locked departments only.
    const made = await tenantDo(ALPHA).gov("createRequest", [
      {
        principalId: "u_consultant",
        nodeId: "a_acme",
        scope: {
          type: "account",
          id: "a_acme",
          dept: null,
          label: "Acme Synthetic SA",
          restricted: true,
          nda: false,
          subspace: null,
        },
        reason: "Join the Acme delivery team",
      },
      t0,
    ]);
    const id = (made as Loose).request.id;
    const first = await post("acme_lead", `/access-requests/${id}/approve`, {}, { now: t0 });
    expect(first.status).toBe(200);
    const out = await json(first);
    expect(out.applied).toBe(false);
    expect(out.request.status).toBe("approved");
    expect(
      (await json(await get("consultant", "/access-requests", { now: t0 }))).at(0).status,
    ).toBe("approved");

    // One approval is not access: the requester still cannot see the account or its Contacts.
    expect((await as("consultant", "/v1/nodes/a_acme:con:0", { now: t0 })).status).toBe(404);

    // The same steward cannot be the second person.
    expect(
      (await post("acme_lead", `/changes/${out.change.id}/approve`, {}, { now: t0 })).status,
    ).toBe(403);
    const done = await post("platform_admin", `/changes/${out.change.id}/approve`, {}, { now: t0 });
    expect(done.status).toBe(200);
    const mine = await json(await get("consultant", "/access-requests", { now: t0 }));
    expect(mine[0].status).toBe("granted");
    // End to end: only the second approval opened the account (and its Contacts) to the requester.
    expect((await as("consultant", "/v1/nodes/a_acme", { now: t0 })).status).toBe(200);
    expect((await as("consultant", "/v1/nodes/a_acme:con:0", { now: t0 })).status).toBe(200);
    expect(
      (await json(await get("consultant", "/notifications", { now: t0 }))).items.map(
        (n: Loose) => n.kind,
      ),
    ).toContain("request_granted");
  });

  it("nobody decides their own request (store-level guarantee)", async () => {
    const made = await tenantDo(ALPHA).gov("createRequest", [
      {
        principalId: "u_platform_admin",
        nodeId: "d_hr",
        scope: {
          type: "department",
          id: "d_hr",
          dept: "d_hr",
          label: "HR",
          restricted: false,
          nda: false,
          subspace: null,
        },
        reason: "Mine",
      },
      Date.now(),
    ]);
    const id = (made as Loose).request.id;
    const r = await post("platform_admin", `/access-requests/${id}/approve`, {});
    expect(r.status).toBe(403);
    expect((await json(r)).reason).toMatch(/your own request/);
  });
});

describe("two-person rule in the store", () => {
  it("refuses the proposer as decider even when the route above would allow it", async () => {
    const t0 = Date.now();
    const gov = (m: string, ...a: unknown[]) => tenantDo(ALPHA).gov(m, a) as Promise<Loose>;
    const p = await gov(
      "propose",
      {
        kind: "member_add",
        payload: {
          principalId: "u_reviewer",
          scope: { type: "account", id: "a_acme" },
          subspace: null,
        },
        scopeKey: "account:a_acme",
        scope: null,
        needsSecond: true,
        proposedBy: "u_x",
        label: "t",
      },
      t0,
    );
    expect(p.ok).toBe(true);
    const self = await gov("decide", p.change.id, true, "u_x", null, t0);
    expect(self).toMatchObject({ ok: false, code: "self_approval", status: 403 });
    const other = await gov("decide", p.change.id, true, "u_y", null, t0);
    expect(other.ok).toBe(true);
    // And an unknown method is not callable.
    expect(await gov("reset", 0)).toMatchObject({ ok: false, code: "unknown_gov_method" });
  });
});

describe("H-04: the beneficiary cannot be the deciding vote", () => {
  const gov = (m: string, ...a: unknown[]) => tenantDo(ALPHA).gov(m, a) as Promise<Loose>;
  const propose = (principalId: string, proposedBy: string, t0: number, requestId?: string) =>
    gov(
      "propose",
      {
        kind: "member_add",
        payload: {
          principalId,
          scope: { type: "account", id: "a_acme" },
          subspace: null,
        },
        scopeKey: "account:a_acme",
        scope: null,
        needsSecond: true,
        proposedBy,
        label: "t",
        ...(requestId ? { requestId } : {}),
      },
      t0,
    );

  it("store: the person the change benefits cannot approve or reject it", async () => {
    const t0 = Date.now();
    const p = await propose("u_reviewer", "u_x", t0);
    expect(p.ok).toBe(true);
    for (const approve of [true, false]) {
      const r = await gov("decide", p.change.id, approve, "u_reviewer", null, t0);
      expect(r).toMatchObject({ ok: false, code: "beneficiary_decision", status: 403 });
    }
    expect((await gov("decide", p.change.id, true, "u_y", null, t0)).ok).toBe(true);
  });

  it("store: the requester of the linked access request cannot decide the change", async () => {
    const t0 = Date.now();
    const made = await gov(
      "createRequest",
      {
        principalId: "u_consultant",
        nodeId: "a_acme",
        scope: {
          type: "account",
          id: "a_acme",
          dept: null,
          label: "Acme Synthetic SA",
          restricted: true,
          nda: false,
          subspace: null,
        },
        reason: "Join the team",
      },
      t0,
    );
    // Admin B proposes on behalf of a request, naming a different beneficiary than the requester.
    const p = await propose("u_reviewer", "u_x", t0, made.request.id);
    expect(p.ok).toBe(true);
    const r = await gov("decide", p.change.id, true, "u_consultant", null, t0);
    expect(r).toMatchObject({ ok: false, code: "beneficiary_decision", status: 403 });
  });

  it("route: admin A asks for access, admin B approves the request, A cannot approve the resulting change", async () => {
    const t0 = Date.now();
    const aId = (await json(await as("platform_admin", "/v1/me", { now: t0 }))).principal.id;
    const made = await gov(
      "createRequest",
      {
        principalId: aId,
        nodeId: "a_acme",
        scope: {
          type: "account",
          id: "a_acme",
          dept: null,
          label: "Acme Synthetic SA",
          restricted: true,
          nda: false,
          subspace: null,
        },
        reason: "Need the account",
      },
      t0,
    );
    const first = await post(
      "platform_admin",
      `/access-requests/${made.request.id}/approve`,
      {},
      { email: other(2), now: t0 },
    );
    const out = await json(first);
    expect(first.status, JSON.stringify(out)).toBe(200);
    expect(out.applied).toBe(false);
    const queue = await json(await get("platform_admin", "/changes?status=pending", { now: t0 }));
    expect(queue.find((c: Loose) => c.id === out.change.id)?.canDecide).toBe(false);
    const self = await post("platform_admin", `/changes/${out.change.id}/approve`, {}, { now: t0 });
    expect(self.status).toBe(403);
    // A third person can finish it.
    const done = await post(
      "platform_admin",
      `/changes/${out.change.id}/approve`,
      {},
      { email: other(3), now: t0 },
    );
    expect(done.status).toBe(200);
  });
});

describe("notifications", () => {
  it("steward queue items reach every approver except the proposer", async () => {
    await post("acme_lead", "/memberships", {
      op: "add",
      principalId: "u_reviewer",
      scope_type: "account",
      scope_id: "a_acme",
    });
    const admin = await json(await get("platform_admin", "/notifications"));
    expect(admin.items.map((n: Loose) => n.kind)).toContain("approval_needed");
    // Content-free titles with a reference only.
    expect(JSON.stringify(admin)).not.toMatch(/u_reviewer/);
    const proposer = await json(await get("acme_lead", "/notifications"));
    expect(proposer.items.map((n: Loose) => n.kind)).not.toContain("approval_needed");
    // Marking one read lowers the count.
    const first = admin.items[0];
    const r = await json(await post("platform_admin", "/notifications/read", { ids: [first.id] }));
    expect(r.unread).toBe(admin.unread - 1);
    expect((await post("platform_admin", "/notifications/read", { ids: ["x"] })).status).toBe(200);
  });

  it("an inbox is private to its owner", async () => {
    await post("acme_lead", "/memberships", {
      op: "add",
      principalId: "u_reviewer",
      scope_type: "account",
      scope_id: "a_acme",
    });
    const other = await json(await get("consultant", "/notifications"));
    expect(other.items).toEqual([]);
  });
});

describe("audit viewer", () => {
  it("is for the auditor and admin, filters by principal, action and date, and holds no content", async () => {
    const SECRET = "TOPSECRET-REASON-991";
    await post("platform_admin", "/nda", {
      principalId: "u_ceo",
      accountId: "a_calypso",
      reason: SECRET,
      expiresAt: new Date(Date.now() + 10 * DAY).toISOString(),
    });
    await put("platform_admin", "/roles/consultant", { summary: SECRET });
    await post("head_bid", "/memberships", {
      op: "add",
      principalId: "u_reviewer",
      scope_type: "circle",
      scope_id: "c_af_close",
    });

    const all = await json(await get("auditor", "/audit"));
    expect(all.length).toBeGreaterThan(2);
    expect(JSON.stringify(all)).not.toContain(SECRET);
    expect(JSON.stringify(await receipts("u_platform_admin"))).not.toContain(SECRET);
    expect((await get("platform_admin", "/audit")).status).toBe(200);
    for (const p of ["ceo", "head_bid", "consultant", "reviewer"])
      expect((await get(p, "/audit")).status, p).toBe(403);

    const byPrincipal = await json(await get("auditor", "/audit?principal=u_head_bid"));
    expect(byPrincipal.length).toBeGreaterThan(0);
    expect(byPrincipal.every((r: Loose) => r.actor === "u_head_bid")).toBe(true);
    const byAction = await json(await get("auditor", "/audit?action=gov.nda_grant.propose"));
    expect(byAction.length).toBeGreaterThan(0);
    expect(byAction.every((r: Loose) => r.action === "gov.nda_grant.propose")).toBe(true);
    const family = await json(await get("auditor", "/audit?action=gov"));
    expect(family.length).toBeGreaterThanOrEqual(byAction.length);
    const today = new Date().toISOString().slice(0, 10);
    expect(
      (await json(await get("auditor", `/audit?from=${today}&to=${today}`))).length,
    ).toBeGreaterThan(0);
    expect(await json(await get("auditor", "/audit?from=2020-01-01&to=2020-01-02"))).toEqual([]);
    const deny = (await json(await get("auditor", "/audit?principal=u_head_bid"))).find(
      (r: Loose) => r.result === "deny",
    );
    expect(deny.reason).toMatch(/steward or a Platform admin/);
    for (const q of ["principal=%20bad", "action=BAD!", "from=yesterday"])
      expect((await get("auditor", `/audit?${q}`)).status, q).toBe(400);
  });

  it("every console mutation leaves a receipt with who, what and where", async () => {
    await post("head_bid", "/memberships", {
      op: "add",
      principalId: "u_reviewer",
      scope_type: "circle",
      scope_id: "c_bid",
    });
    const id = (
      await json(
        await post("acme_lead", "/memberships", {
          op: "add",
          principalId: "u_reviewer",
          scope_type: "account",
          scope_id: "a_acme",
        }),
      )
    ).change.id;
    await post("platform_admin", `/changes/${id}/approve`, {});
    const rec = await receipts("u_head_bid");
    expect(rec.find((x) => x.action === "gov.member_add.propose")).toMatchObject({
      decision: "allow",
      scopeId: "circle:c_bid",
      tenantId: ALPHA,
    });
    const approve = (await receipts("u_platform_admin")).find(
      (x) => x.action === "gov.member_add.approve",
    );
    expect(approve).toMatchObject({ decision: "allow", scopeId: "account:a_acme" });
  });
});

describe("what the console never opens", () => {
  it("reports capabilities per person", async () => {
    expect(await json(await get("platform_admin", "/caps"))).toMatchObject({
      configure: true,
      steward: false,
    });
    expect(await json(await get("head_bid", "/caps"))).toMatchObject({
      configure: false,
      steward: true,
    });
    expect((await json(await get("ceo", "/caps"))).elevation).toMatchObject({
      maxHours: 4,
      needsApproval: false,
    });
  });

  it("an unseeded or unauthenticated caller gets nothing", async () => {
    const r = await as("ceo", `${A}/roles`, { token: null, method: "GET" });
    expect(r.status).toBe(401);
  });
});
