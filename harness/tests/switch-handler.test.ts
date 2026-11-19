import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { admittedView } from "../../packages/policy/src/engine.ts";
import { buildOrg } from "../../packages/policy/src/org.ts";
import { persona } from "../../packages/policy/src/personas.ts";
import {
  blockingSwitch,
  handlerSwitch,
  httpSwitch,
  SWITCH_TABLE,
  type HandlerKey,
  type SwitchName,
} from "../../src/worker/switches.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const NOW = 1_700_000_000_000;

function switches(contribute: boolean) {
  return { mcp: true, connector: true, ai: true, contribute };
}

test("submitCandidate with contribute off is 503 and writes nothing", async () => {
  const routes = new URL("../../src/worker/routes.ts", import.meta.url).href;
  const { submitCandidate } = (await import(routes)) as {
    submitCandidate: (
      c: { get: (key: string) => unknown; env: unknown; json: (body: unknown, status: number) => Response },
      view: ReturnType<typeof admittedView>,
      input: {
        targetNodeId: string;
        title: string;
        body: string | null;
        userValidated: { by: string; at: string; revision: number };
        acknowledged: string[];
        releaseTarget: "scope";
      },
    ) => Promise<Response>;
  };
  const who = persona("consultant");
  const view = admittedView(who, buildOrg(), { now: NOW });
  const audit: string[] = [];
  const created: unknown[] = [];
  const workspace = {
    jurisdiction() {
      return workspace;
    },
    idFromName() {
      return "ws";
    },
    get() {
      return {
        create: async (row: unknown) => {
          created.push(row);
          return row;
        },
      };
    },
  };
  const res = await submitCandidate(
    {
      get: (key) =>
        key === "session"
          ? {
              principal: who,
              tenantId: who.tenantId,
              switches: switches(false),
              internal: null,
              ctx: { now: NOW },
              org: buildOrg(),
            }
          : undefined,
      env: {
        ENVIRONMENT: "dev",
        DO_JURISDICTION: "off",
        DEV_AUTH_BYPASS_EMAIL: who.email,
        AUDIT: {
          fetch: async (url: string) => {
            audit.push(url);
            return new Response(null, { status: 202 });
          },
        },
        WORKSPACE: workspace,
      },
      json: (body, status) => Response.json(body, { status }),
    },
    view,
    {
      targetNodeId: "c_delivery",
      title: "Note",
      body: "Plain note",
      userValidated: { by: who.id, at: new Date(NOW).toISOString(), revision: 1 },
      acknowledged: [],
      releaseTarget: "scope",
    },
  );
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: "switched_off", switch: "contribute" });
  assert.deepEqual(audit, []);
  assert.deepEqual(created, []);
});

test("routine ingest with contribute off returns the exact reason", async () => {
  const mod = new URL("../../src/worker/uxv2/routines.ts", import.meta.url).href;
  const { writeIngest } = (await import(mod)) as {
    writeIngest: (
      c: { get: (key: string) => unknown; env: unknown },
      routineId: string,
      targetParam: string,
      title: string,
      body: string,
    ) => Promise<{ ok: true; id: string } | { ok: false; reason: string }>;
  };
  const who = persona("consultant");
  const audit: string[] = [];
  const res = await writeIngest(
    {
      get: (key) =>
        key === "session"
          ? {
              principal: who,
              tenantId: who.tenantId,
              switches: switches(false),
              internal: null,
              ctx: { now: NOW },
              org: buildOrg(),
            }
          : undefined,
      env: {
        ENVIRONMENT: "dev",
        DO_JURISDICTION: "off",
        DEV_AUTH_BYPASS_EMAIL: who.email,
        AUDIT: {
          fetch: async (url: string) => {
            audit.push(url);
            return new Response(null, { status: 202 });
          },
        },
      },
    },
    "routine-1",
    "c_delivery",
    "Note",
    "Plain note",
  );
  assert.deepEqual(res, { ok: false, reason: "Contributions are switched off" });
  assert.deepEqual(audit, []);
});

test("every handler key resolves to one switch row", () => {
  const keys = {
    submitCandidate: true,
    routineRun: true,
    routineIngest: true,
    briefSave: true,
    aiCall: true,
    sourceSearch: true,
    wikiSource: true,
    sharepoint: true,
  } satisfies Record<HandlerKey, true>;
  for (const key of Object.keys(keys) as HandlerKey[]) {
    const name = handlerSwitch(key);
    assert.equal(
      SWITCH_TABLE.some((row) => row.name === name && row.handlers?.includes(key)),
      true,
      key,
    );
  }
});

test("switch table HTTP rows are disjoint", () => {
  const http = SWITCH_TABLE.filter((row) => row.http);
  assert.equal(http.length > 0, true);
  for (const row of http) {
    assert.equal((row.probes?.length ?? 0) > 0, true, row.name);
    for (const probe of row.probes ?? []) {
      const hits = http.filter((other) => other.http?.(probe.method, probe.path));
      assert.deepEqual(
        hits.map((hit) => hit.name),
        [row.name],
        `${probe.method} ${probe.path}`,
      );
    }
  }
});

test("a later off row still refuses", () => {
  const rows: { name: SwitchName; http: () => boolean }[] = [
    { name: "contribute", http: () => true },
    { name: "ai", http: () => true },
  ];
  const on = { mcp: true, connector: true, ai: false, contribute: true };
  assert.equal(blockingSwitch(rows, "POST", "/x", on), "ai");
  assert.equal(
    blockingSwitch(rows, "POST", "/x", { ...on, ai: true, contribute: false }),
    "contribute",
  );
});

test("letter case and a trailing slash are the same switch row", () => {
  const off = { mcp: true, connector: false, ai: true, contribute: false };
  assert.equal(httpSwitch("GET", "/v1/sources/s1", off), "connector");
  assert.equal(httpSwitch("GET", "/v1/Sources/s1", off), "connector");
  assert.equal(httpSwitch("GET", "/v1/sources/s1/", off), "connector");
  assert.equal(httpSwitch("POST", "/v1/personal/items/pi:abcd1234/contribute", off), "contribute");
  assert.equal(httpSwitch("POST", "/v1/personal/items/pi:abcd1234/contribute/", off), "contribute");
});
