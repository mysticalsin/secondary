import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { apiSink, CONNECTOR_PRINCIPAL } from "../src/api-client.ts";
import { userKey } from "../src/ids.ts";
import worker, { createApp } from "../src/index.ts";
import {
  type InternalPrincipal,
  signInternalRequest,
  verifyInternalRequest,
} from "../src/internal-auth.ts";
import { SourceSyncWorkflow } from "../src/workflow.ts";
import { freshTenant, sourceDef, storeOf } from "./helpers.ts";

const KEY = "test-connector-hmac-key-0123456789abcdef";
const O = "https://connector.internal";

const apiPrincipal = (over: Partial<InternalPrincipal> = {}): InternalPrincipal => ({
  v: 1,
  iss: "secondary-mcp",
  aud: "secondary-api",
  sub: "u_head_bid",
  email: "head_bid@example.invalid",
  client_id: "secondary-api",
  scope: [],
  tool: "acl.check",
  ...over,
});

async function signed(
  method: string,
  path: string,
  body?: unknown,
  o: { key?: string; principal?: InternalPrincipal; e?: Record<string, unknown> } = {},
) {
  const raw = body === undefined ? undefined : JSON.stringify(body);
  const headers = await signInternalRequest({
    secret: o.key ?? KEY,
    method,
    url: `${O}${path}`,
    body: raw,
    principal: o.principal ?? apiPrincipal(),
  });
  return createApp().fetch(
    new Request(`${O}${path}`, {
      method,
      headers: { ...headers, "Content-Type": "application/json" },
      body: raw,
    }),
    { ...env, ...o.e } as Env,
  );
}

const body = (tenantId: string, over: Record<string, unknown> = {}) => ({
  tenantId,
  provider: "sharepoint_drive",
  driveId: "b!drive1",
  siteId:
    "contoso.sharepoint.com,11111111-1111-1111-1111-111111111111,22222222-2222-2222-2222-222222222222",
  folderPath: "/Docs/Bids",
  scope: {
    kind: "circle",
    scopeId: "c_bid",
    gateNodeId: "c_bid",
    classification: "internal_confidential",
    ownerRef: "owner_bid_circle",
  },
  ...over,
});

