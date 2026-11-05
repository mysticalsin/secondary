import { describe, expect, it } from "vitest";
import { checkAccess, grantsUser, parseMaxAge } from "../src/acl.ts";
import { itemKey, userKey } from "../src/ids.ts";
import { toSourceRecord } from "../src/records.ts";
import { syncSource } from "../src/sync.ts";
import { NOT_CONFIRMED } from "../src/types.ts";
import {
  DELTA,
  DRIVE,
  fakeWorkspace,
  file,
  freshTenant,
  graphMock,
  link,
  page,
  sourceDef,
  storeOf,
  text,
} from "./helpers.ts";

const T0 = 1_700_000_000_000;
const MAX = 900;
const KEY = "test-connector-hmac-key-0123456789abcdef";
const ALICE = "alice@example.invalid";
const permUrl = (id: string) => link(`items/${id}/permissions`);
const user = (email: string, roles = ["read"]) => ({
  roles,
  grantedToV2: { user: { email, displayName: "x" } },
});

async function setup() {
  const tenant = freshTenant();
  const store = storeOf(tenant);
  await store.putSource(sourceDef());
  const g = graphMock();
  const ws = fakeWorkspace();
  const clock = { t: T0 };
  g.on(DELTA, page([file("A", "a.md", "e1")], { delta: link("root/delta?token=T2") }));
  g.on("https://download.example.invalid/A", text("a"));
  await syncSource({ store, graph: g.graph, api: ws.sink, now: () => clock.t }, tenant, "srcbid01");
  const itemId = await itemKey("srcbid01", DRIVE, "A");
  const deps = (over = {}) => ({
    store,
    graph: g.graph,
    now: () => clock.t,
    maxAgeSeconds: MAX,
    enabled: true,
    userKeySecret: KEY,
    ...over,
  });
  const check = (email = ALICE, over = {}) =>
    checkAccess(deps(over), { email }, [itemId]).then((r) => r[itemId]);
  return { store, g, ws, clock, itemId, deps, check, tenant };
}

describe("read-time permission check", () => {
  it("confirms a direct user grant and denies everyone else", async () => {
    const { g, check } = await setup();
    g.on(permUrl("A"), { value: [user(ALICE), user("bob@example.invalid", [])] });
    expect(await check(ALICE)).toEqual({ allowed: true });
    expect(await check("bob@example.invalid")).toEqual({ allowed: false, reason: NOT_CONFIRMED });
    expect(await check("carol@example.invalid")).toEqual({ allowed: false, reason: NOT_CONFIRMED });
  });

  it("matching is case-insensitive and also reads invitations and multi-identity grants", () => {
    expect(grantsUser(user("Alice@Example.Invalid"), ALICE)).toBe(true);
    expect(grantsUser({ roles: ["read"], invitation: { email: ALICE } }, ALICE)).toBe(true);
    expect(
      grantsUser({ roles: ["write"], grantedToIdentitiesV2: [{ user: { email: ALICE } }] }, ALICE),
    ).toBe(true);
    expect(grantsUser({ roles: [], grantedToV2: { user: { email: ALICE } } }, ALICE)).toBe(false);
  });

  it("group grants and sharing links do not confirm (no group resolution under Sites.Selected)", async () => {
    const { g, check } = await setup();
    g.on(permUrl("A"), {
      value: [
        { roles: ["read"], grantedToV2: { group: { displayName: "Bid team", id: "g1" } } },
        { roles: ["read"], link: { scope: "organization", type: "view" } },
      ],
    });
    expect((await check())?.allowed).toBe(false);
  });

  it("caches a decision up to ACL_MAX_AGE_SECONDS, then asks Graph again", async () => {
    const { g, check, clock } = await setup();
    g.on(permUrl("A"), { value: [user(ALICE)] });
    await check();
    clock.t = T0 + (MAX - 1) * 1000;
    await check();
    expect(g.log.filter((u) => u === permUrl("A"))).toHaveLength(1);
    clock.t = T0 + (MAX + 1) * 1000;
    await check();
    expect(g.log.filter((u) => u === permUrl("A"))).toHaveLength(2);
  });

  it("permission revoked at the source: hidden on the next read after the cache expires", async () => {
    const { g, check, clock } = await setup();
    g.on(permUrl("A"), { value: [user(ALICE)] });
    expect((await check())?.allowed).toBe(true);
    g.on(permUrl("A"), { value: [] }); // revoked
    clock.t = T0 + (MAX + 1) * 1000;
    expect(await check()).toEqual({ allowed: false, reason: NOT_CONFIRMED });
  });

  it("a content change from delta drops cached decisions, so the next read re-checks", async () => {
    const { g, check, store, ws, clock, itemId, tenant } = await setup();
    g.on(permUrl("A"), { value: [user(ALICE)] });
    expect((await check())?.allowed).toBe(true);
    expect(await store.getAcl(itemId, await userKey(KEY, ALICE))).not.toBeNull();
    g.on(
      link("root/delta?token=T2"),
      page([file("A", "a.md", "e2")], { delta: link("root/delta?token=T3") }),
    );
    g.on("https://download.example.invalid/A", text("a2"));
    await syncSource(
      { store, graph: g.graph, api: ws.sink, now: () => clock.t },
      tenant,
      "srcbid01",
    );
    expect(await store.getAcl(itemId, await userKey(KEY, ALICE))).toBeNull();
    g.on(permUrl("A"), { value: [] });
    expect((await check())?.allowed).toBe(false); // no waiting for the cache to age out
  });

  it("stale cache and Graph failing: fail closed with the reason, and the failure is not cached", async () => {
    const { g, check, clock, store, itemId } = await setup();
    g.on(permUrl("A"), { value: [user(ALICE)] });
    expect((await check())?.allowed).toBe(true);
    clock.t = T0 + (MAX + 1) * 1000;
    g.on(permUrl("A"), new Response("", { status: 500 }));
    expect(await check()).toEqual({ allowed: false, reason: NOT_CONFIRMED });
    expect((await store.getRecord(itemId))?.aclState).toBe("stale");
    // Graph recovers: the next read gets a real answer, not a cached failure.
    g.on(permUrl("A"), { value: [user(ALICE)] });
    expect((await check())?.allowed).toBe(true);
    expect((await store.getRecord(itemId))?.aclState).toBe("current");
  });

  it("throttled or unreachable Graph also fails closed", async () => {
    const { g, check, clock } = await setup();
    clock.t = T0 + 10 * MAX * 1000;
    g.on(permUrl("A"), new Response("", { status: 429, headers: { "Retry-After": "600" } }));
    expect((await check())?.allowed).toBe(false);
    g.on(permUrl("A"), () => {
      throw new Error("network");
    });
    expect((await check())?.allowed).toBe(false);
  });

  it("404 or 403 from Graph marks the record revoked and hides it", async () => {
    const { g, check, store, itemId } = await setup();
    g.on(permUrl("A"), new Response("", { status: 404 }));
    expect((await check())?.allowed).toBe(false);
    expect((await store.getRecord(itemId))?.aclState).toBe("revoked");
  });

  it("kill switch, disabled Graph, unknown ids and deleted records all deny without calling Graph", async () => {
    const { g, deps, itemId, store } = await setup();
    g.on(permUrl("A"), { value: [user(ALICE)] });
    const ask = (d: object, ids: string[]) => checkAccess(deps(d) as never, { email: ALICE }, ids);
    expect((await ask({ enabled: false }, [itemId]))[itemId]?.allowed).toBe(false);
    expect((await ask({ graph: null }, [itemId]))[itemId]?.allowed).toBe(false);
    const ghost = "src:srcbid01:ffffffffffffffffffffffff";
    expect((await ask({}, [ghost]))[ghost]?.allowed).toBe(false);
    expect(g.log.filter((u) => u === permUrl("A"))).toHaveLength(0);
    await store.deleteTree(itemId);
    expect((await ask({}, [itemId]))[itemId]?.allowed).toBe(false);
    expect(g.log.filter((u) => u === permUrl("A"))).toHaveLength(0);
  });

  it("a disabled source denies", async () => {
    const { store, g, check } = await setup();
    g.on(permUrl("A"), { value: [user(ALICE)] });
    await store.putSource(sourceDef({ enabled: false }));
    expect((await check())?.allowed).toBe(false);
  });

  it("parses ACL_MAX_AGE_SECONDS with a safe default and ceiling", () => {
    expect(parseMaxAge(undefined)).toBe(900);
    expect(parseMaxAge("")).toBe(900);
    expect(parseMaxAge("abc")).toBe(900);
    expect(parseMaxAge("0")).toBe(900);
    expect(parseMaxAge("60")).toBe(60);
    expect(parseMaxAge("999999")).toBe(86_400);
  });
});

