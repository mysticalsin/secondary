/**
 * NDA expiry and the audit viewer reject a calendar day that does not exist.
 * Date.parse rolls 2025-02-29 onto 2025-03-01, and that rolled instant must not be stored.
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

/** 2025-02-28T00:00:00.000Z. The rolled value of 2025-02-29 is one day later and inside one year. */
const NOW = 1_740_700_800_000;

function auditFetch() {
  return async (input: unknown, init?: { method?: string }) => {
    const method = init?.method ?? "GET";
    if (method === "POST" || String(input).includes("/append"))
      return new Response(null, { status: 202 });
    return new Response(JSON.stringify({ receipts: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

async function adminApp(): Promise<Hono<{ Variables: { session: unknown } }>> {
  const specifier = new URL("../../src/worker/admin/routes.ts", import.meta.url).href;
  const mod = (await import(specifier)) as { adminRoutes: (deps: object) => Hono };
  const principal = persona("platform_admin");
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
  return api;
}

function env(seen?: { expiresAt: number | null }) {
  const namespace = {
    jurisdiction() {
      return namespace;
    },
    idFromName() {
      return "id";
    },
    get() {
      return {
        gov: async (method: string, args?: unknown[]) => {
          if (method === "remember") return null;
          if (method === "propose") {
            const call = args?.[0] as { payload?: { expiresAt?: number } } | undefined;
            if (seen) seen.expiresAt = call?.payload?.expiresAt ?? null;
            return { ok: true, change: { id: "chg_nda", status: "pending" }, applied: false };
          }
          return null;
        },
      };
    },
  };
  return { AUDIT: { fetch: auditFetch() }, TENANT_POLICY: namespace };
}

async function postNda(
  expiresAt: string,
  seen?: { expiresAt: number | null },
): Promise<{ status: number; error?: string }> {
  const api = await adminApp();
  const res = await api.request(
    "/nda",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        principalId: "ada",
        accountId: "a_calypso",
        reason: "Named grant for a synthetic review",
        expiresAt,
      }),
    },
    env(seen),
  );
  const body = (await res.json()) as { error?: string };
  return { status: res.status, error: body.error };
}

async function getAudit(query: string): Promise<{ status: number; error?: string }> {
  const api = await adminApp();
  const res = await api.request(`/audit?${query}`, { method: "GET" }, env());
  const text = await res.text();
  const body = text ? (JSON.parse(text) as { error?: string }) : {};
  return { status: res.status, error: body.error };
}

test("NDA expiry 2025-02-29 is rejected", async () => {
  const out = await postNda("2025-02-29");
  assert.equal(out.status, 422, `NDA expiry 2025-02-29 returns ${out.status}`);
  assert.equal(out.error, "invalid_date");
});

test("NDA expiry 2025-03-01 is a real day", async () => {
  const out = await postNda("2025-03-01");
  assert.equal(out.status, 200);
});

test("NDA expiry 2025-02-29T00:00:00Z is rejected", async () => {
  const out = await postNda("2025-02-29T00:00:00Z");
  assert.equal(out.status, 422, `NDA expiry 2025-02-29T00:00:00Z returns ${out.status}`);
  assert.equal(out.error, "invalid_date");
});

test("NDA date-only 2025-03-01 round-trips to that UTC day", async () => {
  const seen = { expiresAt: null as number | null };
  const out = await postNda("2025-03-01", seen);
  assert.equal(out.status, 200);
  const expected = Date.parse("2025-03-01T00:00:00Z");
  assert.equal(seen.expiresAt, expected);
  assert.equal(new Date(expected).toISOString().slice(0, 10), "2025-03-01");
});

test("audit from 2025-02-29 is rejected", async () => {
  const out = await getAudit("from=2025-02-29");
  assert.equal(out.status, 400, `audit from 2025-02-29 returns ${out.status}`);
  assert.equal(out.error, "invalid_date");
});

test("audit from 2025-02-29T00:00:00Z is rejected", async () => {
  const out = await getAudit("from=2025-02-29T00:00:00Z");
  assert.equal(out.status, 400, `audit from 2025-02-29T00:00:00Z returns ${out.status}`);
  assert.equal(out.error, "invalid_date");
});

test("audit from 2026-02-30 is rejected", async () => {
  const out = await getAudit("from=2026-02-30");
  assert.equal(out.status, 400);
  assert.equal(out.error, "invalid_date");
});

test("audit to 2026-04-31 is rejected", async () => {
  const out = await getAudit("to=2026-04-31");
  assert.equal(out.status, 400);
  assert.equal(out.error, "invalid_date");
});

test("audit from 2024-02-29 is a real leap day", async () => {
  const out = await getAudit("from=2024-02-29");
  assert.equal(out.status, 200);
});