describe("auth and kill switch", () => {
  it("health is open and reports the switches, nothing else", async () => {
    const r = await createApp().fetch(new Request(`${O}/health`), env as Env);
    expect(await r.json()).toEqual({
      ok: true,
      enabled: false,
      graphConfigured: false,
      calendarEnabled: false,
    });
  });

  it("every /internal route needs a valid signature from a known caller", async () => {
    const t = freshTenant();
    const unsigned = await createApp().fetch(
      new Request(`${O}/internal/sources?tenantId=${t}`),
      env as Env,
    );
    expect(unsigned.status).toBe(401);
    expect(
      (await signed("GET", `/internal/sources?tenantId=${t}`, undefined, { key: "k".repeat(40) }))
        .status,
    ).toBe(401);
    expect(
      (
        await signed("GET", `/internal/sources?tenantId=${t}`, undefined, {
          principal: apiPrincipal({ client_id: "claude" }),
        })
      ).status,
    ).toBe(401);
    expect((await signed("GET", `/internal/sources?tenantId=${t}`)).status).toBe(200);
    // No key configured: everything is refused.
    expect(
      (
        await signed("GET", `/internal/sources?tenantId=${t}`, undefined, {
          e: { CONNECTOR_HMAC_KEY: undefined },
        })
      ).status,
    ).toBe(401);
  });

  it("L-01: a signed request is accepted once; a replay, an unknown key id and a previous key behave", async () => {
    const t = freshTenant();
    const path = `/internal/sources?tenantId=${t}`;
    const url = `${O}${path}`;
    const headers = await signInternalRequest({
      secret: KEY,
      method: "GET",
      url,
      principal: apiPrincipal(),
    });
    const send = (h: Record<string, string>, e: Record<string, unknown> = {}) =>
      createApp().fetch(new Request(url, { headers: h }), { ...env, ...e } as Env);
    expect((await send(headers)).status).toBe(200);
    expect((await send(headers)).status).toBe(401);
    // A key id the verifier does not hold is refused.
    const k9 = await signInternalRequest({
      secret: KEY,
      kid: "k9",
      method: "GET",
      url,
      principal: apiPrincipal(),
    });
    expect((await send(k9)).status).toBe(401);
    // Rotation: the sender moved to a new key (k2); the verifier keeps the old one as previous (k1... here k0).
    const OLD = "old-connector-hmac-key-0123456789abcdef0";
    const fromOld = await signInternalRequest({
      secret: OLD,
      kid: "k0",
      method: "GET",
      url,
      principal: apiPrincipal(),
    });
    expect((await send(fromOld, { CONNECTOR_HMAC_KEY_PREVIOUS: OLD })).status).toBe(200);
    const fromOld2 = await signInternalRequest({
      secret: OLD,
      kid: "k0",
      method: "GET",
      url,
      principal: apiPrincipal(),
    });
    expect((await send(fromOld2)).status).toBe(401);
  });

  it("the ACL check denies everything while the kill switch is off (default)", async () => {
    const t = freshTenant();
    const r = await signed("POST", "/internal/acl/check", {
      tenantId: t,
      itemIds: ["src:srcbid01:aaaaaaaaaaaaaaaaaaaaaaaa"],
    });
    expect(await r.json()).toEqual({
      results: {
        "src:srcbid01:aaaaaaaaaaaaaaaaaaaaaaaa": {
          allowed: false,
          reason: "source permission could not be confirmed",
        },
      },
    });
  });

  it("sync, cron and the queue do nothing while the kill switch is off", async () => {
    const t = freshTenant();
    await storeOf(t).putSource(sourceDef());
    const sent: unknown[] = [];
    const e = {
      ...env,
      SYNC_QUEUE: {
        sendBatch: async (m: unknown[]) => void sent.push(...m),
        send: async (m: unknown) => void sent.push(m),
      },
    } as unknown as Env;
    await worker.scheduled(
      {} as ScheduledController,
      { ...e, CONNECTOR_TENANTS: JSON.stringify([t]) } as Env,
    );
    expect(sent).toEqual([]);
    const manual = await createApp().fetch(
      new Request(`${O}/internal/sources/srcbid01/sync`, {
        method: "POST",
        headers: await signInternalRequest({
          secret: KEY,
          method: "POST",
          url: `${O}/internal/sources/srcbid01/sync`,
          body: JSON.stringify({ tenantId: t }),
          principal: apiPrincipal(),
        }),
        body: JSON.stringify({ tenantId: t }),
      }),
      e,
    );
    expect(manual.status).toBe(503);
    const created: unknown[] = [];
    let acked = 0;
    await worker.queue(
      {
        messages: [
          {
            body: { tenantId: t, sourceId: "srcbid01", reason: "cron" },
            ack: () => acked++,
            retry: () => {},
          },
        ],
      } as never,
      {
        ...e,
        SOURCE_SYNC: { create: async (x: unknown) => void created.push(x) },
      } as unknown as Env,
    );
    expect(created).toEqual([]);
    expect(acked).toBe(1);
  });

  it("when enabled, cron enqueues one message per enabled source and the queue starts one workflow", async () => {
    const t = freshTenant();
    const store = storeOf(t);
    await store.putSource(sourceDef());
    await store.putSource(sourceDef({ id: "srcoff01", enabled: false }));
    const sent: { body: { sourceId: string } }[] = [];
    const created: { id: string; params: unknown }[] = [];
    const e = {
      ...env,
      CONNECTOR_ENABLED: "true",
      CONNECTOR_TENANTS: JSON.stringify([t, "BAD tenant"]),
      SYNC_QUEUE: { sendBatch: async (m: typeof sent) => void sent.push(...m) },
      SOURCE_SYNC: {
        create: async (x: (typeof created)[number]) => {
          if (created.some((c) => c.id === x.id)) throw new Error("instance.already_exists");
          created.push(x);
        },
      },
    } as unknown as Env;
    await worker.scheduled({} as ScheduledController, e);
    expect(sent.map((m) => m.body.sourceId)).toEqual(["srcbid01"]);

    let acks = 0;
    const msg = { body: sent[0]?.body, ack: () => acks++, retry: () => {} };
    await worker.queue(
      { messages: [msg, msg, { ...msg, body: { tenantId: "BAD", sourceId: "x" } }] } as never,
      e,
    );
    expect(created).toHaveLength(1);
    expect(created[0]?.params).toEqual({ tenantId: t, sourceId: "srcbid01" });
    expect(acks).toBe(3);
  });
});

