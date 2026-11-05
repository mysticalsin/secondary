// B2 security review, remaining governance findings: M-07 (authority and elevation edits are
// sensitive), M-08 (one human under several dev personas counts once), L-06 (last-admin guard counts
// active holders) and I-05 (NDA account names stay out of inbox titles).

import { runInDurableObject } from "cloudflare:test";
import type { Role } from "@secondary/policy";
import { beforeEach, describe, expect, it } from "vitest";
import { elevationLoosened } from "../src/admin/validate.ts";
import { as, json, type Loose, seed, tenantDo } from "./helpers.ts";

const ALPHA = "tenant_mantu_synthetic";
const A = "/v1/admin";
const DAY = 24 * 3_600_000;

beforeEach(async () => {
  await seed();
});

const other = (n: number) => `gov2-person${n}@example.invalid`;
const get = (p: string, path: string, o: Loose = {}) =>
  as(p, `${A}${path}`, { method: "GET", ...o });
const post = (p: string, path: string, body: unknown, o: Loose = {}) =>
  as(p, `${A}${path}`, { body, ...o });
const put = (p: string, path: string, body: unknown, o: Loose = {}) =>
  as(p, `${A}${path}`, { body, method: "PUT", ...o });

const roleOf = async (id: string): Promise<Loose> =>
  (await json(await get("platform_admin", "/roles"))).find((r: Loose) => r.id === id);

describe("M-07: authority grants and looser elevation need a second approver", () => {
  it("adding manage_members on every circle to a role waits for a second person", async () => {
    const consultant = await roleOf("consultant");
    const res = await put("platform_admin", "/roles/consultant", {
      baseVersion: consultant.version,
      grants: [
        ...consultant.grants,
        { scope_type: "circle", scope_id: "*", actions: ["manage_members"], conditions: {} },
      ],
    });
    expect(res.status).toBe(200);
    const out = await json(res);
    expect(out.applied).toBe(false);
    expect(out.change.status).toBe("pending");
  });

  it("approve_release or review on a restricted circle waits for a second person", async () => {
    const consultant = await roleOf("consultant");
    for (const action of ["approve_release", "review"]) {
      const res = await put("platform_admin", "/roles/consultant", {
        baseVersion: consultant.version,
        grants: [
          ...consultant.grants,
          { scope_type: "circle", scope_id: "c_hr_pp", actions: [action], conditions: {} },
        ],
      });
      // c_hr_pp is a restricted circle in the fixtures; an unknown scope would be a 422.
      expect(res.status, action).toBe(200);
      expect((await json(res)).applied, action).toBe(false);
    }
  });

  it("a new elevation, or a longer or unapproved one, waits for a second person", async () => {
    const consultant = await roleOf("consultant");
    const added = await put("platform_admin", "/roles/consultant", {
      baseVersion: consultant.version,
      elevation: { actions: ["edit"], hours: 1 },
    });
    expect(added.status).toBe(200);
    expect((await json(added)).applied).toBe(false);

    const ceo = await roleOf("ceo");
    const longer = await put("platform_admin", "/roles/ceo", {
      baseVersion: ceo.version,
      elevation: { actions: ["edit", "review"], hours: 24 },
    });
    expect(longer.status).toBe(200);
    expect((await json(longer)).applied).toBe(false);
  });

  it("tightening an elevation is not a loosening", () => {
    const before = { elevation: { actions: ["edit", "review"], hours: 4 } } as Role;
    expect(
      elevationLoosened(before, {
        elevation: { actions: ["edit"], hours: 2, approval: true },
      } as Role),
    ).toBe(false);
    expect(
      elevationLoosened(before, { elevation: { actions: ["edit", "review"], hours: 5 } } as Role),
    ).toBe(true);
    expect(
      elevationLoosened(
        { elevation: { actions: ["edit"], hours: 2, approval: true } } as Role,
        { elevation: { actions: ["edit"], hours: 2 } } as Role,
      ),
    ).toBe(true);
    expect(elevationLoosened(before, {} as Role)).toBe(false);
  });
});

