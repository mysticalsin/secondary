import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ROLES } from "../../packages/policy/src/roles.ts";
import { openSqlite, sqliteStorage } from "../runtime/sqlite-storage.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const TENANT = "synthetic";
const AUTHOR = { id: "u_consultant", email: "consultant@synthetic.example" };
const STRANGER = { id: "u_reviewer", email: "reviewer@synthetic.example" };
const REVIEWER = { id: "u_content_reviewer", email: "content-reviewer@synthetic.example" };
const ADMIN = { id: "u_platform_admin", email: "platform_admin@synthetic.example" };
const LEAD = { id: "u_acme_lead", email: "acme@synthetic.example" };
const CANDIDATE = "cand:c_delivery:abcd1234";
const OTHER_CIRCLE = "cand:c_eng:abcd1234";
const NDA_CANDIDATE = "cand:a_calypso:abcd1234";
const LONG_NODE = `n${"a".repeat(113)}`;
const LONG_CANDIDATE = `cand:${LONG_NODE}:abcd1234`;
const OVER_NODE = `n${"b".repeat(120)}`;
const OVER_CANDIDATE = `cand:${OVER_NODE}:abcd1234`;
const NOT_FOUND = { error: "not_found" };

const hung = {
  release: new Map<string, (pages: unknown[]) => void>(),
  members: [] as string[],
};
let failScope: string | null = null;
const hangIds = new Set<string>();

type App = {
  request: (input: string, init: RequestInit | undefined, env: unknown) => Promise<Response>;
};

function workspace(name: string) {
  const slow =
    name.includes("c_delivery") || name.includes("a_acme") || [...hangIds].some((id) => name.includes(id));
  return {
    brainMemberRead: async () => null,
    brainRoleOf: async () => null,
    brainMembers: async () => {
      hung.members.push(name);
      return [];
    },
    wikiPages: () => {
      if (failScope && name.includes(failScope)) return Promise.reject(new Error("synthetic read failed"));
      if (!slow) return Promise.resolve([]);
      return new Promise<unknown[]>((resolve) => {
        hung.release.set(name, resolve);
      });
    },
    brainConfig: async () => ({ template: null, publication: "review", everyone: null, fields: [] }),
    wikiMeta: async () => null,
    wikiHealth: async () => null,
    get: async (id: string) =>
      id === CANDIDATE ||
      id === OTHER_CIRCLE ||
      id === NDA_CANDIDATE ||
      id === LONG_CANDIDATE ||
      id === OVER_CANDIDATE
        ? {
            id,
            kind: "candidate",
            label: "Synthetic note",
            body: "Plain note",
            status: "candidate",
            revision: 1,
            authorId: AUTHOR.id,
            updatedAt: 1,
          }
        : null,
  };
}

function policy() {
  const dir = mkdtempSync(path.join(tmpdir(), "harden-"));
  const db = openSqlite(path.join(dir, "tenant.sqlite"));
  const sql = sqliteStorage(db);
  let ready: Promise<void> = Promise.resolve();
  const ctx = {
    storage: {
      sql,
      transactionSync<T>(fn: () => T): T {
        return fn();
      },
    },
    blockConcurrencyWhile(fn: () => Promise<void>) {
      ready = fn();
      return ready;
    },
  };
  return {
    dir,
    ctx,
    ready,
    binding: {
      jurisdiction() {
        return this;
      },
      idFromName: (name: string) => name,
      get: (id: string) => (String(id).startsWith("ws:") ? workspace(String(id)) : directory),
    },
  };
}

type Directory = {
  seed: (
    config: { tenantId: string; seed: number; personalOwners: string[] },
    people: {
      id: string;
      email: string;
      roleIds: string[];
      memberships: { scope_type: "circle" | "account"; scope_id: string }[];
    }[],
    now: number,
  ) => number;
  session: (input: { email: string }) => Promise<{
    principal: { id: string; email: string; roleIds: string[]; memberships: [] };
    active: boolean;
    config: unknown;
    switches: Record<string, boolean>;
  }>;
  humanIds: (id: string) => string[];
  gov: (method: string, args: unknown[]) => unknown;
};

let directory: Directory;

