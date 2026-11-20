/**
 * Red tests for one in-flight raw tree read per workspace.
 * The handler still starts one read per request, so the sharing assertions fail.
 * Clocks are mock timers. The 2500ms bound is not a real sleep.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
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
const NARROW = { id: "u_reviewer", email: "reviewer@synthetic.example" };
const OUTSIDER = { id: "u_outsider", email: "outsider@synthetic.example" };
const CAP_A = { id: "u_cap_a", email: "cap-a@synthetic.example" };
const CAP_B = { id: "u_cap_b", email: "cap-b@synthetic.example" };
const CAP_C = { id: "u_cap_c", email: "cap-c@synthetic.example" };
const PAGES = [
  { id: "plain", title: "Plain page", type: "note", markdown: "hello" },
  { id: "secret", title: "Secret page", type: "note", markdown: "see {src:secret}" },
];

type Page = (typeof PAGES)[number];

const reads: string[] = [];
const callArgs: { fn: string; args: string }[] = [];
const release = new Map<string, (pages: Page[]) => void>();
let rejectDelivery = false;
let paceMs: number | null = null;
let serveNow = false;
let pages: Page[] = PAGES;
let hangPrefix = "c_delivery";

function capId(index: number): string {
  return `c_cap_${String(index).padStart(2, "0")}`;
}

function deliveryReads(): number {
  return reads.filter((name) => name.includes("c_delivery")).length;
}

function capReads(): number {
  return reads.filter((name) => name.includes("c_cap_")).length;
}

function workspace(name: string) {
  return {
    brainMemberRead: async () => null,
    brainRoleOf: async () => null,
    brainMembers: async () => [],
    wikiPages: (...args: unknown[]) => {
      callArgs.push({ fn: "wikiPages", args: JSON.stringify(args) });
      reads.push(name);
      const tracked = name.includes("c_delivery") || name.includes("c_cap_") || name.includes("c_private");
      if (!tracked) return Promise.resolve([]);
      const hangThis =
        name.includes("c_cap_") ||
        (paceMs === null && !serveNow && !rejectDelivery && name.includes(hangPrefix));
      if (hangThis) {
        return new Promise<Page[]>((resolve) => {
          release.set(name, resolve);
        });
      }
      if (rejectDelivery && name.includes("c_delivery")) {
        rejectDelivery = false;
        return Promise.reject(new Error("synthetic read failed"));
      }
      if (serveNow) return Promise.resolve(pages);
      if (paceMs !== null) {
        const ms = paceMs;
        return new Promise<Page[]>((resolve) => {
          setTimeout(() => resolve(pages), ms);
        });
      }
      return Promise.resolve([]);
    },
    wikiSourceRefs: async (ids: string[]) =>
      ids
        .filter((id) => id === "secret")
        .map((id) => ({ id, kind: "item" as const, title: "Secret", gateNodeId: "c_private" })),
    brainConfig: async () => ({ template: null, publication: "review", everyone: null, fields: [] }),
    wikiMeta: async () => null,
    wikiHealth: async () => null,
    wikiTouch: async () => {},
    wikiSchema: async (...args: unknown[]) => {
      callArgs.push({ fn: "wikiSchema", args: JSON.stringify(args) });
      return { types: { note: { label: "Note" } } };
    },
    wikiPage: async () => null,
  };
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
      idFromName: (idName: string) => `ws:${idName}`,
      get: (id: string) => workspace(String(id)),
    },
  };
}

async function openDirectory(): Promise<{ binding: unknown; remove: () => void }> {
  const dir = mkdtempSync(path.join(tmpdir(), "inflight-"));
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
  const binding: {
    jurisdiction: () => typeof binding;
    idFromName: (name: string) => string;
    get: (id: string) => unknown;
  } = {
    jurisdiction() {
      return this;
    },
    idFromName: (name: string) => name,
    get: () => directory,
  };
  const specifier = new URL("../../src/worker/tenant-policy.ts", import.meta.url).href;
  const mod = (await import(specifier)) as {
    TenantPolicy: new (ctx: unknown, env: unknown) => {
      seed: (
        config: { tenantId: string; seed: number; personalOwners: string[] },
        people: {
          id: string;
          email: string;
          roleIds: string[];
          memberships: { scope_type: "circle"; scope_id: string }[];
        }[],
        now: number,
      ) => number;
      gov: (method: string, args: unknown[]) => unknown;
    };
  };
  const directory = new mod.TenantPolicy(ctx, {});
  await ready;
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
          { scope_type: "circle", scope_id: "c_private" },
        ],
      },
      {
        id: NARROW.id,
        email: NARROW.email,
        roleIds: ["consultant"],
        memberships: [{ scope_type: "circle", scope_id: "c_delivery" }],
      },
      {
        id: OUTSIDER.id,
        email: OUTSIDER.email,
        roleIds: ["consultant"],
        memberships: [{ scope_type: "circle", scope_id: "c_eng" }],
      },
      {
        id: CAP_A.id,
        email: CAP_A.email,
        roleIds: ["consultant"],
        memberships: Array.from({ length: 39 }, (_, index) => ({
          scope_type: "circle" as const,
          scope_id: capId(index),
        })),
      },
      {
        id: CAP_B.id,
        email: CAP_B.email,
        roleIds: ["consultant"],
        memberships: Array.from({ length: 26 }, (_, index) => ({
          scope_type: "circle" as const,
          scope_id: capId(39 + index),
        })),
      },
      {
        id: CAP_C.id,
        email: CAP_C.email,
        roleIds: ["consultant"],
        memberships: [36, 37, 38].map((index) => ({
          scope_type: "circle" as const,
          scope_id: capId(index),
        })),
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
  binding.get = (id: string) =>
    String(id).includes(":") && !String(id).startsWith(TENANT) ? workspace(String(id)) : directory;
  return { binding, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

type App = {
  request: (input: string, init: RequestInit | undefined, env: unknown) => Promise<Response>;
};

async function app(extra?: { treeBoundMs?: number }): Promise<App> {
  const specifier = new URL("../../src/worker/index.ts", import.meta.url).href;
  const loaded = (await import(specifier)) as {
    createApp: (deps?: { treeBoundMs?: number }) => App;
  };
  return loaded.createApp(extra);
}

function tree(api: App, binding: unknown, email: string) {
  return api.request("http://127.0.0.1/v1/brain/tree", {}, env(binding, email));
}

async function untilStable(read: () => number, wait: typeof setTimeout): Promise<void> {
  let last = -1;
  let stable = 0;
  const start = Date.now();
  while (Date.now() - start < 2000) {
    const n = read();
    if (n > 0 && n === last) stable += 1;
    else stable = 0;
    last = n;
    if (stable >= 3) return;
    await new Promise((resolve) => wait(resolve, 15));
  }
}

function finishHung(): void {
  for (const resolve of release.values()) resolve([]);
  release.clear();
}

test("n concurrent tree requests for one hung brain share one pending read", async (t) => {
  const held = await openDirectory();
  const api = await app({ treeBoundMs: 2500 });
  reads.length = 0;
  const realSetTimeout = globalThis.setTimeout;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const pending = Promise.all(
      [0, 1, 2, 3].map(() => tree(api, held.binding, AUTHOR.email)),
    );
    await untilStable(deliveryReads, realSetTimeout);
    assert.equal(deliveryReads(), 1);
    await t.mock.timers.tick(2500);
    const responses = await pending;
    for (const res of responses) assert.equal(res.status, 200);
  } finally {
    finishHung();
    globalThis.setTimeout = realSetTimeout;
    t.mock.timers.reset();
    held.remove();
  }
});

test("after settle a new read starts", async (t) => {
  const held = await openDirectory();
  const api = await app({ treeBoundMs: 2500 });
  reads.length = 0;
  paceMs = 10;
  const realSetTimeout = globalThis.setTimeout;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const first = tree(api, held.binding, AUTHOR.email);
    const second = tree(api, held.binding, AUTHOR.email);
    await untilStable(deliveryReads, realSetTimeout);
    assert.equal(deliveryReads(), 1);
    await t.mock.timers.tick(10);
    await first;
    await second;
    const third = tree(api, held.binding, AUTHOR.email);
    await t.mock.timers.tick(10);
    const res = await third;
    assert.equal(res.status, 200);
    assert.equal(deliveryReads(), 2);
  } finally {
    paceMs = null;
    globalThis.setTimeout = realSetTimeout;
    t.mock.timers.reset();
    held.remove();
  }
});

test("after the unsettled TTL a new read starts", async (t) => {
  const held = await openDirectory();
  const api = await app({ treeBoundMs: 2500 });
  reads.length = 0;
  const realSetTimeout = globalThis.setTimeout;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const first = tree(api, held.binding, AUTHOR.email);
    await untilStable(deliveryReads, realSetTimeout);
    assert.equal(deliveryReads(), 1);
    await t.mock.timers.tick(30_000);
    const second = tree(api, held.binding, AUTHOR.email);
    await untilStable(deliveryReads, realSetTimeout);
    assert.equal(deliveryReads(), 2);
    await t.mock.timers.tick(2500);
    await first;
    await second;
  } finally {
    finishHung();
    globalThis.setTimeout = realSetTimeout;
    t.mock.timers.reset();
    held.remove();
  }
});

async function plantPrivate(): Promise<void> {
  const specifier = new URL("../../src/worker/org.ts", import.meta.url).href;
  const orgMod = (await import(specifier)) as {
    getOrg: (config: { tenantId: string; seed: number; personalOwners: string[] }) => {
      nodes: Map<string, { id: string; childIds: string[]; plane: string }>;
    };
  };
  const org = orgMod.getOrg({ tenantId: TENANT, seed: 20261104, personalOwners: [AUTHOR.id] });
  if (org.nodes.has("c_private")) return;
  const parent = org.nodes.get("d_amaris");
  if (!parent) throw new Error("missing department");
  org.nodes.set("c_private", {
    id: "c_private",
    label: "Private circle",
    kind: "circle",
    plane: parent.plane,
    parentId: parent.id,
    childIds: [],
    dept: parent.id,
    circle: "c_private",
    facts: {},
    leaf: null,
  } as never);
  parent.childIds.push("c_private");
}

test("two users with different ACLs never receive each other's filtered pages", async (t) => {
  await plantPrivate();
  const held = await openDirectory();
  const api = await app({ treeBoundMs: 2500 });
  reads.length = 0;
  paceMs = 10;
  const realSetTimeout = globalThis.setTimeout;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const wide = tree(api, held.binding, AUTHOR.email);
    const narrow = tree(api, held.binding, NARROW.email);
    await untilStable(deliveryReads, realSetTimeout);
    await t.mock.timers.tick(10);
    const wideBody = JSON.stringify(await (await wide).json());
    const narrowBody = JSON.stringify(await (await narrow).json());
    assert.equal(wideBody.includes("Secret page"), true);
    assert.equal(narrowBody.includes("Secret page"), false);
    assert.equal(narrowBody.includes("Plain page"), true);
    assert.equal(deliveryReads(), 1);
  } finally {
    paceMs = null;
    globalThis.setTimeout = realSetTimeout;
    t.mock.timers.reset();
    held.remove();
  }
});

test("a rejected read is not reused", async (t) => {
  const held = await openDirectory();
  const api = await app({ treeBoundMs: 2500 });
  reads.length = 0;
  rejectDelivery = true;
  const realSetTimeout = globalThis.setTimeout;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const failed = await tree(api, held.binding, AUTHOR.email);
    assert.equal(failed.status, 200);
    const failedBody = (await failed.json()) as { roots: { id: string; access: string }[] };
    assert.equal(failedBody.roots.find((root) => root.id === "c_delivery")?.access, "degraded");
    paceMs = 10;
    const again = tree(api, held.binding, AUTHOR.email);
    await untilStable(deliveryReads, realSetTimeout);
    await t.mock.timers.tick(10);
    const res = await again;
    const body = (await res.json()) as { roots: { id: string; access: string; children?: { label: string }[] }[] };
    const delivery = body.roots.find((root) => root.id === "c_delivery");
    assert.equal(delivery?.access, "full");
    assert.equal(JSON.stringify(delivery).includes("Plain page"), true);
    assert.equal(deliveryReads(), 2);
  } finally {
    rejectDelivery = false;
    paceMs = null;
    globalThis.setTimeout = realSetTimeout;
    t.mock.timers.reset();
    held.remove();
  }
});

test("wikiPages and wikiSchema arguments do not carry the principal", async () => {
  const held = await openDirectory();
  const api = await app({ treeBoundMs: 40 });
  callArgs.length = 0;
  serveNow = true;
  try {
    const wide = await tree(api, held.binding, AUTHOR.email);
    const narrow = await tree(api, held.binding, NARROW.email);
    assert.equal(wide.status, 200);
    assert.equal(narrow.status, 200);
    assert.ok(callArgs.length > 0);
    const dumped = JSON.stringify(callArgs);
    assert.equal(dumped.includes(AUTHOR.id), false);
    assert.equal(dumped.includes(NARROW.id), false);
    assert.equal(dumped.includes(AUTHOR.email), false);
    assert.equal(dumped.includes(NARROW.email), false);
    const pageArgs = callArgs.filter((call) => call.fn === "wikiPages").map((call) => call.args);
    const schemaArgs = callArgs.filter((call) => call.fn === "wikiSchema").map((call) => call.args);
    assert.equal(new Set(pageArgs).size, 1);
    assert.equal(new Set(schemaArgs).size, 1);
  } finally {
    serveNow = false;
    held.remove();
  }
});

test("a caller who is not admitted does not join the pending read", async (t) => {
  await plantPrivate();
  const held = await openDirectory();
  const api = await app({ treeBoundMs: 2500 });
  reads.length = 0;
  hangPrefix = "c_private";
  const realSetTimeout = globalThis.setTimeout;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const privateReads = () => reads.filter((name) => name.includes("c_private")).length;
    const hung = tree(api, held.binding, AUTHOR.email);
    await untilStable(privateReads, realSetTimeout);
    assert.equal(privateReads(), 1);
    const outsider = await Promise.race([
      tree(api, held.binding, OUTSIDER.email).then(async (res) => ({ status: res.status, body: await res.text() })),
      new Promise<string>((resolve) => realSetTimeout(() => resolve("waited"), 400)),
    ]);
    assert.notEqual(outsider, "waited");
    if (typeof outsider === "string") throw new Error(outsider);
    assert.equal(outsider.status, 200);
    assert.equal(privateReads(), 1);
    await t.mock.timers.tick(2500);
    await hung;
  } finally {
    finishHung();
    hangPrefix = "c_delivery";
    globalThis.setTimeout = realSetTimeout;
    t.mock.timers.reset();
    held.remove();
  }
});

test("structured inflight key does not collide", async () => {
  const specifier = new URL("../../src/worker/uxv2/tree.ts", import.meta.url).href;
  const mod = (await import(specifier)) as {
    inflightKey: (tenantId: string, scope: string) => string;
  };
  const left = mod.inflightKey("a:b", "c");
  const right = mod.inflightKey("a", "b:c");
  const bracket = mod.inflightKey("t", '["x"]');
  const plain = mod.inflightKey("t", "x");
  const bracketTenant = mod.inflightKey('["x"]', "scope");
  assert.notEqual(left, right);
  assert.notEqual(bracket, plain);
  assert.notEqual(bracketTenant, mod.inflightKey("x", "scope"));
  const entries = new Map<string, string>();
  entries.set(left, "first");
  entries.set(right, "second");
  entries.set(bracket, "bracket");
  entries.set(plain, "plain");
  assert.equal(entries.size, 4);
  assert.equal(entries.get(left), "first");
  assert.equal(entries.get(right), "second");
});

test("a workspace write drops the pending read and the new page is present", async (t) => {
  const held = await openDirectory();
  const api = await app({ treeBoundMs: 2500 });
  reads.length = 0;
  pages = [{ id: "old", title: "Old page", type: "note", markdown: "old" }];
  paceMs = 10;
  const realSetTimeout = globalThis.setTimeout;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const first = tree(api, held.binding, AUTHOR.email);
    await untilStable(deliveryReads, realSetTimeout);
    pages = [{ id: "written", title: "Written page", type: "note", markdown: "written" }];
    const second = tree(api, held.binding, AUTHOR.email);
    await untilStable(deliveryReads, realSetTimeout);
    assert.equal(deliveryReads(), 2);
    await t.mock.timers.tick(10);
    const body = JSON.stringify(await (await second).json());
    assert.equal(body.includes("Written page"), true);
    await first;
  } finally {
    pages = PAGES;
    paceMs = null;
    globalThis.setTimeout = realSetTimeout;
    t.mock.timers.reset();
    held.remove();
  }
});

test("a late settle does not replace the read started after the TTL", async (t) => {
  const held = await openDirectory();
  const api = await app({ treeBoundMs: 2500 });
  reads.length = 0;
  pages = [{ id: "first", title: "First page", type: "note", markdown: "first" }];
  const realSetTimeout = globalThis.setTimeout;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const first = tree(api, held.binding, AUTHOR.email);
    await untilStable(deliveryReads, realSetTimeout);
    const joiner = tree(api, held.binding, AUTHOR.email);
    await untilStable(deliveryReads, realSetTimeout);
    assert.equal(deliveryReads(), 1);
    await t.mock.timers.tick(30_000);
    pages = [{ id: "second", title: "Second page", type: "note", markdown: "second" }];
    paceMs = 10;
    const second = tree(api, held.binding, AUTHOR.email);
    await t.mock.timers.tick(10);
    const secondBody = JSON.stringify(await (await second).json());
    for (const resolve of release.values()) resolve([{ id: "first", title: "First page", type: "note", markdown: "first" }]);
    release.clear();
    assert.equal(secondBody.includes("Second page"), true);
    assert.equal(secondBody.includes("First page"), false);
    await t.mock.timers.tick(2500);
    await first;
    await joiner;
  } finally {
    pages = PAGES;
    paceMs = null;
    finishHung();
    globalThis.setTimeout = realSetTimeout;
    t.mock.timers.reset();
    held.remove();
  }
});

async function plantCaps(): Promise<void> {
  const specifier = new URL("../../src/worker/org.ts", import.meta.url).href;
  const orgMod = (await import(specifier)) as {
    getOrg: (config: { tenantId: string; seed: number; personalOwners: string[] }) => {
      nodes: Map<string, { id: string; childIds: string[]; plane: string }>;
    };
  };
  const org = orgMod.getOrg({ tenantId: TENANT, seed: 20261104, personalOwners: [AUTHOR.id] });
  const parent = org.nodes.get("d_amaris");
  if (!parent) throw new Error("missing department");
  for (let index = 0; index < 65; index += 1) {
    const id = capId(index);
    if (org.nodes.has(id)) continue;
    org.nodes.set(id, {
      id,
      label: id,
      kind: "circle",
      plane: parent.plane,
      parentId: parent.id,
      childIds: [],
      dept: parent.id,
      circle: id,
      facts: {},
      leaf: null,
    } as never);
    parent.childIds.push(id);
  }
  const existing = [...org.nodes.entries()];
  org.nodes.clear();
  for (let index = 0; index < 65; index += 1) {
    const id = capId(index);
    const node = existing.find(([key]) => key === id);
    if (node) org.nodes.set(node[0], node[1]);
  }
  for (const [key, node] of existing) if (!org.nodes.has(key)) org.nodes.set(key, node);
}

test("the 65th scope evicts the oldest unsettled read", async (t) => {
  await plantCaps();
  const held = await openDirectory();
  const api = await app({ treeBoundMs: 2500 });
  reads.length = 0;
  const realSetTimeout = globalThis.setTimeout;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const first = tree(api, held.binding, CAP_A.email);
    const second = tree(api, held.binding, CAP_B.email);
    const third = tree(api, held.binding, CAP_C.email);
    const start = Date.now();
    while (capReads() < 65 && Date.now() - start < 2000) {
      await new Promise((resolve) => realSetTimeout(resolve, 20));
    }
    assert.equal(capReads(), 65, `started ${capReads()}`);
    assert.ok(capReads() <= 64, `pending ${capReads()} is not capped`);
    const oldest = reads.filter((name) => name.includes(capId(0))).length;
    const again = tree(api, held.binding, CAP_A.email);
    await untilStable(() => reads.filter((name) => name.includes(capId(0))).length, realSetTimeout);
    assert.equal(reads.filter((name) => name.includes(capId(0))).length, oldest + 1);
    for (const resolve of [...release.values()]) resolve([{ id: "evicted", title: "Evicted page", type: "note", markdown: "evicted" }]);
    release.clear();
    const againBody = JSON.stringify(await (await again).json());
    assert.equal(againBody.includes("Evicted page"), false);
    await t.mock.timers.tick(2500);
    await first;
    await second;
    await third;
    await again;
  } finally {
    finishHung();
    globalThis.setTimeout = realSetTimeout;
    t.mock.timers.reset();
    held.remove();
  }
});
