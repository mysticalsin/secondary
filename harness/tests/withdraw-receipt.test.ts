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

test("withdraw: a non-proposer gets 403 and only a rejected receipt", async () => {
  const decisions: string[] = [];
  const specifier = new URL("../../src/worker/admin/routes.ts", import.meta.url).href;
  const mod = (await import(specifier)) as { adminRoutes: (deps: object) => Hono };
  const app = new Hono<{ Variables: { session: unknown } }>();
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
        gov: async (method: string) => {
          if (method === "change") {
            return {
              id: "chg-1",
              kind: "role_upsert",
              status: "pending",
              proposedBy: "u_other",
              scopeKey: "role:x",
              payload: {},
            };
          }
          return {
            ok: false,
            status: 403,
            code: "not_proposer",
            message: "Only the proposer can withdraw a change",
          };
        },
      };
    },
  };
  app.use("*", async (c, next) => {
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
  app.route("/", mod.adminRoutes({}));
  const res = await app.request(
    "/changes/chg-1/withdraw",
    { method: "POST" },
    {
      AUDIT: {
        fetch: async (_input: unknown, init?: { body?: string }) => {
          const body = JSON.parse(init?.body ?? "{}") as { decision?: string };
          decisions.push(body.decision ?? "");
          return new Response(null, { status: 202 });
        },
      },
      TENANT_POLICY: namespace,
    },
  );
  assert.equal(res.status, 403);
  const body = (await res.json()) as { error?: string };
  assert.equal(body.error, "not_proposer");
  assert.deepEqual(decisions, ["rejected"]);
});
