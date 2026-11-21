/**
 * POST /v1/admin/notifications/read marks rows only when ids is an array of integers.
 * A missing or non-integer ids must not mark the inbox and must not return 200.
 */

import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { Hono } from "hono";
import { buildOrg } from "../../packages/policy/src/org.ts";
import { persona } from "../../packages/policy/src/personas.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const NOW = 1_700_000_000_000;

type Call = { method: string; args: unknown[] };

async function post(body: unknown): Promise<{
  status: number;
  calls: Call[];
  json: { error?: string; ok?: boolean };
}> {
  const calls: Call[] = [];
  const specifier = new URL("../../src/worker/admin/routes.ts", import.meta.url).href;
  const mod = (await import(specifier)) as { adminRoutes: (deps: object) => Hono };
  const principal = persona("consultant");
  const namespace = {
    jurisdiction() {
      return namespace;
    },
    idFromName() {
      return "id";
    },
    get() {
      return {
        gov: async (method: string, args: unknown[]) => {
          calls.push({ method, args });
          if (method === "markRead") return 4;
          return { unread: 4, items: [] };
        },
      };
    },
  };
  const api = new Hono<{ Variables: { session: unknown } }>();
  api.use("*", async (c, next) => {
    c.set("session", {
      principal,
      ctx: { now: NOW },
      persona: null,
      tenantId: principal.tenantId,
      config: null,
      epoch: 1,
      internal: null,
      switches: { mcp: true, connector: true, ai: true, contribute: true },
      org: buildOrg(),
    });
    await next();
  });
  api.route("/", mod.adminRoutes({}));
  const res = await api.request(
    "/notifications/read",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    { TENANT_POLICY: namespace, AUDIT: undefined },
  );
  return {
    status: res.status,
    calls,
    json: (await res.json()) as { error?: string; ok?: boolean },
  };
}

test("POST /v1/admin/notifications/read with {} is 400", async () => {
  const out = await post({});
  assert.equal(out.status, 400, `POST /notifications/read with {} returns ${out.status}`);
  assert.equal(out.json.error, "invalid_ids");
  assert.equal(
    out.calls.some((call) => call.method === "markRead"),
    false,
  );
});

test("POST /v1/admin/notifications/read with string ids is 400", async () => {
  const out = await post({ ids: ["1"] });
  assert.equal(out.status, 400);
  assert.equal(out.json.error, "invalid_ids");
  assert.equal(
    out.calls.some((call) => call.method === "markRead"),
    false,
  );
});

test("POST /v1/admin/notifications/read with all true is 400", async () => {
  const out = await post({ all: true });
  assert.equal(out.status, 400);
  assert.equal(out.json.error, "invalid_ids");
  assert.equal(
    out.calls.some((call) => call.method === "markRead"),
    false,
  );
});

test("POST /v1/admin/notifications/read with an integer id marks that id", async () => {
  const out = await post({ ids: [7] });
  assert.equal(out.status, 200);
  assert.equal(out.json.ok, true);
  const mark = out.calls.find((call) => call.method === "markRead");
  assert.deepEqual(mark?.args[1], [7]);
});

test("POST /v1/admin/notifications/read with an empty ids array marks nothing", async () => {
  const out = await post({ ids: [] });
  assert.equal(out.status, 200);
  const mark = out.calls.find((call) => call.method === "markRead");
  assert.deepEqual(mark?.args[1], []);
});