/** Add one circle for this test and return a function that takes it back off the shared org. */
async function plantCircle(
  id: string,
  label: string,
  flags: {
    restricted?: boolean;
    nda?: boolean;
    contacts?: boolean;
    parentId?: string | null;
    linkUnder?: string;
  } = {},
): Promise<() => void> {
  const specifier = new URL("../../src/worker/org.ts", import.meta.url).href;
  const orgMod = (await import(specifier)) as {
    getOrg: (config: { tenantId: string; seed: number; personalOwners: string[] }) => {
      nodes: Map<string, { id: string; childIds: string[]; plane: string }>;
    };
  };
  const org = orgMod.getOrg({
    tenantId: TENANT,
    seed: 20261104,
    personalOwners: [AUTHOR.id],
  });
  const parentId = flags.parentId === undefined ? "d_amaris" : flags.parentId;
  const linkUnder = flags.linkUnder ?? (parentId || "d_amaris");
  const parent = org.nodes.get(linkUnder);
  if (!parent) throw new Error("missing department");
  if (!org.nodes.has(id)) {
    org.nodes.set(id, {
      id,
      label,
      kind: "circle",
      plane: parent.plane,
      parentId,
      childIds: [],
      dept: "d_amaris",
      circle: id,
      ...(flags.restricted ? { restricted: true } : {}),
      ...(flags.nda ? { nda: true } : {}),
      ...(flags.contacts ? { contacts: true } : {}),
      facts: {},
      leaf: null,
    } as never);
    parent.childIds.push(id);
  }
  return () => {
    org.nodes.delete(id);
    const still = org.nodes.get(linkUnder);
    if (still) still.childIds = still.childIds.filter((child) => child !== id);
  };
}

async function openDirectory(
  extra: { scope_type: "circle"; scope_id: string }[] = [],
): Promise<{ binding: unknown; remove: () => void }> {
  const made = policy();
  const specifier = new URL("../../src/worker/tenant-policy.ts", import.meta.url).href;
  const mod = (await import(specifier)) as {
    TenantPolicy: new (ctx: unknown, env: unknown) => Directory;
  };
  directory = new mod.TenantPolicy(made.ctx, {});
  await made.ready;
  directory.seed(
    { tenantId: TENANT, seed: 20261104, personalOwners: [AUTHOR.id] },
    [
      {
        id: AUTHOR.id,
        email: AUTHOR.email,
        roleIds: ["consultant"],
        memberships: [
          { scope_type: "circle", scope_id: "c_delivery" },
          { scope_type: "circle", scope_id: "c_eng" },
          ...extra,
        ],
      },
      {
        id: STRANGER.id,
        email: STRANGER.email,
        roleIds: ["consultant"],
        memberships: [{ scope_type: "circle", scope_id: "c_delivery" }],
      },
      {
        id: REVIEWER.id,
        email: REVIEWER.email,
        roleIds: ["reviewer"],
        memberships: [{ scope_type: "circle", scope_id: "c_delivery" }],
      },
      {
        id: ADMIN.id,
        email: ADMIN.email,
        roleIds: ["platform_admin"],
        memberships: [],
      },
      {
        id: LEAD.id,
        email: LEAD.email,
        roleIds: ["acme_lead"],
        memberships: [{ scope_type: "account", scope_id: "a_acme" }],
      },
    ],
    1_700_000_000_000,
  );
  const realGov = directory.gov.bind(directory);
  directory.gov = (method: string, args: unknown[]) => {
    if (method === "listRoles") return { roles: Object.values(ROLES), version: 1 };
    if (method === "members") return [];
    return realGov(method, args);
  };
  made.binding.get = (id: string) =>
    String(id).includes(":") && !String(id).startsWith(TENANT) ? workspace(String(id)) : directory;
  return { binding: made.binding, remove: () => rmSync(made.dir, { recursive: true, force: true }) };
}

function env(binding: unknown, email: string) {
  return {
    ENVIRONMENT: "dev",
    AUTH_MODE: "access",
    DEV_AUTH_BYPASS_EMAIL: email,
    DO_JURISDICTION: "off",
    WIKI_SEED: "off",
    DEFAULT_TENANT_ID: TENANT,
    TENANT_POLICY: binding,
    WORKSPACE: {
      jurisdiction() {
        return this;
      },
      idFromName: (name: string) => `ws:${name}`,
      get: (id: string) => workspace(String(id)),
    },
  };
}

