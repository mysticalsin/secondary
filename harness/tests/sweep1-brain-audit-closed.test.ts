/**
 * SB1-08 brain half. A pending brain mutation that ignores a refused audit
 * append returns 202. The receipt was not written, so the status is not a success.
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
const BID = { id: "u_head_bid", email: "head_bid@synthetic.example" };
const LEAD = { id: "u_acme_lead", email: "acme@synthetic.example" };
const OTHER = { id: "u_other", email: "other@synthetic.example" };

type App = {
  request: (
    input: string,
    init: RequestInit | undefined,
    env: unknown,
    executionCtx?: { waitUntil(promise: Promise<unknown>): void },
  ) => Promise<Response>;
};

function workspace(name: string) {
  return {
    brainMemberRead: async () => null,
    brainRoleOf: async () => null,
    brainMembers: async () =>
      name.includes("a_acme")
        ? [{ principalId: OTHER.id, role: "reader", state: "active", addedBy: LEAD.id, at: 1 }]
        : [],
    wikiPages: async () => [],
    brainConfig: async () => ({
      template: null,
      publication: "review",
      everyone: null,
      fields: name.includes("c_bid")
        ? [
            {
              key: "note",
              label: "Note",
              type: "text",
              sensitivity: "personal",
              retentionDays: null,
              appliesTo: [],
            },
          ]
        : [],
    }),
    wikiMeta: async () => null,
    wikiHealth: async () => null,
    wikiTouch: async () => {},
    wikiSchema: async () => ({ types: { topic: { label: "Topic" } } }),
    brainConfigSet: async () => ({ template: null, publication: "review", everyone: "reader", fields: [] }),
  };
}

async function openDirectory(): Promise<{ binding: unknown; remove: () => void }> {
  const dir = mkdtempSync(path.join(tmpdir(), "brain-audit-"));
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
  const specifier = new URL("../../src/worker/tenant-policy.ts", import.meta.url).href;
  const mod = (await import(specifier)) as {
    TenantPolicy: new (ctx: unknown, env: unknown) => {
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
      gov: (method: string, args: unknown[]) => unknown;
    };
  };
  const directory = new mod.TenantPolicy(ctx, {});
  await ready;
  directory.seed(
    { tenantId: TENANT, seed: 20261104, personalOwners: [BID.id] },
    [
      {
        id: BID.id,
        email: BID.email,
        roleIds: ["head_bid"],
        memberships: [{ scope_type: "circle", scope_id: "c_bid" }],
      },
      {
        id: LEAD.id,
        email: LEAD.email,
        roleIds: ["acme_lead"],
        memberships: [{ scope_type: "account", scope_id: "a_acme" }],
      },
      {
        id: OTHER.id,
        email: OTHER.email,
        roleIds: ["consultant"],
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
  const binding = {
    jurisdiction() {
      return this;
    },
    idFromName: (name: string) => name,
    get: (id: string) =>
      String(id).includes(":") && !String(id).startsWith(TENANT) ? workspace(String(id)) : directory,
  };
  return { binding, remove: () => rmSync(dir, { recursive: true, force: true }) };
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
    AUDIT: {
      fetch: async (url: string) => {
        if (String(url).includes("/append")) return new Response("no", { status: 500 });
        return new Response(null, { status: 500 });
      },
    },
  };
}

async function app(): Promise<App> {
  const specifier = new URL("../../src/worker/index.ts", import.meta.url).href;
  const loaded = (await import(specifier)) as { createApp: () => App };
  return loaded.createApp();
}

async function put(
  api: App,
  binding: unknown,
  email: string,
  url: string,
  body: unknown,
): Promise<Response> {
  return api.request(
    url,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    env(binding, email),
    { waitUntil() {} },
  );
}

test("brain audit: opening a brain returns 202 when /append is 500", async () => {
  const held = await openDirectory();
  try {
    const api = await app();
    const res = await put(api, held.binding, BID.email, "http://127.0.0.1/v1/brains/c_bid/access", {
      everyone: "reader",
    });
    const text = await res.text();
    assert.equal(res.status, 503, text);
    assert.equal(text.includes('"status":"pending"') && text.includes('"ok":true'), false);
  } finally {
    held.remove();
  }
});

test("brain audit: widening a field returns 202 when /append is 500", async () => {
  const held = await openDirectory();
  try {
    const api = await app();
    const res = await put(api, held.binding, BID.email, "http://127.0.0.1/v1/brains/c_bid/fields", {
      fields: [
        {
          key: "note",
          label: "Note",
          type: "text",
          sensitivity: "none",
          retentionDays: null,
          appliesTo: [],
        },
      ],
    });
    const text = await res.text();
    assert.equal(res.status, 503, text);
    assert.equal(text.includes('"status":"pending"') && text.includes('"ok":true'), false);
  } finally {
    held.remove();
  }
});

test("brain audit: a restricted role change returns 202 when /append is 500", async () => {
  const held = await openDirectory();
  try {
    const api = await app();
    const res = await put(
      api,
      held.binding,
      LEAD.email,
      `http://127.0.0.1/v1/brains/a_acme/access/members/${OTHER.id}`,
      { role: "steward" },
    );
    const text = await res.text();
    assert.equal(res.status, 503, text);
    assert.equal(text.includes('"status":"pending"') && text.includes('"ok":true'), false);
  } finally {
    held.remove();
  }
});
