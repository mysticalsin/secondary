// workers/connector: Microsoft Graph (SharePoint/OneDrive) connector.
//
// No public surface. Reached only by service binding from workers/api. Every route except /health
// needs a request signed with CONNECTOR_HMAC_KEY (the internal-auth helper, 60 s window).
//   POST /internal/acl/check            read-time permission check (api -> connector), fail closed
//   GET|PUT|DELETE /internal/sources    source registry per tenant
//   POST /internal/sources/:id/sync     enqueue a sync now
//   GET  /internal/sources/:id/records  contract SourceRecords (metadata only)
//   POST /internal/calendar/events      delegated-only, disabled until Entra delegated tokens exist
// Cron (every 15 minutes) enqueues one message per enabled source; the queue starts a Workflow.

import { Hono } from "hono";
import { keyringFromEnv } from "../../../packages/contracts/src/signed-call.ts";
import { checkAccess } from "./acl.ts";
import { meetingWindow } from "./calendar.ts";
import { graphFromEnv } from "./graph.ts";
import { SOURCE_ID, sha256Hex, TENANT_ID, userKey } from "./ids.ts";
import { verifyInternalRequest } from "./internal-auth.ts";
import { toSourceRecord } from "./records.ts";
import { parseSource } from "./registry.ts";
import { aclDeps, isEnabled, log, syncDeps, tenantsOf } from "./runtime.ts";
import { stateStub } from "./state.ts";
import { purgeSource } from "./sync.ts";
import type { SyncParams } from "./workflow.ts";

/** The Durable Object that holds the replay cache for signed calls from the API (not a real tenant). */
const REPLAY_TENANT = "_replay";

export { ConnectorState } from "./state.ts";
export { SourceSyncWorkflow } from "./workflow.ts";

/** The callers allowed to sign requests: the api (user reads, admin proxy) and an ops script. */
const CALLERS = new Set(["secondary-api", "secondary-ops"]);

type AppEnv = { Bindings: Env; Variables: { principal: { sub: string; email: string } } };