async function app(extra?: { brainBoundMs?: number }): Promise<App> {
  const specifier = new URL("../../src/worker/index.ts", import.meta.url).href;
  const loaded = (await import(specifier)) as {
    createApp: (deps?: { brainBoundMs?: number }) => App;
  };
  return loaded.createApp(extra);
}

async function candidate(api: App, binding: unknown, email: string, id: string) {
  return api.request(`http://127.0.0.1/v1/ux/candidates/${id}`, {}, env(binding, email));
}

async function assertNotFound(res: Response) {
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), NOT_FOUND);
}

test("the author can read a candidate; nodes stay closed", async () => {
  const held = await openDirectory();
  const api = await app();
  try {
    const author = await candidate(api, held.binding, AUTHOR.email, CANDIDATE);
    assert.equal(author.status, 200);
    assert.deepEqual(await author.json(), {
      id: CANDIDATE,
      title: "Synthetic note",
      body: "Plain note",
      status: "candidate",
      revision: 1,
      targetNodeId: "c_delivery",
    });
    const nodes = await api.request(
      `http://127.0.0.1/v1/nodes/${CANDIDATE}`,
      {},
      env(held.binding, AUTHOR.email),
    );
    await assertNotFound(nodes);
  } finally {
    held.remove();
  }
});

test("a reviewer with content rights on the target can read a candidate", async () => {
  const held = await openDirectory();
  const api = await app();
  try {
    const reviewer = await candidate(api, held.binding, REVIEWER.email, CANDIDATE);
    assert.equal(reviewer.status, 200);
    assert.equal((await reviewer.json() as { targetNodeId: string }).targetNodeId, "c_delivery");
  } finally {
    held.remove();
  }
});

test("platform_admin without content rights gets the same 404 as a stranger", async () => {
  const held = await openDirectory();
  const api = await app();
  try {
    await assertNotFound(await candidate(api, held.binding, ADMIN.email, CANDIDATE));
    await assertNotFound(await candidate(api, held.binding, STRANGER.email, CANDIDATE));
  } finally {
    held.remove();
  }
});

test("configure on another node does not open a candidate", async () => {
  const held = await openDirectory();
  const api = await app();
  try {
    await assertNotFound(await candidate(api, held.binding, ADMIN.email, OTHER_CIRCLE));
  } finally {
    held.remove();
  }
});

test("an nda candidate stays hidden from an admin", async () => {
  const held = await openDirectory();
  const api = await app();
  try {
    await assertNotFound(await candidate(api, held.binding, ADMIN.email, NDA_CANDIDATE));
  } finally {
    held.remove();
  }
});

test("an author who lost the node gets 404", async () => {
  const held = await openDirectory();
  const api = await app();
  try {
    await assertNotFound(await candidate(api, held.binding, AUTHOR.email, NDA_CANDIDATE));
  } finally {
    held.remove();
  }
});

test("bad candidate ids share one 404 body", async () => {
  const held = await openDirectory();
  const api = await app();
  const id129 = `cand:n${"a".repeat(114)}:abcd1234`;
  assert.equal(LONG_NODE.length, 114);
  assert.equal(LONG_CANDIDATE.length, 128);
  assert.equal(id129.length, 129);
  try {
    const ids = [
      "not-a-candidate",
      "cand:zz_other_tenant:abcd1234",
      id129,
    ];
    for (const id of ids) {
      await assertNotFound(await candidate(api, held.binding, AUTHOR.email, id));
    }
    const missing = await api.request(
      "http://127.0.0.1/v1/ux/candidates/",
      {},
      env(held.binding, AUTHOR.email),
    );
    await assertNotFound(missing);
  } finally {
    held.remove();
  }
});

test("an author can read a 128-character candidate id", async () => {
  const restore = await plantCircle(LONG_NODE, "Synthetic long circle");
  const held = await openDirectory([{ scope_type: "circle", scope_id: LONG_NODE }]);
  const api = await app();
  try {
    const res = await candidate(api, held.binding, AUTHOR.email, LONG_CANDIDATE);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      id: LONG_CANDIDATE,
      title: "Synthetic note",
      body: "Plain note",
      status: "candidate",
      revision: 1,
      targetNodeId: LONG_NODE,
    });
  } finally {
    restore();
    held.remove();
  }
});

