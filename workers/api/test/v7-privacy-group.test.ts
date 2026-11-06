// The privacy approver group ("named approver group: privacy" in a rule): who may read and set its
// members, that a member shows with an address, and the audit trail of both.

import { beforeAll, describe, expect, it } from "vitest";
import { ALPHA, as, json, type Loose, rawEnv, seed } from "./helpers.ts";

const ADMIN = "v7g.admin@example.invalid";
const BID = "v7g.bid@example.invalid";
const CONS = "v7g.cons@example.invalid";
const KEY_READ = "test-audit-key-read-0123456789abcdef012";

const admin = (o: Loose = {}) => as("platform_admin", "/v1/rules/groups", { email: ADMIN, ...o });
const idOf = async (persona: string, email: string) =>
  (await json<Loose>(await as(persona, "/v1/me", { email }))).principal.id as string;

async function receiptsOf(principal: string): Promise<Loose[]> {
  const res = await rawEnv.AUDIT.fetch(
    `https://audit.internal/receipts?tenant=${ALPHA}&days=30&principal=${encodeURIComponent(principal)}`,
    { headers: { "X-Audit-Key": KEY_READ } },
  );
  return ((await res.json()) as { receipts: Loose[] }).receipts;
}

beforeAll(async () => {
  await seed();
});

describe("GET and PUT /v1/rules/groups", () => {
  it("is for Platform admins only: everyone else gets 404, read or write", async () => {
    for (const [persona, email] of [
      ["head_bid", BID],
      ["consultant", CONS],
    ] as const) {
      expect((await as(persona, "/v1/rules/groups", { email })).status).toBe(404);
      expect(
        (await as(persona, "/v1/rules/groups", { email, method: "PUT", body: { privacy: [] } }))
          .status,
      ).toBe(404);
    }
    expect((await admin({ token: null })).status).toBe(401);
  });

  it("an admin sees the members with their address and assigns them; both are audited", async () => {
    expect(await json<Loose>(await admin())).toEqual({ privacy: [] });
    const dir = await json<Loose[]>(
      await as("platform_admin", "/v1/admin/principals", { email: ADMIN }),
    );
    const cons = dir.find((p) => p.roleIds.includes("consultant"))?.id as string;
    const bid = dir.find((p) => p.roleIds.includes("head_bid"))?.id as string;
    expect(cons).toBeTruthy();
    const put = await admin({ method: "PUT", body: { privacy: [cons, bid] } });
    expect(put.status).toBe(200);
    const got = await json<Loose>(await admin());
    expect(got.privacy.map((m: Loose) => m.id).sort()).toEqual([bid, cons].sort());
    expect(got.privacy.find((m: Loose) => m.id === cons).email).toBe(
      dir.find((p) => p.id === cons)?.email,
    );
    // An id the directory does not know is listed without an address, never dropped.
    await admin({ method: "PUT", body: { privacy: [cons, "u_nobody_known"] } });
    const again = await json<Loose>(await admin());
    expect(again.privacy.find((m: Loose) => m.id === "u_nobody_known")).toEqual({
      id: "u_nobody_known",
      email: null,
    });
    // Removing everyone is allowed and shows.
    await admin({ method: "PUT", body: { privacy: [] } });
    expect(await json<Loose>(await admin())).toEqual({ privacy: [] });
    // Receipts: who set it, who looked; ids and counts only.
    const adminId = await idOf("platform_admin", ADMIN);
    const mine = await receiptsOf(adminId);
    expect(mine.filter((r) => r.action === "rules.groups").length).toBe(3);
    expect(mine.filter((r) => r.action === "rules.groups.read").length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(mine)).not.toContain(dir.find((p) => p.id === cons)?.email);
  });

  it("refuses a body that is not a list of ids", async () => {
    for (const body of [{}, { privacy: "x" }, { privacy: [1] }, { privacy: ["a".repeat(129)] }])
      expect((await admin({ method: "PUT", body })).status).toBe(400);
  });
});
