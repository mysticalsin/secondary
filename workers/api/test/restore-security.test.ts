// N-02: a restore replaces the directory with an older snapshot. Anything that was taken away since
// the snapshot (a leaver, a revoked grant or membership, a kill switch) stays taken away: the
// tenant keeps a security-event journal outside the snapshot and replays it after the restore.

import { beforeAll, describe, expect, it } from "vitest";
import { ALPHA, type Loose, seed, tenantDo } from "./helpers.ts";

const NOW = Date.now();
const t = () => tenantDo(ALPHA) as unknown as Loose;
const sessionOf = async (email: string) =>
  (await t().session({ email, actAs: null, now: NOW + 10_000, limit: 100_000 })) as Loose;

let leaver = "";
let reviewer = "";

beforeAll(async () => {
  await seed();
  const snap = (await t().exportAll()) as Loose;
  leaver = snap.principals.find((p: Loose) => p.id === "u_consultant").email;
  reviewer = snap.principals.find((p: Loose) => p.id === "u_reviewer").email;
});

describe("N-02: a restore of an old snapshot cannot resurrect access", () => {
  it("keeps leavers out, switches off, revoked grants and memberships revoked, and the epoch moving up", async () => {
    // State at snapshot time.
    const made = await t().scimUserCreate({ userName: leaver, active: true }, NOW);
    expect(made.ok).toBe(true);
    await t().grantNda("u_head_bid", "a_calypso");
    const beforeRoles = (await sessionOf(reviewer)).principal;
    expect(beforeRoles.roleIds.length + beforeRoles.memberships.length).toBeGreaterThan(0);
    const old = await t().exportAll();

    // After the snapshot: the person leaves, a switch is thrown, a grant and a person's access go.
    await t().scimUserDelete(made.user.id, NOW + 1);
    await t().setSwitch("ai", false, "u_admin", NOW + 2, false);
    await t().revokeNda("u_head_bid", "a_calypso");
    await t().revokeAll("u_reviewer");
    const epoch = await t().epoch();
    expect((await sessionOf(leaver)).active).toBe(false);

    await t().importAll(old);

    expect((await sessionOf(leaver)).active).toBe(false);
    expect((await sessionOf(leaver)).switches.ai).toBe(false);
    const head = (await sessionOf(
      (old.principals as Loose[]).find((p) => p.id === "u_head_bid").email,
    )) as Loose;
    expect(head.ndaGrants).not.toContain("a_calypso");
    const r = (await sessionOf(reviewer)).principal;
    expect(r.roleIds).toEqual([]);
    expect(r.memberships).toEqual([]);
    // The epoch never goes back to the snapshot's lower value.
    expect(await t().epoch()).toBeGreaterThan(epoch);
  });

  it("a grant made since the snapshot is applied again, so a restore also loses nothing it should keep", async () => {
    const old = await t().exportAll();
    await t().grantNda("u_ceo", "a_calypso");
    await t().importAll(old);
    const ceo = (old.principals as Loose[]).find((p) => p.id === "u_ceo").email;
    expect((await sessionOf(ceo)).ndaGrants).toContain("a_calypso");
  });

  it("a later re-enable of a switch survives a restore too", async () => {
    await t().setSwitch("ai", true, "u_admin", NOW + 20, false);
    const old = await t().exportAll();
    await t().setSwitch("connector", false, "u_admin", NOW + 21, false);
    await t().importAll(old);
    const s = (await sessionOf(leaver)) as Loose;
    expect(s.switches.connector).toBe(false);
    expect(s.switches.ai).toBe(true);
  });
});
