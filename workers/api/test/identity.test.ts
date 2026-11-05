// H-01 and H-02 (B2 security review): an Entra principal is keyed by `tid:oid`, never by an email
// attribute; B2B guests are refused by default; SCIM and sign-in match on the same immutable key and
// an unprovisioned person cannot sign in under a SCIM-managed tenant. Also M-09, M-10 and M-11.

import { beforeAll, describe, expect, it } from "vitest";
import {
  type Claims,
  ENTRA_ENV,
  makeIdp,
  oidFor,
  req,
  SCIM_TOKEN,
  signIn,
} from "./entra-helpers.ts";
import { ALPHA, call, json, type Loose, seed, tenantDo } from "./helpers.ts";

let n = 0;
const upn = () => `ident${++n}-${Date.now()}@example.invalid`;
const U = "urn:ietf:params:scim:schemas:core:2.0:User";
const MANAGED = { SCIM_TOKEN };

const me = (cookie: string | null, env: Record<string, unknown> = {}) =>
  req("/v1/me", { headers: cookie ? { Cookie: cookie } : {}, env });
const meJson = async (cookie: string | null, env: Record<string, unknown> = {}) =>
  (await json<Loose>(await me(cookie, env))).principal as Loose;

const scim = (path: string, method: string, body?: unknown) =>
  req(`/scim/v2${path}`, {
    method,
    body,
    headers: {
      "Content-Type": "application/scim+json",
      Authorization: `Bearer ${SCIM_TOKEN}`,
    },
  });
const provision = async (userName: string, extra: Record<string, unknown> = {}) => {
  const r = await scim("/Users", "POST", { schemas: [U], userName, ...extra });
  expect(r.status).toBe(201);
  return json<Loose>(r);
};

beforeAll(async () => {
  await seed();
});

describe("H-01: identity is tid:oid, the email is an attribute", () => {
  it("a second oid cannot take over a principal by sending the same email", async () => {
    const victim = upn();
    const idp = makeIdp();
    const a = await signIn(idp, { email: victim });
    expect(a.callback.status).toBe(303);
    const victimId = (await meJson(a.cookie)).id;

    // Same UPN, another object id (a different person in the directory): refused, no session.
    const b = await signIn(idp, { email: victim, oid: oidFor("attacker") });
    expect(b.callback.status).toBe(403);
    expect(b.cookie).toBeNull();
    // The real person still signs in as the same principal.
    const again = await signIn(idp, { email: victim });
    expect((await meJson(again.cookie)).id).toBe(victimId);
  });

  it("the `email` claim is not an identity: a mail attribute copied from the victim gets a principal of its own", async () => {
    const victim = upn();
    const idp = makeIdp();
    const v = await signIn(idp, { email: victim });
    const victimId = (await meJson(v.cookie)).id;
    const attackerUpn = upn();
    const x = await signIn(idp, { email: attackerUpn, mail: victim });
    expect(x.callback.status).toBe(303);
    const who = await meJson(x.cookie);
    expect(who.email).toBe(attackerUpn);
    expect(who.id).not.toBe(victimId);
  });

  it("a guest (acct=1) is refused by default, and allowed when ENTRA_ALLOW_GUESTS says so", async () => {
    const guest: Claims = { email: upn(), acct: 1 };
    const no = await signIn(makeIdp(), guest);
    expect(no.callback.status).toBe(403);
    expect(await json(no.callback)).toEqual({ error: "guest_refused" });
    expect(no.cookie).toBeNull();
    const ext = await signIn(makeIdp(), { email: "bob_ext#EXT#@corp.onmicrosoft.com" });
    expect(ext.callback.status).toBe(403);

    const yes = await signIn(makeIdp(), guest, { env: { ENTRA_ALLOW_GUESTS: "yes" } });
    expect(yes.callback.status).toBe(303);
  });

  it("an allowed guest cannot bind to a seeded principal's email, whatever mail it carries", async () => {
    // The seeded CEO is an email-keyed principal (no Entra subject yet).
    const g = await signIn(
      makeIdp(),
      { email: "ceo@example.invalid", acct: 1 },
      { env: { ENTRA_ALLOW_GUESTS: "yes" } },
    );
    expect(g.callback.status).toBe(403);
    expect(g.cookie).toBeNull();
    const viaMail = await signIn(
      makeIdp(),
      { email: "someone-ext#EXT#@corp.onmicrosoft.com", mail: "ceo@example.invalid" },
      { env: { ENTRA_ALLOW_GUESTS: "yes" } },
    );
    expect(viaMail.callback.status).toBe(303);
    expect((await meJson(viaMail.cookie)).roleIds).toEqual([]);
  });

  it("a token without an object id is refused", async () => {
    const r = await signIn(makeIdp(), { email: upn(), oid: "not-a-guid" });
    expect(r.callback.status).toBe(401);
    expect(r.cookie).toBeNull();
  });

  it("the Access identity of an Entra-bound email is a separate source: refused unless linked", async () => {
    const e = upn();
    const env = { ...ENTRA_ENV, AUTH_MODE: "both" };
    const s = await signIn(makeIdp(), { email: e }, { env });
    expect((await me(s.cookie, env)).status).toBe(200);
    expect((await call("/v1/me", { email: e, env })).status).toBe(401);
    expect(
      (await call("/v1/me", { email: e, env: { ...env, ACCESS_LINKED_EMAILS: e } })).status,
    ).toBe(200);
    // An email nobody bound is untouched.
    expect((await call("/v1/me", { email: upn(), env })).status).toBe(200);
  });
});

