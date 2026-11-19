import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { persona } from "../../packages/policy/src/personas.ts";
import { ROLES } from "../../packages/policy/src/roles.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const NOW = 1_700_000_000_000;
const ITEM = "pi:abcd1234";
const ASK = "ask:0123456789abcdef";

function capture(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (message?: unknown) => {
    lines.push(String(message));
  };
  return { lines, restore: () => (console.warn = original) };
}

function namespace(who: ReturnType<typeof persona>) {
  const ns = {
    jurisdiction() {
      return ns;
    },
    idFromName() {
      return "id";
    },
    get() {
      return {
        session: async () => ({
          limited: false,
          retryAfter: 0,
          principal: {
            id: who.id,
            email: who.email,
            roleIds: who.roleIds,
            memberships: who.memberships,
          },
          ndaGrants: [],
          openBrains: [],
          elevatedUntil: null,
          epoch: 1,
          config: { tenantId: who.tenantId, seed: 1, personalOwners: [] },
          switches: { mcp: true, connector: true, ai: true, contribute: true },
          active: true,
          rolesVersion: 902,
        }),
        gov: async (method: string) =>
          method === "listRoles" ? { roles: Object.values(ROLES), version: 902 } : { roles: [], version: 0 },
      };
    },
  };
  return ns;
}

function workspace() {
  const ns = {
    jurisdiction() {
      return ns;
    },
    idFromName() {
      return "ws";
    },
    get() {
      return {
        get: async (id: string) => {
          if (id === ITEM)
            return { id, kind: "personalitem", label: "Note", body: "Plain note", revision: 1 };
          if (id === ASK) return { id, kind: "u2_ask", label: "Ask", body: "{}", revision: 1 };
          return null;
        },
      };
    },
  };
  return ns;
}

async function app() {
  const specifier = new URL("../../src/worker/routes.ts", import.meta.url).href;
  const { v1Routes } = (await import(specifier)) as {
    v1Routes: (deps: { now: () => number }) => { request: Function };
  };
  const who = persona("consultant");
  return {
    who,
    v1: v1Routes({ now: () => NOW }),
    env: {
      ENVIRONMENT: "dev",
      WIKI_SEED: "off",
      DO_JURISDICTION: "off",
      DEV_AUTH_BYPASS_EMAIL: who.email,
      DEFAULT_TENANT_ID: who.tenantId,
      TENANT_POLICY: namespace(who),
      WORKSPACE: workspace(),
      AUDIT: { fetch: async () => new Response(null, { status: 500 }) },
    },
  };
}

function warnObject(lines: string[], action: string): void {
  const line = lines.find((entry) => entry.includes('"at":"audit_unavailable"'));
  assert.equal(typeof line, "string");
  assert.deepEqual(JSON.parse(line ?? "{}"), {
    at: "audit_unavailable",
    action,
    decision: "deny",
  });
}

test("contribute deny: a failed receipt is 403 and the exact warning", async () => {
  const seen = capture();
  try {
    const { who, v1, env } = await app();
    const res = await v1.request(
      `http://127.0.0.1/personal/items/${ITEM}/contribute`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targetScopeId: "core",
          user_validated: { by: who.id, at: new Date(NOW).toISOString(), revision: 1 },
        }),
      },
      env,
    );
    assert.equal(res.status, 403);
    warnObject(seen.lines, "contribute");
  } finally {
    seen.restore();
  }
});

test("question deny: a failed receipt is 403 and the exact warning", async () => {
  const seen = capture();
  try {
    const { v1, env } = await app();
    const res = await v1.request(
      `http://127.0.0.1/questions/${ASK}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "close" }),
      },
      env,
    );
    assert.equal(res.status, 403);
    warnObject(seen.lines, "question.ingest");
  } finally {
    seen.restore();
  }
});