describe("M-08: one address under two dev personas is one person", () => {
  it("the proposer cannot approve under another persona with the same address", async () => {
    const me = "gov2-solo@example.invalid";
    const proposed = await post(
      "acme_lead",
      "/memberships",
      { op: "add", scope_type: "account", scope_id: "a_acme", principalId: "u_consultant" },
      { email: me },
    );
    expect(proposed.status).toBe(200);
    const change = (await json(proposed)).change;
    expect(change.status).toBe("pending");
    const sameAddress = await post(
      "platform_admin",
      `/changes/${change.id}/approve`,
      {},
      {
        email: me,
      },
    );
    expect(sameAddress.status).toBe(403);
    expect((await json(sameAddress)).reason).toMatch(/Two-person/);
    // Someone else can.
    const second = await post(
      "platform_admin",
      `/changes/${change.id}/approve`,
      {},
      {
        email: other(1),
      },
    );
    expect(second.status).toBe(200);
  });

  it("the person an elevation is for cannot approve it under another persona", async () => {
    const me = "gov2-elev@example.invalid";
    // The CEO role elevates with approval after the edit below (applies at once: it tightens).
    const ceo = await roleOf("ceo");
    const edit = await put("platform_admin", "/roles/ceo", {
      baseVersion: ceo.version,
      elevation: { actions: ["edit"], hours: 2, approval: true },
    });
    // The CEO role holds account grants, so the edit itself waits for a second admin.
    const change = (await json(edit)).change;
    expect(
      (await post("platform_admin", `/changes/${change.id}/approve`, {}, { email: other(9) }))
        .status,
    ).toBe(200);
    const asked = await post(
      "ceo",
      "/elevations",
      { hours: 1, reason: "Fix a page" },
      { email: me },
    );
    expect(asked.status).toBe(200);
    const id = (await json(asked)).elevation.id;
    const self = await post("platform_admin", `/elevations/${id}/approve`, {}, { email: me });
    expect(self.status).toBe(403);
    const second = await post(
      "platform_admin",
      `/elevations/${id}/approve`,
      {},
      { email: other(2) },
    );
    expect(second.status).toBe(200);
  });
});

describe("L-06: the last-admin guard counts only holders who can still sign in", () => {
  it("refuses an edit when every holder of a configure role is deprovisioned", async () => {
    const admin = await roleOf("platform_admin");
    const proposed = await put("platform_admin", "/roles/platform_admin", {
      baseVersion: admin.version,
      summary: "Structure only, edited",
    });
    expect(proposed.status).toBe(200);
    const change = (await json(proposed)).change;
    await runInDurableObject(tenantDo(ALPHA), async (_i, state) => {
      const holders = state.storage.sql
        .exec("SELECT DISTINCT principal_id FROM role_assignments WHERE role_id = 'platform_admin'")
        .toArray();
      expect(holders.length).toBeGreaterThan(0);
      for (const h of holders)
        state.storage.sql.exec(
          "INSERT OR REPLACE INTO principal_status (principal_id, active, changed_at) VALUES (?, 0, 1)",
          h.principal_id as string,
        );
    });
    try {
      const approved = await post(
        "platform_admin",
        `/changes/${change.id}/approve`,
        {},
        {
          email: other(3),
        },
      );
      expect(approved.status).toBe(422);
      expect((await json(approved)).error).toBe("last_admin");
    } finally {
      await runInDurableObject(tenantDo(ALPHA), async (_i, state) => {
        state.storage.sql.exec("DELETE FROM principal_status");
      });
    }
  });
});

describe("I-05: inbox titles never name an NDA account", () => {
  it("an NDA grant proposal and an access request use a generic label", async () => {
    const res = await post(
      "platform_admin",
      "/nda",
      {
        principalId: "u_ceo",
        accountId: "a_calypso",
        reason: "Board prep for the review",
        expiresAt: new Date(Date.now() + 30 * DAY).toISOString(),
      },
      { email: other(4) },
    );
    expect(res.status).toBe(200);
    const titles = await runInDurableObject(tenantDo(ALPHA), async (_i, state) =>
      state.storage.sql
        .exec("SELECT title FROM gov_notifications")
        .toArray()
        .map((r) => r.title as string),
    );
    expect(titles.length).toBeGreaterThan(0);
    expect(titles.filter((t) => /calypso/i.test(t))).toEqual([]);
    expect(titles.some((t) => /restricted account/.test(t))).toBe(true);
  });
});
