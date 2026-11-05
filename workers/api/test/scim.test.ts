import { beforeAll, describe, expect, it } from "vitest";
import { makeIdp, req, SCIM_TOKEN, signIn } from "./entra-helpers.ts";
import { ALPHA, call, json, type Loose, seed, tenantDo } from "./helpers.ts";

let n = 0;
const uniq = () => `${++n}-${Date.now()}`;
const mail = () => `scim${uniq()}@example.invalid`;
const U = "urn:ietf:params:scim:schemas:core:2.0:User";
const PATCH = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

const scim = (
  path: string,
  o: { method?: string; body?: unknown; token?: string | null; env?: Record<string, unknown> } = {},
) =>
  req(`/scim/v2${path}`, {
    method: o.method,
    body: o.body,
    env: o.env,
    headers: {
      "Content-Type": "application/scim+json",
      ...(o.token === null ? {} : { Authorization: `Bearer ${o.token ?? SCIM_TOKEN}` }),
    },
  });

const createUser = async (userName = mail(), extra: Record<string, unknown> = {}) => {
  const r = await scim("/Users", { body: { schemas: [U], userName, ...extra } });
  expect(r.status).toBe(201);
  return json<Loose>(r);
};
const createGroup = async (displayName: string, extra: Record<string, unknown> = {}) => {
  const r = await scim("/Groups", { body: { displayName, ...extra } });
  expect(r.status).toBe(201);
  return json<Loose>(r);
};
const patch = (kind: "Users" | "Groups", id: string, Operations: unknown[]) =>
  scim(`/${kind}/${id}`, { method: "PATCH", body: { schemas: [PATCH], Operations } });

const meOf = (cookie: string | null) =>
  req("/v1/me", { headers: cookie ? { Cookie: cookie } : {} });

beforeAll(async () => {
  await seed();
});

describe("bearer token", () => {
  it("is required, compared exactly, and SCIM is off without a long enough secret", async () => {
    expect((await scim("/Users", { token: null })).status).toBe(401);
    expect((await scim("/Users", { token: "wrong" })).status).toBe(401);
    expect((await scim("/Users", { token: `${SCIM_TOKEN}x` })).status).toBe(401);
    expect((await scim("/Users", { token: SCIM_TOKEN.slice(0, -1) })).status).toBe(401);
    expect((await scim("/Users", { env: { SCIM_TOKEN: "" }, token: "" })).status).toBe(401);
    const short = "short-but-matching";
    expect((await scim("/Users", { env: { SCIM_TOKEN: short }, token: short })).status).toBe(401);
    const denied = await scim("/Users", { token: "wrong" });
    expect(denied.headers.get("WWW-Authenticate")).toContain("Bearer");
    expect(await json(denied)).toMatchObject({ status: "401" });
    expect((await scim("/Users")).status).toBe(200);
  });

  it("does not accept the Access JWT or a session cookie in its place", async () => {
    const r = await call("/scim/v2/Users", { email: "x@example.invalid" });
    expect(r.status).toBe(401);
  });
});

describe("discovery", () => {
  it("serves ServiceProviderConfig and ResourceTypes as application/scim+json", async () => {
    const r = await scim("/ServiceProviderConfig");
    expect(r.headers.get("Content-Type")).toContain("application/scim+json");
    expect((await json(r)).patch.supported).toBe(true);
    expect((await json(await scim("/ResourceTypes"))).totalResults).toBe(2);
  });
});

