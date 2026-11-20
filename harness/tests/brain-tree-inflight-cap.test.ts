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
const PAGES = [
  { id: "plain", title: "Plain page", type: "note", markdown: "hello" },
  { id: "secret", title: "Secret page", type: "note", markdown: "see {src:secret}" },
];

type Page = (typeof PAGES)[number];

const reads: string[] = [];
const release = new Map<string, (pages: Page[]) => void>();
let rejectDelivery = false;
let paceMs: number | null = null;

function deliveryReads(): number {
  return reads.filter((name) => name.includes("c_delivery")).length;
}

function workspace(name: string) {
  return {
    brainMemberRead: async () => null,
    brainRoleOf: async () => null,
    brainMembers: async () => [],
    wikiPages: () => {
      reads.push(name);
      if (!name.includes("c_delivery")) return Promise.resolve([]);
      if (rejectDelivery) {
        rejectDelivery = false;
        return Promise.reject(new Error("synthetic read failed"));
      }
      if (paceMs !== null) {
        const pages = PAGES;
        const ms = paceMs;
        return new Promise<Page[]>((resolve) => {
          setTimeout(() => resolve(pages), ms);
        });
      }
      return new Promise<Page[]>((resolve) => {
        release.set(name, resolve);
      });
    },
    wikiSourceRefs: async (ids: string[]) =>
      ids
        .filter((id) => id === "secret")
        .map((id) => ({ id, kind: "item" as const, title: "Secret", gateNodeId: "c_private" })),
    brainConfig: async () => ({ template: null, publication: "review", everyone: null, fields: [] }),
    wikiMeta: async () => null,
    wikiHealth: async () => null,
    wikiTouch: async () => {},
    wikiSchema: async () => ({ types: { note: { label: "Note" } } }),
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
