import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const { sqliteStorage } = await import("../runtime/sqlite-storage.ts");
const { openSqlite } = await import("../runtime/sqlite-storage.ts");

const SECRET = "synthetic-connector-hmac-secret-32";
const ITEM = "src:sharep:0123456789abcdef01234567";

test("connector upsert persists through the real workspace, and source access calls the binding", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "residual-persist-"));
  const tenantDb = openSqlite(path.join(dir, "tenant.sqlite"));
  let tenantReady: Promise<void> = Promise.resolve();
  const tenantCtx = {
    storage: {
      sql: sqliteStorage(tenantDb),
      transactionSync<T>(fn: () => T): T {
        return fn();
      },
    },
    blockConcurrencyWhile(fn: () => Promise<void>) {
      tenantReady = fn();
      return tenantReady;
    },
  };
  const policyUrl = new URL("../../src/worker/tenant-policy.ts", import.meta.url).href;
  const Policy = (await import(policyUrl)).TenantPolicy;
  const directory = new Policy(tenantCtx, {});
  await tenantReady;

  const wsDb = new DatabaseSync(":memory:");
  let wsReady: Promise<void> = Promise.resolve();
  const wsCtx = {
    storage: {
      sql: sqliteStorage(wsDb),
      transactionSync<T>(fn: () => T): T {
        return fn();
      },
      setAlarm() {},
    },
    blockConcurrencyWhile(fn: () => Promise<void>) {
      wsReady = fn();
      return wsReady;
    },
  };
  const workspaceUrl = new URL("../../src/worker/workspace.ts", import.meta.url).href;
  const Workspace = (await import(workspaceUrl)).Workspace;
  const workspace = new Workspace(wsCtx, { WIKI_ALARMS: "off" });
  await wsReady;

  const binding = {
    jurisdiction() {
      return binding;
    },
    idFromName: (name: string) => name,
    get: (id: string) => (String(id).startsWith("synthetic:") ? workspace : directory),
  };
  const appUrl = new URL("../../src/worker/index.ts", import.meta.url).href;
  const { createApp } = (await import(appUrl)) as {
    createApp: () => {
      request: (input: string, init: RequestInit | undefined, env: unknown) => Promise<Response>;
    };
  };
  const authUrl = new URL("../../src/worker/internal-auth.ts", import.meta.url).href;
  const { signInternalRequest } = await import(authUrl);
  const api = createApp();
  const url = "http://127.0.0.1/internal/connector/upsert";
  const body = JSON.stringify({
    tenantId: "synthetic",
    sourceId: "sharep",
    scopeId: "c_delivery",
    gateNodeId: "c_delivery",
    plane: "TEAM_RESTRICTED",
    items: [
      {
        id: ITEM,
        title: "Synthetic file",
        body: "note",
        webUrl: "https://synthetic.example/file",
        mime: "text/plain",
        size: 4,
        eTag: "etag-1",
        syncedAt: 1_700_000_000_000,
      },
    ],
  });
  const headers = await signInternalRequest({
    secret: SECRET,
    method: "POST",
    url,
    body,
    principal: {
      v: 1,
      iss: "secondary-mcp",
      aud: "secondary-api",
      sub: "secondary-connector",
      email: "connector@synthetic.example",
      client_id: "secondary-connector",
      scope: [],
      tool: "source.upsert",
    },
  });
  const env = {
    ENVIRONMENT: "test",
    DEFAULT_TENANT_ID: "synthetic",
    CONNECTOR_HMAC_KEY: SECRET,
    TENANT_POLICY: binding,
    WORKSPACE: binding,
  };
  try {
    const res = await api.request(url, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body }, env);
    assert.equal(res.status, 200);
    const json = (await res.json()) as { ok?: boolean; changed?: number };
    assert.equal(json.ok, true);
    assert.equal(json.changed, 1);
    const stored = workspace.sourceGet(ITEM);
    assert.equal(stored?.title, "Synthetic file");
    assert.equal(stored?.body, "note");

    let calls = 0;
    const connectorUrl = new URL("../../src/worker/connector.ts", import.meta.url).href;
    const { checkSourceAccess } = await import(connectorUrl);
    const allowed = await checkSourceAccess(
      {
        CONNECTOR_HMAC_KEY: SECRET,
        CONNECTOR: {
          fetch: async () => {
            calls += 1;
            return Response.json({ results: { [ITEM]: { allowed: true } } });
          },
        },
      } as never,
      "synthetic",
      { id: "u_consultant", email: "consultant@synthetic.example" },
      [ITEM],
    );
    assert.equal(calls, 1);
    assert.equal(allowed.has(ITEM), true);

    const user = { id: "u_consultant", email: "consultant@synthetic.example" };
    const closed = async (connector: unknown) =>
      checkSourceAccess(
        { CONNECTOR_HMAC_KEY: SECRET, CONNECTOR: connector } as never,
        "synthetic",
        user,
        [ITEM],
      );
    assert.equal((await closed(undefined)).size, 0);
    assert.equal(
      (
        await checkSourceAccess(
          { CONNECTOR: { fetch: async () => Response.json({}) } } as never,
          "synthetic",
          user,
          [ITEM],
        )
      ).size,
      0,
    );
    assert.equal((await closed({ fetch: async () => new Response("no", { status: 503 }) })).size, 0);
    assert.equal((await closed({ fetch: async () => new Response("not-json", { status: 200 }) })).size, 0);
    assert.equal(
      (await closed({ fetch: async () => Response.json({ results: { [ITEM]: { allowed: "true" } } }) })).size,
      0,
    );
    const { forgetSourceAccess } = await import(connectorUrl);
    assert.equal(await forgetSourceAccess({ CONNECTOR_HMAC_KEY: SECRET } as never, "synthetic", user), false);
    assert.equal(
      await forgetSourceAccess(
        { CONNECTOR_HMAC_KEY: SECRET, CONNECTOR: { fetch: async () => new Response("no", { status: 500 }) } } as never,
        "synthetic",
        user,
      ),
      false,
    );
    assert.equal(
      await forgetSourceAccess(
        { CONNECTOR_HMAC_KEY: SECRET, CONNECTOR: { fetch: async () => new Response(null, { status: 204 }) } } as never,
        "synthetic",
        user,
      ),
      true,
    );

    const badBody = JSON.stringify({ tenantId: "NO" });
    const badHeaders = await signInternalRequest({
      secret: SECRET,
      method: "POST",
      url,
      body: badBody,
      principal: {
        v: 1,
        iss: "secondary-mcp",
        aud: "secondary-api",
        sub: "secondary-connector",
        email: "connector@synthetic.example",
        client_id: "secondary-connector",
        scope: [],
        tool: "source.upsert",
      },
    });
    const bad = await api.request(
      url,
      { method: "POST", headers: { ...badHeaders, "content-type": "application/json" }, body: badBody },
      env,
    );
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { error: "invalid_body" });
    assert.equal(workspace.sourceGet(ITEM)?.title, "Synthetic file");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