describe("Users", () => {
  it("creates, reads, filters and lists", async () => {
    const userName = mail().toUpperCase();
    const c = await scim("/Users", {
      body: {
        schemas: [U],
        userName,
        externalId: "ext-1",
        displayName: "Test User",
        name: { givenName: "Test", familyName: "User", ignored: 5 },
        active: true,
      },
    });
    expect(c.status).toBe(201);
    const u = await json<Loose>(c);
    expect(c.headers.get("Location")).toBe(u.meta.location);
    expect(u).toMatchObject({
      schemas: [U],
      userName: userName.toLowerCase(),
      externalId: "ext-1",
      displayName: "Test User",
      active: true,
    });
    expect(u.name).toEqual({ givenName: "Test", familyName: "User" });
    expect(u.meta.resourceType).toBe("User");
    expect(u.emails[0].value).toBe(userName.toLowerCase());

    expect(await json(await scim(`/Users/${u.id}`))).toMatchObject({ id: u.id });
    const f = await json<Loose>(
      await scim(`/Users?filter=${encodeURIComponent(`userName eq "${userName}"`)}`),
    );
    expect(f.totalResults).toBe(1);
    expect(f.Resources[0].id).toBe(u.id);
    const none = await json<Loose>(
      await scim(`/Users?filter=${encodeURIComponent('userName eq "nobody@example.invalid"')}`),
    );
    expect(none).toMatchObject({ totalResults: 0, itemsPerPage: 0, Resources: [] });
    const byExt = await json<Loose>(
      await scim(`/Users?filter=${encodeURIComponent('externalId eq "ext-1"')}`),
    );
    expect(byExt.Resources.map((x: Loose) => x.id)).toContain(u.id);
  });

  it("paginates", async () => {
    for (let i = 0; i < 3; i++) await createUser();
    const all = await json<Loose>(await scim("/Users?count=200"));
    expect(all.totalResults).toBeGreaterThanOrEqual(3);
    const p = await json<Loose>(await scim("/Users?startIndex=2&count=1"));
    expect(p).toMatchObject({ startIndex: 2, itemsPerPage: 1, totalResults: all.totalResults });
    expect(p.Resources[0].id).toBe(all.Resources[1].id);
    expect((await json<Loose>(await scim("/Users?count=0"))).Resources).toEqual([]);
  });

  it("rejects duplicates, bad names, bad filters and bad JSON", async () => {
    const u = await createUser();
    const dup = await scim("/Users", { body: { userName: u.userName.toUpperCase() } });
    expect(dup.status).toBe(409);
    expect(await json(dup)).toMatchObject({ scimType: "uniqueness", status: "409" });
    for (const body of [
      { userName: "no-at-sign" },
      {},
      { userName: 5 },
      { userName: mail(), active: "maybe" },
    ]) {
      expect((await scim("/Users", { body })).status, JSON.stringify(body)).toBe(400);
    }
    const bad = await scim(`/Users?filter=${encodeURIComponent('userName co "x"')}`);
    expect(bad.status).toBe(400);
    expect((await json(bad)).scimType).toBe("invalidFilter");
    expect((await scim(`/Users?filter=${encodeURIComponent('emails eq "x"')}`)).status).toBe(400);
    expect((await scim("/Users", { body: "{not json" })).status).toBe(400);
    expect((await scim("/Users/not-an-id")).status).toBe(404);
    expect((await scim("/Users/00000000-0000-4000-8000-000000000000")).status).toBe(404);
  });

  it("patches in the shapes Entra sends", async () => {
    const u = await createUser(mail(), { displayName: "Before" });
    const r = await patch("Users", u.id, [
      { op: "Replace", path: "displayName", value: "After" },
      { op: "Add", path: "name.givenName", value: "Given" },
      { op: "replace", value: { "name.familyName": "Family", externalId: "ext-9" } },
      { op: "Replace", path: 'emails[type eq "work"].value', value: u.userName },
      {
        op: "Replace",
        path: "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department",
        value: "x",
      },
    ]);
    expect(r.status).toBe(200);
    expect(await json(r)).toMatchObject({
      displayName: "After",
      externalId: "ext-9",
      name: { givenName: "Given", familyName: "Family" },
      active: true,
    });
    expect((await patch("Users", u.id, [{ op: "remove", path: "displayName" }])).status).toBe(200);
    expect((await json<Loose>(await scim(`/Users/${u.id}`))).displayName).toBeUndefined();
    for (const ops of [
      [],
      [{ op: "bogus", path: "active", value: true }],
      [{ op: "replace", path: "active", value: "maybe" }],
      [{ op: "replace" }],
    ])
      expect((await patch("Users", u.id, ops as unknown[])).status, JSON.stringify(ops)).toBe(400);
    expect(
      (
        await patch("Users", "00000000-0000-4000-8000-000000000000", [
          { op: "replace", path: "active", value: true },
        ])
      ).status,
    ).toBe(404);
  });

  it("renames, refuses a taken name, and signs the old login out", async () => {
    // Under SCIM a user signs in only once provisioned.
    const email = mail();
    const u = await createUser(email);
    const s = await signIn(makeIdp(), { email });
    expect((await meOf(s.cookie)).status).toBe(200);
    const other = await createUser();
    expect(
      (await patch("Users", u.id, [{ op: "replace", path: "userName", value: other.userName }]))
        .status,
    ).toBe(409);
    expect(
      (
        await patch("Users", u.id, [
          {
            op: "replace",
            path: "userName",
            value: "renamed@example.invalid".replace("renamed", `r${uniq()}`),
          },
        ])
      ).status,
    ).toBe(200);
    expect((await meOf(s.cookie)).status).toBe(401);
  });

  it("DELETE removes the user and answers 404 afterwards", async () => {
    const u = await createUser();
    expect((await scim(`/Users/${u.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await scim(`/Users/${u.id}`)).status).toBe(404);
    expect((await scim(`/Users/${u.id}`, { method: "DELETE" })).status).toBe(404);
    // The same address can be provisioned again.
    expect((await scim("/Users", { body: { userName: u.userName } })).status).toBe(201);
  });
});

describe("Groups", () => {
  it("creates, filters, patches members and deletes", async () => {
    const [a, b, c] = [await createUser(), await createUser(), await createUser()];
    const name = `Group ${uniq()}`;
    const g = await createGroup(name, { externalId: "ext-g", members: [{ value: a.id }] });
    expect(g).toMatchObject({ displayName: name, externalId: "ext-g" });
    expect(g.members.map((m: Loose) => m.value)).toEqual([a.id]);
    expect(g.meta.resourceType).toBe("Group");

    const f = await json<Loose>(
      await scim(
        `/Groups?filter=${encodeURIComponent(`displayName eq "${name.toUpperCase()}"`)}&excludedAttributes=members`,
      ),
    );
    expect(f.totalResults).toBe(1);
    expect(f.Resources[0].members).toBeUndefined();

    const members = async () =>
      (await json<Loose>(await scim(`/Groups/${g.id}`))).members.map((m: Loose) => m.value).sort();
    expect(
      (
        await patch("Groups", g.id, [
          { op: "Add", path: "members", value: [{ value: b.id }, { value: c.id }] },
        ])
      ).status,
    ).toBe(200);
    expect(await members()).toEqual([a.id, b.id, c.id].sort());
    expect(
      (await patch("Groups", g.id, [{ op: "Remove", path: `members[value eq "${b.id}"]` }])).status,
    ).toBe(200);
    expect(await members()).toEqual([a.id, c.id].sort());
    expect(
      (await patch("Groups", g.id, [{ op: "Remove", path: "members", value: [{ value: c.id }] }]))
        .status,
    ).toBe(200);
    expect(await members()).toEqual([a.id]);
    expect(
      (await patch("Groups", g.id, [{ op: "Replace", path: "members", value: [{ value: b.id }] }]))
        .status,
    ).toBe(200);
    expect(await members()).toEqual([b.id]);
    expect(
      (await patch("Groups", g.id, [{ op: "Replace", path: "displayName", value: `${name} v2` }]))
        .status,
    ).toBe(200);
    expect((await json<Loose>(await scim(`/Groups/${g.id}`))).displayName).toBe(`${name} v2`);
    expect((await patch("Groups", g.id, [{ op: "Remove", path: "members" }])).status).toBe(200);
    expect(await members()).toEqual([]);

    expect((await scim(`/Groups/${g.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await scim(`/Groups/${g.id}`)).status).toBe(404);
  });

  it("is all-or-nothing and rejects duplicates and unknown members", async () => {
    const u = await createUser();
    const name = `Group ${uniq()}`;
    const g = await createGroup(name);
    expect((await scim("/Groups", { body: { displayName: name.toLowerCase() } })).status).toBe(409);
    expect(
      (
        await scim("/Groups", {
          body: {
            displayName: `x${uniq()}`,
            members: [{ value: "00000000-0000-4000-8000-000000000000" }],
          },
        })
      ).status,
    ).toBe(400);
    const bad = await patch("Groups", g.id, [
      { op: "add", path: "members", value: [{ value: u.id }] },
      { op: "add", path: "members", value: [{ value: "00000000-0000-4000-8000-000000000000" }] },
    ]);
    expect(bad.status).toBe(400);
    expect((await json<Loose>(await scim(`/Groups/${g.id}`))).members).toEqual([]);
    expect((await scim("/Groups", { body: { displayName: "" } })).status).toBe(400);
  });
});

describe("group to role mapping through SCIM", () => {
  const GID = "12121212-3434-4565-8787-909090909090";
  beforeAll(async () => {
    await tenantDo(ALPHA).groupMapSet(GID, "reviewer");
  });

  it("applies on the next request and follows the SCIM group, not the stale token", async () => {
    const e = mail();
    const u = await createUser(e);
    // The token still claims the group, but a provisioned user is governed by SCIM alone.
    const s = await signIn(makeIdp(), { email: e, groups: [GID] });
    const roles = async () => (await json<Loose>(await meOf(s.cookie))).principal.roleIds;
    expect(await roles()).toEqual([]);

    const g = await createGroup(`Reviewers ${uniq()}`, { externalId: GID.toUpperCase() });
    expect(
      (await patch("Groups", g.id, [{ op: "Add", path: "members", value: [{ value: u.id }] }]))
        .status,
    ).toBe(200);
    expect(await roles()).toEqual(["reviewer"]);

    expect(
      (await patch("Groups", g.id, [{ op: "Remove", path: `members[value eq "${u.id}"]` }])).status,
    ).toBe(200);
    expect(await roles()).toEqual([]);

    await patch("Groups", g.id, [{ op: "Add", path: "members", value: [{ value: u.id }] }]);
    expect(await roles()).toEqual(["reviewer"]);
    expect((await scim(`/Groups/${g.id}`, { method: "DELETE" })).status).toBe(204);
    expect(await roles()).toEqual([]);
  });

  it("each group change bumps the revocation epoch", async () => {
    const before = await tenantDo(ALPHA).epoch();
    const g = await createGroup(`Epoch ${uniq()}`);
    expect(await tenantDo(ALPHA).epoch()).toBeGreaterThan(before);
    await scim(`/Groups/${g.id}`, { method: "DELETE" });
  });

  it("the role table validates its input", async () => {
    const stub = tenantDo(ALPHA);
    expect(await stub.groupMapSet("ok-group", "not_a_role")).toBeNull();
    expect(await stub.groupMapSet("bad group!", "reviewer")).toBeNull();
    expect(await stub.groupMapSet("Table-Group", "auditor")).toBeTypeOf("number");
    expect(await stub.groupMapList()).toContainEqual({ groupId: "table-group", roleId: "auditor" });
    await stub.groupMapDelete("TABLE-GROUP");
    expect((await stub.groupMapList()).map((r) => r.groupId)).not.toContain("table-group");
  });
});

describe("deprovisioning", () => {
  const deprovisions: [string, (id: string) => Promise<Response>][] = [
    [
      "PATCH active=false (boolean)",
      (id) => patch("Users", id, [{ op: "replace", path: "active", value: false }]),
    ],
    [
      "PATCH active=False (Entra string)",
      (id) => patch("Users", id, [{ op: "Replace", path: "active", value: "False" }]),
    ],
    [
      "PATCH without a path",
      (id) => patch("Users", id, [{ op: "replace", value: { active: false } }]),
    ],
    ["DELETE", (id) => scim(`/Users/${id}`, { method: "DELETE" })],
  ];

  it.each(deprovisions)(
    "%s rejects an existing session on the very next request",
    async (_n, act) => {
      const e = mail();
      const u = await createUser(e);
      const s = await signIn(makeIdp(), { email: e });
      expect((await meOf(s.cookie)).status).toBe(200);
      const epoch = await tenantDo(ALPHA).epoch();

      expect((await act(u.id)).status).toBeLessThan(300);

      expect((await meOf(s.cookie)).status).toBe(401);
      expect(await tenantDo(ALPHA).epoch()).toBeGreaterThan(epoch);
      // No session survives, and nobody can sign in again as that principal.
      const again = await signIn(makeIdp(), { email: e });
      expect(again.callback.status).toBe(403);
      expect(await json(again.callback)).toEqual({ error: "account_disabled" });
      expect(again.cookie).toBeNull();
    },
  );

  it("kills every session of the user, not just one", async () => {
    const e = mail();
    const u = await createUser(e);
    const idp = makeIdp();
    const a = await signIn(idp, { email: e });
    const b = await signIn(idp, { email: e });
    expect((await meOf(a.cookie)).status).toBe(200);
    await patch("Users", u.id, [{ op: "replace", path: "active", value: false }]);
    expect((await meOf(a.cookie)).status).toBe(401);
    expect((await meOf(b.cookie)).status).toBe(401);
  });

  it("also blocks the Cloudflare Access identity of a deprovisioned user", async () => {
    const e = mail();
    const u = await createUser(e);
    expect((await call("/v1/me", { email: e })).status).toBe(200);
    await patch("Users", u.id, [{ op: "replace", path: "active", value: false }]);
    expect((await call("/v1/me", { email: e })).status).toBe(401);
  });

  it("a user created inactive cannot sign in until reactivated", async () => {
    const e = mail();
    const u = await createUser(e, { active: false });
    expect(u.active).toBe(false);
    expect((await signIn(makeIdp(), { email: e })).callback.status).toBe(403);
    expect(
      (await patch("Users", u.id, [{ op: "replace", path: "active", value: true }])).status,
    ).toBe(200);
    const s = await signIn(makeIdp(), { email: e });
    expect(s.callback.status).toBe(303);
    expect((await meOf(s.cookie)).status).toBe(200);
  });

  it("a different user's sessions are untouched", async () => {
    const [ea, eb] = [mail(), mail()];
    const ua = await createUser(ea);
    await createUser(eb);
    const idp = makeIdp();
    const a = await signIn(idp, { email: ea });
    const b = await signIn(idp, { email: eb });
    await patch("Users", ua.id, [{ op: "replace", path: "active", value: false }]);
    expect((await meOf(a.cookie)).status).toBe(401);
    expect((await meOf(b.cookie)).status).toBe(200);
  });
});
