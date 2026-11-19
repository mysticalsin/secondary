import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
const STRANGER = { id: "u_reviewer", email: "reviewer@synthetic.example" };
const ADMIN = { id: "u_platform_admin", email: "platform_admin@synthetic.example" };
const CANDIDATE = "cand:c_delivery:abcd1234";

type App = {
  request: (input: string, init: RequestInit | undefined, env: unknown) => Promise<Response>;
};

function hang(): Promise<never> {
  return new Promise(() => {});
}

function workspace(name: string) {
  const slow = name.includes("c_delivery");
  const pending = hang();
  return {
    brainMemberRead: async () => null,
    brainRoleOf: async () => null,
    brainMembers: async () => [],
    wikiPages: () => (slow ? pending : Promise.resolve([])),
    brainConfig: async () => ({ template: null, publication: "review", everyone: null, fields: [] }),
    wikiMeta: async () => null,
    wikiHealth: async () => null,
    get: async (id: string) =>
      id === CANDIDATE
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
      memberships: { scope_type: "circle"; scope_id: string }[];
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

async function openDirectory(): Promise<{ binding: unknown; remove: () => void }> {
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
        ],
      },
      {
        id: STRANGER.id,
        email: STRANGER.email,
        roleIds: ["reviewer"],
        memberships: [{ scope_type: "circle", scope_id: "c_delivery" }],
      },
      {
        id: ADMIN.id,
        email: ADMIN.email,
        roleIds: ["platform_admin"],
        memberships: [],
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

test("the author and an admin can read a candidate; a stranger cannot, and nodes stay closed", async () => {
  const held = await openDirectory();
  const api = await app();
  try {
    const author = await api.request(
      `http://127.0.0.1/v1/ux/candidates/${CANDIDATE}`,
      {},
      env(held.binding, AUTHOR.email),
    );
    assert.equal(author.status, 200);
    assert.deepEqual(await author.json(), {
      id: CANDIDATE,
      title: "Synthetic note",
      body: "Plain note",
      status: "candidate",
      revision: 1,
      targetNodeId: "c_delivery",
    });
    const admin = await api.request(
      `http://127.0.0.1/v1/ux/candidates/${CANDIDATE}`,
      {},
      env(held.binding, ADMIN.email),
    );
    assert.equal(admin.status, 200);
    const stranger = await api.request(
      `http://127.0.0.1/v1/ux/candidates/${CANDIDATE}`,
      {},
      env(held.binding, STRANGER.email),
    );
    assert.equal(stranger.status, 404);
    assert.deepEqual(await stranger.json(), { error: "not_found" });
    const nodes = await api.request(
      `http://127.0.0.1/v1/nodes/${CANDIDATE}`,
      {},
      env(held.binding, AUTHOR.email),
    );
    assert.equal(nodes.status, 404);
    assert.deepEqual(await nodes.json(), { error: "not_found" });
  } finally {
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
    const body = (await res.json()) as { brains: { id: string; name: string; unavailable?: boolean; pages: number }[] };
    const slow = body.brains.find((b) => b.id === "c_delivery");
    const mine = body.brains.find((b) => b.id === "me");
    assert.equal(slow?.unavailable, true);
    assert.equal(slow?.name.length > 0, true);
    assert.equal(slow?.pages, 0);
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
  ]) {
    const res = await api.request(`http://127.0.0.1${path}`, {}, { ENVIRONMENT: "test" });
    assert.equal(res.status, 401, path);
    assert.deepEqual(await res.json(), { error: "unauthorized" });
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
});