describe("workflow", () => {
  it("returns a skipped result without sleeping while the connector is off", async () => {
    const steps: string[] = [];
    // The runtime constructs workflows; tests call `run` on an instance with just the env set.
    const wf = Object.assign(Object.create(SourceSyncWorkflow.prototype), {
      env,
    }) as SourceSyncWorkflow;
    const out = await wf.run(
      {
        payload: { tenantId: freshTenant(), sourceId: "srcbid01" },
        timestamp: new Date(),
        instanceId: "i",
      } as never,
      {
        do: async (name: string, _c: unknown, fn: () => Promise<unknown>) => {
          steps.push(name);
          return fn();
        },
        sleep: async () => void steps.push("sleep"),
      } as never,
    );
    expect(out).toEqual({ status: "skipped", reason: "disabled" });
    expect(steps).toEqual(["sync-0"]);
  });
});

describe("registry API", () => {
  it("validates, creates, lists and deletes; the drive and scope are fixed once created", async () => {
    const t = freshTenant();
    for (const bad of [
      body(t, { driveId: "../x" }),
      body(t, { provider: "dropbox" }),
      body(t, { folderPath: "/a/../b" }),
      body(t, {
        scope: {
          kind: "account",
          scopeId: "a_acme",
          gateNodeId: "a_acme",
          classification: "account_confidential",
          ownerRef: "owner_acme_lead",
        },
      }),
      body(t, {
        scope: {
          kind: "circle",
          scopeId: "c_bid",
          gateNodeId: "c_bid",
          classification: "customer_contract_restricted",
          ownerRef: "owner_bid_circle",
        },
      }),
      body(t, {
        scope: {
          kind: "circle",
          scopeId: "C BID",
          gateNodeId: "c_bid",
          classification: "internal_confidential",
          ownerRef: "owner_bid_circle",
        },
      }),
    ])
      expect((await signed("PUT", "/internal/sources/srcbid01", bad)).status).toBe(400);
    expect((await signed("PUT", "/internal/sources/BAD", body(t))).status).toBe(400);

    expect((await signed("PUT", "/internal/sources/srcbid01", body(t))).status).toBe(201);
    expect((await signed("PUT", "/internal/sources/srcbid01", body(t))).status).toBe(200);
    expect(
      (await signed("PUT", "/internal/sources/srcbid01", body(t, { driveId: "b!other" }))).status,
    ).toBe(409);

    const acct = body(t, {
      scope: {
        kind: "account",
        scopeId: "a_acme",
        gateNodeId: "a_acme",
        classification: "account_confidential",
        ownerRef: "owner_acme_lead",
        accountId: "acct_synth_acme_0001",
        subspaceId: "sub_synth_root01",
      },
    });
    expect((await signed("PUT", "/internal/sources/srcacme1", acct)).status).toBe(201);

    const list = (await (await signed("GET", `/internal/sources?tenantId=${t}`)).json()) as {
      sources: { id: string; folderPath: string; files: number }[];
    };
    expect(list.sources.map((s) => s.id)).toEqual(["srcacme1", "srcbid01"]);
    expect(list.sources[1]?.folderPath).toBe("/Docs/Bids");

    const del = await signed("DELETE", `/internal/sources/srcbid01?tenantId=${t}`);
    expect(await del.json()).toMatchObject({ ok: true, purged: 0 });
    const after = (await (await signed("GET", `/internal/sources?tenantId=${t}`)).json()) as {
      sources: unknown[];
    };
    expect(after.sources).toHaveLength(1);
  });

  it("serves contract SourceRecords for a source (metadata only)", async () => {
    const t = freshTenant();
    await signed("PUT", "/internal/sources/srcbid01", body(t));
    const r = await signed("GET", `/internal/sources/srcbid01/records?tenantId=${t}`);
    expect(await r.json()).toEqual({ records: [] });
    expect((await signed("GET", `/internal/sources/srcnone1/records?tenantId=${t}`)).status).toBe(
      404,
    );
  });

  it("calendar is a 501 until enabled, and needs a delegated token even then", async () => {
    const t = freshTenant();
    const q = { tenantId: t, from: "2026-11-10T00:00:00Z", to: "2026-11-11T00:00:00Z" };
    expect((await signed("POST", "/internal/calendar/events", q)).status).toBe(501);
    const on = await signed("POST", "/internal/calendar/events", q, {
      e: { CALENDAR_ENABLED: "true" },
    });
    expect(on.status).toBe(400);
    expect(await on.json()).toEqual({ ok: false, error: "delegated_token_required" });
  });
});