export function createApp() {
  const app = new Hono<AppEnv>();

  app.get("/health", (c) =>
    c.json({
      ok: true,
      enabled: isEnabled(c.env),
      graphConfigured: graphFromEnv(c.env) !== null,
      calendarEnabled: c.env.CALENDAR_ENABLED === "true",
    }),
  );

  app.use("/internal/*", async (c, next) => {
    const at = Date.now();
    const r = await verifyInternalRequest(
      c.req.raw,
      keyringFromEnv(
        c.env.CONNECTOR_HMAC_KEY,
        c.env.CONNECTOR_HMAC_KID,
        c.env.CONNECTOR_HMAC_KEY_PREVIOUS,
        c.env.CONNECTOR_HMAC_KID_PREVIOUS,
      ),
      {
        now: Math.floor(at / 1000),
        channel: "connector-out",
        replay: {
          first: (key, ttlMs) => stateStub(c.env, REPLAY_TENANT).nonceFirst(key, at, ttlMs),
        },
      },
    );
    if (!r.ok || !CALLERS.has(r.principal.client_id)) return c.json({ error: "unauthorized" }, 401);
    c.set("principal", { sub: r.principal.sub, email: r.principal.email });
    await next();
  });

  const tenantOf = (v: unknown): string | null =>
    typeof v === "string" && TENANT_ID.test(v) ? v : null;
  const bodyOf = async (req: Request): Promise<Record<string, unknown> | null> => {
    try {
      const v = await req.json();
      return v && typeof v === "object" && !Array.isArray(v)
        ? (v as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };

  app.post("/internal/acl/check", async (c) => {
    const body = await bodyOf(c.req.raw);
    const tenantId = tenantOf(body?.tenantId);
    const ids = body?.itemIds;
    if (!tenantId || !Array.isArray(ids) || ids.some((i) => typeof i !== "string"))
      return c.json({ error: "invalid_body" }, 400);
    const results = await checkAccess(
      aclDeps(c.env, tenantId),
      { email: c.get("principal").email },
      ids as string[],
    );
    return c.json({ results });
  });

  // Right to erasure: the api asks the connector to forget one person's cached read decisions. The
  // person is the signed principal, exactly as in /internal/acl/check.
  app.post("/internal/acl/forget", async (c) => {
    const body = await bodyOf(c.req.raw);
    const tenantId = tenantOf(body?.tenantId);
    const secret = c.env.CONNECTOR_HMAC_KEY;
    if (!tenantId || !secret) return c.json({ error: "invalid_body" }, 400);
    const removed = await stateStub(c.env, tenantId).deleteAclForUser(
      await userKey(secret, c.get("principal").email),
    );
    return c.json({ ok: true, removed });
  });

  app.get("/internal/sources", async (c) => {
    const tenantId = tenantOf(c.req.query("tenantId"));
    if (!tenantId) return c.json({ error: "invalid_tenant" }, 400);
    const store = stateStub(c.env, tenantId);
    const sources = await store.listSources();
    return c.json({
      sources: await Promise.all(
        sources.map(async (s) => ({
          ...s,
          cursor: await store.getCursor(s.id).then((k) => ({
            hasDelta: k.deltaLink !== null,
            full: k.full,
            lastSyncAt: k.lastSyncAt,
            lastError: k.lastError,
          })),
          files: await store.countRecords(s.id),
        })),
      ),
    });
  });

  app.put("/internal/sources/:id", async (c) => {
    const body = await bodyOf(c.req.raw);
    const tenantId = tenantOf(body?.tenantId);
    if (!tenantId) return c.json({ error: "invalid_tenant" }, 400);
    const parsed = parseSource(c.req.param("id"), body, Date.now());
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const store = stateStub(c.env, tenantId);
    const prev = await store.getSource(parsed.def.id);
    // The drive and the target scope are fixed once created: changing them would orphan synced items.
    if (
      prev &&
      (prev.driveId !== parsed.def.driveId || prev.scope.scopeId !== parsed.def.scope.scopeId)
    )
      return c.json({ error: "immutable_mapping" }, 409);
    await store.putSource({ ...parsed.def, createdAt: prev?.createdAt ?? parsed.def.createdAt });
    // Disabling a source removes what it put into the Workspace.
    if (prev?.enabled && !parsed.def.enabled)
      await purgeSource(syncDeps(c.env, tenantId, noGraph), tenantId, parsed.def.id);
    return c.json({ ok: true, id: parsed.def.id }, prev ? 200 : 201);
  });

  app.delete("/internal/sources/:id", async (c) => {
    const tenantId = tenantOf(c.req.query("tenantId"));
    const id = c.req.param("id");
    if (!tenantId || !SOURCE_ID.test(id)) return c.json({ error: "invalid_request" }, 400);
    const r = await purgeSource(syncDeps(c.env, tenantId, noGraph), tenantId, id);
    await stateStub(c.env, tenantId).deleteSource(id);
    log("source.deleted", { tenantId, sourceId: id, purged: r.purged });
    return c.json({ ok: true, purged: r.purged });
  });

  app.post("/internal/sources/:id/sync", async (c) => {
    const body = await bodyOf(c.req.raw);
    const tenantId = tenantOf(body?.tenantId);
    const id = c.req.param("id");
    if (!tenantId || !SOURCE_ID.test(id)) return c.json({ error: "invalid_request" }, 400);
    if (!isEnabled(c.env)) return c.json({ error: "connector_disabled" }, 503);
    if (!(await stateStub(c.env, tenantId).getSource(id)))
      return c.json({ error: "not_found" }, 404);
    await c.env.SYNC_QUEUE.send({ tenantId, sourceId: id, reason: "manual" } satisfies QueueMsg);
    return c.json({ ok: true }, 202);
  });

  app.get("/internal/sources/:id/records", async (c) => {
    const tenantId = tenantOf(c.req.query("tenantId"));
    const id = c.req.param("id");
    if (!tenantId || !SOURCE_ID.test(id)) return c.json({ error: "invalid_request" }, 400);
    const store = stateStub(c.env, tenantId);
    const src = await store.getSource(id);
    if (!src) return c.json({ error: "not_found" }, 404);
    const cursor = await store.getCursor(id);
    const deps = aclDeps(c.env, tenantId);
    const files = await store.listFiles(id, 100);
    return c.json({
      records: await Promise.all(
        files.map((f) => toSourceRecord(tenantId, src, f, cursor, deps.now(), deps.maxAgeSeconds)),
      ),
    });
  });

  app.post("/internal/calendar/events", async (c) => {
    const body = await bodyOf(c.req.raw);
    const r = await meetingWindow({
      enabled: c.env.CALENDAR_ENABLED === "true",
      delegatedToken: c.req.header("X-Graph-Delegated-Token") ?? null,
      from: new Date(String(body?.from ?? "")),
      to: new Date(String(body?.to ?? "")),
    });
    if (!r.ok) return c.json(r, r.error === "calendar_disabled" ? 501 : 400);
    return c.json(r);
  });

  app.all("*", (c) => c.json({ error: "not_found" }, 404));
  return app;
}

/** A graph stand-in for paths that never read from Graph (purge). */
const noGraph = {
  getJson: () => Promise.reject(new Error("graph_not_used")),
  getBytes: () => Promise.reject(new Error("graph_not_used")),
};

interface QueueMsg {
  tenantId: string;
  sourceId: string;
  reason: "cron" | "manual";
}

const BUCKET_MS = 5 * 60_000;

export default {
  fetch: createApp().fetch,

  /** Cron: one queue message per enabled source. A no-op when the kill switch is off. */
  async scheduled(_event: ScheduledController, env: Env) {
    if (!isEnabled(env)) return;
    for (const tenantId of tenantsOf(env)) {
      const sources = (await stateStub(env, tenantId).listSources()).filter((s) => s.enabled);
      for (let i = 0; i < sources.length; i += 100)
        await env.SYNC_QUEUE.sendBatch(
          sources.slice(i, i + 100).map((s) => ({
            body: { tenantId, sourceId: s.id, reason: "cron" } satisfies QueueMsg,
          })),
        );
    }
  },

  /** Queue: start one Workflow per source per 5-minute bucket (the id dedupes bursts). */
  async queue(batch: MessageBatch<QueueMsg>, env: Env) {
    for (const msg of batch.messages) {
      const { tenantId, sourceId } = msg.body;
      if (!isEnabled(env) || !TENANT_ID.test(tenantId ?? "") || !SOURCE_ID.test(sourceId ?? "")) {
        msg.ack();
        continue;
      }
      const id = `sync-${(await sha256Hex(`${tenantId}/${sourceId}`)).slice(0, 24)}-${Math.floor(Date.now() / BUCKET_MS)}`;
      try {
        await env.SOURCE_SYNC.create({ id, params: { tenantId, sourceId } satisfies SyncParams });
        log("sync.started", { tenantId, sourceId });
        msg.ack();
      } catch (e) {
        // An instance with this id already exists: the sync is already running or ran in this bucket.
        if (e instanceof Error && /already.*exist|exists/i.test(e.message)) msg.ack();
        else msg.retry({ delaySeconds: 60 });
      }
    }
  },
} satisfies ExportedHandler<Env, QueueMsg>;