describe("SourceRecord output", () => {
  it("is servable only while the ACL check is inside the bound; metadata only", async () => {
    const { g, check, store, itemId, tenant } = await setup();
    const src = sourceDef();
    const rec0 = (await store.getRecord(itemId)) as NonNullable<
      Awaited<ReturnType<typeof store.getRecord>>
    >;
    const sr0 = await toSourceRecord(tenant, src, rec0, null, T0, MAX);
    expect(sr0).toMatchObject({
      acl_state: "unknown",
      servable: false,
      provider: "sharepoint_drive",
    });

    g.on(permUrl("A"), { value: [user(ALICE)] });
    await check();
    const rec1 = (await store.getRecord(itemId)) as typeof rec0;
    const fresh = await toSourceRecord(tenant, src, rec1, null, T0 + 1000, MAX);
    expect(fresh).toMatchObject({ acl_state: "current", servable: true, plane: "TEAM_RESTRICTED" });
    const later = await toSourceRecord(tenant, src, rec1, null, T0 + (MAX + 5) * 1000, MAX);
    expect(later).toMatchObject({ acl_state: "stale", servable: false });
    expect(Object.keys(fresh)).not.toContain("body");
    expect(Object.keys(fresh)).not.toContain("name");
  });
});

describe("M-03: the per-user cache key is keyed and can be forgotten", () => {
  it("is an HMAC under the secret, not a bare hash of the address", async () => {
    const a = await userKey(KEY, ALICE);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(await userKey(KEY, ` ${ALICE.toUpperCase()} `)).toBe(a);
    expect(await userKey("another-secret-0123456789abcdef0123456789", ALICE)).not.toBe(a);
    // What an attacker with a list of addresses and no secret would compute.
    const bare = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`acl-user:${ALICE}`)),
      ),
      (b) => b.toString(16).padStart(2, "0"),
    )
      .join("")
      .slice(0, 32);
    expect(a).not.toBe(bare);
  });

  it("without the secret nothing is confirmed and Graph is not asked", async () => {
    const { g, check } = await setup();
    g.on(permUrl("A"), { value: [user(ALICE)] });
    const before = g.log.length;
    expect(await check(ALICE, { userKeySecret: undefined })).toEqual({
      allowed: false,
      reason: NOT_CONFIRMED,
    });
    expect(g.log.length).toBe(before);
  });
});