test("a planted candidate node is gone before the next test", async () => {
  const specifier = new URL("../../src/worker/org.ts", import.meta.url).href;
  const orgMod = (await import(specifier)) as {
    getOrg: (config: { tenantId: string; seed: number; personalOwners: string[] }) => {
      nodes: { has(id: string): boolean };
    };
  };
  const org = orgMod.getOrg({ tenantId: TENANT, seed: 20261104, personalOwners: [AUTHOR.id] });
  assert.equal(org.nodes.has(LONG_NODE), false);
});

test("an id longer than 128 characters is not found even when it names a real node", async () => {
  assert.equal(OVER_NODE.length > 114, true);
  assert.equal(OVER_CANDIDATE.length > 128, true);
  const restore = await plantCircle(OVER_NODE, "Synthetic overlong circle");
  const held = await openDirectory([{ scope_type: "circle", scope_id: OVER_NODE }]);
  const api = await app();
  try {
    const res = await candidate(api, held.binding, AUTHOR.email, OVER_CANDIDATE);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), NOT_FOUND);
  } finally {
    restore();
    held.remove();
  }
});

async function restrictionOfLeaves(leaves: string[], hang: string[]) {
  for (const id of hang) hangIds.add(id);
  const held = await openDirectory(leaves.map((id) => ({ scope_type: "circle" as const, scope_id: id })));
  const api = await app({ brainBoundMs: 40 });
  const res = await api.request("http://127.0.0.1/v1/brains", {}, env(held.binding, AUTHOR.email));
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    brains: { id: string; restricted?: boolean; unavailable?: boolean }[];
  };
  return {
    cards: body.brains,
    close() {
      for (const id of hang) hangIds.delete(id);
      held.remove();
    },
  };
}

test("grandparent restriction reaches both the open card and the missed card", async () => {
  const restore: (() => void)[] = [];
  restore.push(await plantCircle("c_gp_top", "Grandparent restricted", { restricted: true, linkUnder: "d_amaris" }));
  restore.push(
    await plantCircle("c_gp_mid", "Grandparent middle", { parentId: "c_gp_top", linkUnder: "d_amaris" }),
  );
  restore.push(
    await plantCircle("c_gp_hit", "Grandparent hit", { parentId: "c_gp_mid", linkUnder: "d_amaris" }),
  );
  restore.push(
    await plantCircle("c_gp_miss", "Grandparent miss", { parentId: "c_gp_mid", linkUnder: "d_amaris" }),
  );
  const read = await restrictionOfLeaves(["c_gp_hit", "c_gp_miss"], ["c_gp_miss"]);
  try {
    const hit = read.cards.find((b) => b.id === "c_gp_hit");
    const miss = read.cards.find((b) => b.id === "c_gp_miss");
    assert.equal(hit?.unavailable, undefined);
    assert.equal(hit?.restricted, true);
    assert.equal(miss?.unavailable, true);
    assert.equal(miss?.restricted, true);
  } finally {
    read.close();
    restore.reverse().forEach((fn) => fn());
  }
});

test("an NDA on a grandparent reaches both the open card and the missed card", async () => {
  const restore: (() => void)[] = [];
  restore.push(await plantCircle("c_nda_top", "NDA grandparent", { nda: true, linkUnder: "d_amaris" }));
  restore.push(
    await plantCircle("c_nda_mid", "NDA middle", { parentId: "c_nda_top", linkUnder: "d_amaris" }),
  );
  restore.push(
    await plantCircle("c_nda_hit", "NDA hit", { parentId: "c_nda_mid", linkUnder: "d_amaris" }),
  );
  restore.push(
    await plantCircle("c_nda_miss", "NDA miss", { parentId: "c_nda_mid", linkUnder: "d_amaris" }),
  );
  const read = await restrictionOfLeaves(["c_nda_hit", "c_nda_miss"], ["c_nda_miss"]);
  try {
    const hit = read.cards.find((b) => b.id === "c_nda_hit");
    const miss = read.cards.find((b) => b.id === "c_nda_miss");
    assert.equal(hit?.unavailable, undefined);
    assert.equal(hit?.restricted, true);
    assert.equal(miss?.unavailable, true);
    assert.equal(miss?.restricted, true);
  } finally {
    read.close();
    restore.reverse().forEach((fn) => fn());
  }
});