describe("H-02: SCIM and sign-in match on the same key; unknown means not active", () => {
  it("deprovisioning by SCIM stops the person whose UPN differs from the SCIM userName", async () => {
    const oid = oidFor(`leaver-${n++}`);
    const scimName = upn();
    const u = await provision(scimName, { externalId: oid });
    // Entra signs the person in with another UPN than the SCIM userName.
    const idp = makeIdp();
    const claims: Claims = { email: upn(), oid };
    const s = await signIn(idp, claims, { env: MANAGED });
    expect(s.callback.status).toBe(303);
    const who = await meJson(s.cookie, MANAGED);
    expect(who.email).toBe(scimName);
    // The SCIM user and the signed-in person are one principal.
    expect((await scim(`/Users/${u.id}`, "GET")).status).toBe(200);

    const off = await scim(`/Users/${u.id}`, "PATCH", {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [{ op: "replace", path: "active", value: false }],
    });
    expect(off.status).toBe(200);
    expect((await me(s.cookie, MANAGED)).status).toBe(401);
    const again = await signIn(idp, claims, { env: MANAGED });
    expect(again.callback.status).toBe(403);
    expect(again.cookie).toBeNull();
  });

  it("under a SCIM-managed tenant an unprovisioned person cannot sign in", async () => {
    const r = await signIn(makeIdp(), { email: upn() }, { env: MANAGED });
    expect(r.callback.status).toBe(403);
    expect(await json(r.callback)).toEqual({ error: "account_disabled" });
    expect(r.cookie).toBeNull();
  });

  it("under a SCIM-managed tenant an unknown Access identity is not active", async () => {
    expect((await call("/v1/me", { email: upn(), env: MANAGED })).status).toBe(401);
  });

  it("SCIM group roles reach the person who signs in with another UPN", async () => {
    const oid = oidFor(`grp-${n++}`);
    const u = await provision(upn(), { externalId: oid });
    const GID = "0a0a0a0a-1111-4222-8333-444444444444";
    await tenantDo(ALPHA).groupMapSet(GID, "reviewer");
    const g = await scim("/Groups", "POST", {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
      displayName: `g-${n}`,
      externalId: GID,
      members: [{ value: u.id }],
    });
    expect(g.status).toBe(201);
    const s = await signIn(makeIdp(), { email: upn(), oid }, { env: MANAGED });
    expect((await meJson(s.cookie, MANAGED)).roleIds).toContain("reviewer");
  });
});

describe("M-09, M-10, M-11", () => {
  it("M-11: a directory group never confers a role that can configure the tenant", async () => {
    const stub = tenantDo(ALPHA);
    expect(await stub.groupMapSet("admin-group", "platform_admin")).toBeNull();
    expect((await stub.groupMapList()).some((m: Loose) => m.roleId === "platform_admin")).toBe(
      false,
    );
  });

  it("M-09: under SCIM a sign-in that routes to another tenant than the SCIM directory is refused", async () => {
    const env = {
      ...MANAGED,
      TENANT_DOMAINS: JSON.stringify({ "beta.example.invalid": "tenant_beta" }),
    };
    const r = await signIn(makeIdp(), { email: "someone@beta.example.invalid" }, { env });
    expect(r.callback.status).toBe(403);
    expect(r.cookie).toBeNull();
  });

  it("M-10: after a SCIM rename the old email does not keep NDA grants", async () => {
    const oldName = upn();
    const u = await provision(oldName);
    const stub = tenantDo(ALPHA);
    const pid = await stub.resolvePrincipalId(oldName);
    await stub.grantNda(pid, "a_calypso");
    const newName = upn();
    const r = await scim(`/Users/${u.id}`, "PATCH", {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [{ op: "replace", path: "userName", value: newName }],
    });
    expect(r.status).toBe(200);
    // The old alias is no principal any more: it loads no grants (it used to fall back to the derived id).
    const sess = (email: string) =>
      stub.session({ email, actAs: null, now: Date.now(), limit: 10_000 }) as Promise<Loose>;
    expect((await sess(oldName)).ndaGrants).toEqual([]);
    expect((await sess(newName)).ndaGrants).toEqual(["a_calypso"]);
  });
});