describe("api client", () => {
  it("signs every call as the connector service and batches large upserts", async () => {
    const seen: { path: string; sig: boolean; principalSub: string; n: number }[] = [];
    const e = {
      CONNECTOR_HMAC_KEY: KEY,
      API: {
        fetch: async (url: string, init: RequestInit) => {
          const req = new Request(url, init);
          const v = await verifyInternalRequest(req, KEY);
          seen.push({
            path: new URL(url).pathname,
            sig: v.ok,
            principalSub: v.ok ? v.principal.sub : "",
            n: ((await req.json()) as { items?: unknown[]; ids?: unknown[] }).items?.length ?? 0,
          });
          return Response.json({ ok: true });
        },
      },
    } as unknown as Env;
    const sink = apiSink(e);
    const items = Array.from({ length: 120 }, (_, i) => ({
      id: `src:srcbid01:${String(i).padStart(24, "0")}`,
      title: "t",
      body: null,
      webUrl: null,
      mime: null,
      size: 1,
      eTag: "e",
      syncedAt: 1,
    }));
    await sink.upsert("tenant_x01", sourceDef(), items);
    await sink.remove("tenant_x01", sourceDef(), ["src:srcbid01:000000000000000000000001"]);
    await sink.purge("tenant_x01", sourceDef());
    expect(seen.map((s) => [s.path, s.n])).toEqual([
      ["/internal/connector/upsert", 50],
      ["/internal/connector/upsert", 50],
      ["/internal/connector/upsert", 20],
      ["/internal/connector/delete", 0],
      ["/internal/connector/purge", 0],
    ]);
    expect(seen.every((s) => s.sig && s.principalSub === CONNECTOR_PRINCIPAL.sub)).toBe(true);
  });

  it("throws without a key or on an api error, so the sync does not advance", async () => {
    const down = {
      CONNECTOR_HMAC_KEY: KEY,
      API: { fetch: async () => new Response("", { status: 503 }) },
    } as unknown as Env;
    await expect(apiSink(down).purge("tenant_x01", sourceDef())).rejects.toThrow("api_503");
    await expect(
      apiSink({ API: down.API } as Env).purge("tenant_x01", sourceDef()),
    ).rejects.toThrow("connector_key_missing");
  });
});

describe("M-03: /internal/acl/forget", () => {
  it("drops the signed user's cached decisions and nobody else's", async () => {
    const t = freshTenant();
    const store = storeOf(t);
    const item = "src:srcbid01:aaaaaaaaaaaaaaaaaaaaaaaa";
    const mine = await userKey(KEY, "head_bid@example.invalid");
    const theirs = await userKey(KEY, "someone@example.invalid");
    await store.putAcl(item, mine, { allowed: true, checkedAt: 1 });
    await store.putAcl(item, theirs, { allowed: true, checkedAt: 1 });
    const r = await signed("POST", "/internal/acl/forget", { tenantId: t });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, removed: 1 });
    expect(await store.getAcl(item, mine)).toBeNull();
    expect(await store.getAcl(item, theirs)).not.toBeNull();
    // Signed calls only, and a tenant id is required.
    const unsigned = await createApp().fetch(
      new Request(`${O}/internal/acl/forget`, {
        method: "POST",
        body: JSON.stringify({ tenantId: t }),
      }),
      env as Env,
    );
    expect(unsigned.status).toBe(401);
    expect((await signed("POST", "/internal/acl/forget", {})).status).toBe(400);
  });
});