test("a missing parent fails closed on both the open card and the missed card", async () => {
  const restore: (() => void)[] = [];
  restore.push(
    await plantCircle("c_gap_hit", "Missing parent hit", { parentId: "c_gap_gone", linkUnder: "d_amaris" }),
  );
  restore.push(
    await plantCircle("c_gap_miss", "Missing parent miss", {
      parentId: "c_gap_gone",
      linkUnder: "d_amaris",
    }),
  );
  const read = await restrictionOfLeaves(["c_gap_hit", "c_gap_miss"], ["c_gap_miss"]);
  try {
    const hit = read.cards.find((b) => b.id === "c_gap_hit");
    const miss = read.cards.find((b) => b.id === "c_gap_miss");
    assert.equal(hit?.unavailable, undefined);
    assert.equal(hit?.restricted, true);
    assert.equal(miss?.unavailable, true);
    assert.equal(miss?.restricted, true);
  } finally {
    read.close();
    restore.reverse().forEach((fn) => fn());
  }
});

test("a chain past the hop cap fails closed on both the open card and the missed card", async () => {
  const restore: (() => void)[] = [];
  restore.push(await plantCircle("c_hop_13", "Hop 13", { parentId: null, linkUnder: "d_amaris" }));
  for (let n = 12; n >= 1; n -= 1) {
    restore.push(
      await plantCircle(`c_hop_${n}`, `Hop ${n}`, {
        parentId: `c_hop_${n + 1}`,
        linkUnder: "d_amaris",
      }),
    );
  }
  restore.push(
    await plantCircle("c_hop_hit", "Hop hit", { parentId: "c_hop_1", linkUnder: "d_amaris" }),
  );
  restore.push(
    await plantCircle("c_hop_miss", "Hop miss", { parentId: "c_hop_1", linkUnder: "d_amaris" }),
  );
  const read = await restrictionOfLeaves(["c_hop_hit", "c_hop_miss"], ["c_hop_miss"]);
  try {
    const hit = read.cards.find((b) => b.id === "c_hop_hit");
    const miss = read.cards.find((b) => b.id === "c_hop_miss");
    assert.equal(hit?.unavailable, undefined);
    assert.equal(hit?.restricted, true);
    assert.equal(miss?.unavailable, true);
    assert.equal(miss?.restricted, true);
  } finally {
    read.close();
    restore.reverse().forEach((fn) => fn());
  }
});

test("a missed card under a restricted ancestor is restricted", async () => {
  const specifier = new URL("../../src/worker/org.ts", import.meta.url).href;
  const orgMod = (await import(specifier)) as {
    getOrg: (config: { tenantId: string; seed: number; personalOwners: string[] }) => {
      nodes: Map<string, { restricted?: boolean }>;
    };
  };
  const org = orgMod.getOrg({ tenantId: TENANT, seed: 20261104, personalOwners: [AUTHOR.id] });
  assert.equal(org.nodes.has(OVER_NODE), false);
  const dept = org.nodes.get("d_amaris");
  if (!dept) throw new Error("missing department");
  const previous = dept.restricted;
  dept.restricted = true;
  const held = await openDirectory();
  const api = await app({ brainBoundMs: 40 });
  try {
    const res = await api.request("http://127.0.0.1/v1/brains", {}, env(held.binding, AUTHOR.email));
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      brains: { id: string; restricted?: boolean; unavailable?: boolean }[];
    };
    const card = body.brains.find((b) => b.id === "c_delivery");
    assert.equal(card?.unavailable, true);
    assert.equal(card?.restricted, true);
  } finally {
    dept.restricted = previous;
    held.remove();
  }
});

