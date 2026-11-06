// What the Review desk shows of the rules, per person: held actions they may decide and rule publications
// that wait for a second person who is not them. Nobody sees what they may not act on.

import { beforeAll, describe, expect, it } from "vitest";
import { as, json, type Loose, seed } from "./helpers.ts";

const ADMIN = "v7d.admin@example.invalid";
const ADMIN2 = "v7d.admin2@example.invalid";
const CONS = "v7d.cons@example.invalid";
const REV = "v7d.rev@example.invalid";
const BID = "v7d.bid@example.invalid";

const rules = (email: string, path: string, o: Loose = {}) =>
  as("platform_admin", `/v1/rules${path}`, { email, ...o });
const desk = (persona: string, email: string) =>
  as(persona, "/v1/rules/desk", { email }).then((r) => json<Loose>(r));
const rule = (over: Loose = {}) => ({
  name: "Desk rule",
  scope: { kind: "brains", ids: ["c_delivery"] },
  when: [{ field: "action", op: "is_any_of", values: ["export"] }],
  then: { effect: "review" },
  except: { incident: false },
  status: "enforced",
  ...over,
});
const hashOf = async (email: string, id: string) =>
  (await json<Loose>(await rules(email, `/${id}`))).draftHash as string;

beforeAll(async () => {
  await seed();
});

describe("GET /v1/rules/desk", () => {
  it("a publication waiting for a second admin shows to the other admin, not to its author or to others", async () => {
    // A tenant-wide rule needs a second person.
    const made = await json<Loose>(
      await rules(ADMIN, "", {
        method: "POST",
        body: rule({ name: "Whole tenant, needs two", scope: { kind: "tenant" } }),
      }),
    );
    const first = await rules(ADMIN, `/${made.id}/publish`, {
      method: "POST",
      body: { expectedHash: await hashOf(ADMIN, made.id) },
    });
    expect(first.status).toBe(202);

    const other = await desk("platform_admin", ADMIN2);
    expect(other.publications).toEqual([
      expect.objectContaining({ id: made.id, name: "Whole tenant, needs two", kind: "publish" }),
    ]);
    expect((await desk("platform_admin", ADMIN)).publications).toEqual([]);
    for (const [p, e] of [
      ["consultant", CONS],
      ["head_bid", BID],
    ] as const) {
      const d = await desk(p, e);
      expect(d.publications).toEqual([]);
      expect(d.holds).toEqual([]);
    }
    // The second admin confirms: it leaves the list.
    const done = await rules(ADMIN2, `/${made.id}/publish`, {
      method: "POST",
      body: { expectedHash: await hashOf(ADMIN2, made.id) },
    });
    expect(done.status).toBe(200);
    expect((await desk("platform_admin", ADMIN2)).publications).toEqual([]);
  });

  it("a held action shows to a steward who may decide it, not to the person who asked", async () => {
    const made = await json<Loose>(
      await rules(ADMIN, "", {
        method: "POST",
        body: rule({
          name: "Exports need a steward",
          when: [
            { field: "action", op: "is_any_of", values: ["export"] },
            { field: "size_pages", op: "greater_than", values: ["0"] },
          ],
        }),
      }),
    );
    let pub = await rules(ADMIN, `/${made.id}/publish`, {
      method: "POST",
      body: { expectedHash: await hashOf(ADMIN, made.id) },
    });
    if (pub.status === 202)
      pub = await rules(ADMIN2, `/${made.id}/publish`, {
        method: "POST",
        body: { expectedHash: await hashOf(ADMIN2, made.id) },
      });
    expect(pub.status).toBe(200);
    const held = await as("consultant", "/v1/brain/export?workspaceId=c_delivery", {
      email: CONS,
      now: Date.now() + 120_000,
    });
    expect(held.status).toBe(202);
    const h = await json<Loose>(held);
    const theirs = await desk("reviewer", REV);
    expect(theirs.holds.map((x: Loose) => x.id)).toContain(h.holdId);
    expect((await desk("consultant", CONS)).holds).toEqual([]);
  });
});