test("one workspace that never answers does not stall the brain directory", async () => {
  const held = await openDirectory();
  const api = await app({ brainBoundMs: 40 });
  try {
    const bindings = env(held.binding, AUTHOR.email);
    const raced = await Promise.race([
      api.request("http://127.0.0.1/v1/brains?scope=all", {}, bindings),
      new Promise<string>((resolve) => setTimeout(() => resolve("hung"), 400)),
    ]);
    assert.notEqual(raced, "hung");
    const res = raced as Response;
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      brains: {
        id: string;
        name: string;
        unavailable?: boolean;
        pages: number;
        role?: string;
        restricted?: boolean;
      }[];
    };
    const slow = body.brains.find((b) => b.id === "c_delivery");
    const mine = body.brains.find((b) => b.id === "me");
    assert.equal(slow?.unavailable, true);
    assert.equal(slow?.name.length > 0, true);
    assert.equal(slow?.pages, 0);
    assert.equal(slow?.restricted, false);
    assert.equal(slow?.role, "contributor");
    assert.equal(slow !== undefined && "template" in slow, false);
    assert.equal(mine?.unavailable, undefined);
    const plain = await Promise.race([
      api.request("http://127.0.0.1/v1/brains", {}, bindings),
      new Promise<string>((resolve) => setTimeout(() => resolve("hung"), 400)),
    ]);
    assert.notEqual(plain, "hung");
  } finally {
    held.remove();
  }
});

test("an unavailable brain keeps the type and query filters and its real restricted flag", async () => {
  const held = await openDirectory();
  const api = await app({ brainBoundMs: 40 });
  try {
    const accounts = await api.request(
      "http://127.0.0.1/v1/brains?type=account",
      {},
      env(held.binding, AUTHOR.email),
    );
    assert.equal(accounts.status, 200);
    const accountBody = (await accounts.json()) as { brains: { id: string }[] };
    assert.equal(accountBody.brains.some((b) => b.id === "c_delivery"), false);
    const queried = await api.request(
      "http://127.0.0.1/v1/brains?q=zzzz",
      {},
      env(held.binding, AUTHOR.email),
    );
    const queriedBody = (await queried.json()) as { brains: { id: string }[] };
    assert.equal(queriedBody.brains.some((b) => b.id === "c_delivery"), false);

    const lead = await api.request(
      "http://127.0.0.1/v1/brains?type=account",
      {},
      env(held.binding, LEAD.email),
    );
    assert.equal(lead.status, 200);
    const leadBody = (await lead.json()) as {
      brains: { id: string; unavailable?: boolean; restricted?: boolean; role?: string }[];
    };
    const acme = leadBody.brains.find((b) => b.id === "a_acme");
    assert.equal(acme?.unavailable, true);
    assert.equal(acme?.restricted, true);
    assert.equal(acme?.role, "owner");
    assert.equal(acme !== undefined && "template" in acme, false);
    const teams = await api.request(
      "http://127.0.0.1/v1/brains?type=team",
      {},
      env(held.binding, LEAD.email),
    );
    const teamBody = (await teams.json()) as { brains: { id: string }[] };
    assert.equal(teamBody.brains.some((b) => b.id === "a_acme"), false);
  } finally {
    held.remove();
  }
});

test("the brain bound answers at 2500 ms and aborts only the brain that missed", async (t) => {
  const realSetTimeout = globalThis.setTimeout;
  const origAbort = AbortController.prototype.abort;
  let aborts = 0;
  let armed = 0;
  AbortController.prototype.abort = function (this: AbortController, reason?: unknown) {
    aborts += 1;
    return origAbort.call(this, reason);
  };
  failScope = "c_eng";
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const mockedSet = globalThis.setTimeout;
  globalThis.setTimeout = ((fn: Parameters<typeof setTimeout>[0], ms?: number) => {
    if (ms === 2500) armed += 1;
    return mockedSet(fn, ms);
  }) as typeof setTimeout;
  const held = await openDirectory();
  const api = await app();
  try {
    let settled = false;
    const pending = api
      .request("http://127.0.0.1/v1/brains", {}, env(held.binding, AUTHOR.email))
      .then((res) => {
        settled = true;
        return res;
      });
    const start = Date.now();
    while (armed === 0) {
      if (Date.now() - start > 2000) throw new Error("bound was not armed");
      await new Promise((resolve) => realSetTimeout(resolve, 10));
    }
    assert.equal(settled, false);
    await t.mock.timers.tick(2499);
    await new Promise((resolve) => realSetTimeout(resolve, 20));
    assert.equal(settled, false);
    await t.mock.timers.tick(1);
    await new Promise((resolve) => realSetTimeout(resolve, 30));
    assert.equal(settled, true);
    const res = await pending;
    assert.equal(res.status, 200);
    const body = (await res.json()) as { brains: { id: string; unavailable?: boolean }[] };
    assert.equal(body.brains.find((b) => b.id === "c_delivery")?.unavailable, true);
    assert.equal(aborts, 1);
    for (const release of hung.release.values()) release([]);
    await new Promise((resolve) => realSetTimeout(resolve, 20));
    assert.equal(
      hung.members.some((name) => name.includes("c_delivery")),
      false,
    );
  } finally {
    failScope = null;
    hung.release.clear();
    hung.members.length = 0;
    AbortController.prototype.abort = origAbort;
    t.mock.timers.reset();
    held.remove();
  }
});

test("health names neither the environment nor the version", async () => {
  const api = await app();
  const res = await api.request("http://127.0.0.1/v1/health", {}, { ENVIRONMENT: "dev" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test("anonymous internal path variants are 401", async () => {
  const api = await app();
  for (const path of [
    "/v1/internal///ops/targets",
    "/v1/internal/%2Fops/targets",
    "/v1//internal",
    "/v1/internal/mcp//switches",
  ]) {
    const res = await api.request(`http://127.0.0.1${path}`, {}, { ENVIRONMENT: "test" });
    assert.equal(res.status, 401, path);
    assert.deepEqual(await res.json(), { error: "unauthorized" });
  }
});

test("a signed-in caller gets 404 for internal slash forms that are not the ops route", async () => {
  const held = await openDirectory();
  const api = await app();
  try {
    for (const path of [
      "/v1/internal///ops/targets",
      "/v1/internal/%2Fops/targets",
      "/v1//internal",
    ]) {
      const res = await api.request(
        `http://127.0.0.1${path}`,
        {},
        env(held.binding, AUTHOR.email),
      );
      assert.equal(res.status, 404, path);
      assert.deepEqual(await res.json(), NOT_FOUND);
    }
    const mcp = await api.request(
      "http://127.0.0.1/v1/internal/mcp//switches",
      {},
      env(held.binding, AUTHOR.email),
    );
    assert.equal(mcp.status, 401);
    assert.deepEqual(await mcp.json(), { error: "unauthorized" });
  } finally {
    held.remove();
  }
});

test("the repro script refuses a path outside the repo", async () => {
  const script = new URL("../../docs/auth/mantu-503-repro.mjs", import.meta.url);
  const root = new URL("../../", import.meta.url);
  const outside = spawnSync(process.execPath, [script.pathname, "/tmp"], { encoding: "utf8" });
  assert.equal(outside.status, 1);
  assert.match(outside.stderr, /refused: path is outside the repo/);
  const inside = spawnSync(process.execPath, [script.pathname, root.pathname], { encoding: "utf8" });
  assert.equal(inside.status, 1);
  assert.equal(/refused: path is outside the repo/.test(inside.stderr), false);
  const parent = spawnSync(process.execPath, [script.pathname, path.resolve(root.pathname, "..")], {
    encoding: "utf8",
  });
  assert.equal(parent.status, 1);
  assert.match(parent.stderr, /refused: path is outside the repo/);
});

test("the repro script refuses a symlinked entry.js outside the repo", async () => {
  const script = new URL("../../docs/auth/mantu-503-repro.mjs", import.meta.url);
  const root = new URL("../../", import.meta.url);
  const outside = mkdtempSync(path.join(tmpdir(), "repro-out-"));
  const scratch = mkdtempSync(path.join(root.pathname, ".repro-scratch-"));
  try {
    writeFileSync(
      path.join(outside, "entry.js"),
      "export default { fetch: async () => new Response('x') };\n",
    );
    const linkedDir = path.join(scratch, "via-link");
    symlinkSync(outside, linkedDir);
    const viaDir = spawnSync(process.execPath, [script.pathname, linkedDir], { encoding: "utf8" });
    assert.equal(viaDir.status, 1);
    assert.match(viaDir.stderr, /refused: path is outside the repo/);

    const holder = path.join(scratch, "holder");
    mkdirSync(path.join(holder, "worker"), { recursive: true });
    symlinkSync(path.join(outside, "entry.js"), path.join(holder, "worker", "entry.js"));
    const viaEntry = spawnSync(process.execPath, [script.pathname, holder], { encoding: "utf8" });
    assert.equal(viaEntry.status, 1);
    assert.match(viaEntry.stderr, /refused: path is outside the repo/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
