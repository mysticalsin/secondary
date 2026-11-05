// Ops worker: scheduled backups, retention and the admin routes for listing and restoring snapshots.
// Cron "17 2 * * *" snapshots and prunes, cron "47 3 * * *" runs the retention job.

import { Hono } from "hono";
import { logEvent } from "../../../packages/contracts/src/log.ts";
import { accessConfigured, type CertsFetcher, verifyAccess } from "./access.ts";
import {
  type BackupDeps,
  listBackups,
  pruneBackups,
  restoreBackup,
  runBackup,
  runRetention,
} from "./backup.ts";

const KEY_MIN = 32;

/** Constant-time string comparison. */
function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

const deps = (env: Env): BackupDeps => ({
  BACKUPS: env.BACKUPS,
  API: env.API,
  ENVIRONMENT: env.ENVIRONMENT,
  OPS_HMAC_KEY: env.OPS_HMAC_KEY,
  OPS_HMAC_KID: env.OPS_HMAC_KID,
  BACKUP_KEY: env.BACKUP_KEY,
  BACKUP_KEY_PREVIOUS: env.BACKUP_KEY_PREVIOUS,
  BACKUP_RETENTION_DAYS: env.BACKUP_RETENTION_DAYS,
  RESTORE_ENABLED: env.RESTORE_ENABLED,
});

/** Test seam: where the Access signing keys come from. Production fetches them from the team domain. */
export interface OpsAppDeps {
  certs?: CertsFetcher;
}

export function createOpsApp(opts: OpsAppDeps = {}) {
  const app = new Hono<{ Bindings: Env }>();
  mount(app, opts);
  return app;
}

function mount(app: Hono<{ Bindings: Env }>, opts: OpsAppDeps): void {
  app.get("/health", (c) => c.json({ ok: true, env: c.env.ENVIRONMENT }));

  // Everything else sits behind Cloudflare Access (staging and prod) and needs the admin key. Without
  // a configured key, or without Access where it is required, the routes do not exist.
  app.use("*", async (c, next) => {
    const key = c.env.OPS_ADMIN_KEY;
    if (!key || key.length < KEY_MIN) return c.json({ error: "not_found" }, 404);
    if (c.env.ENVIRONMENT !== "dev") {
      if (!accessConfigured(c.env)) return c.json({ error: "not_found" }, 404);
      const ok = await verifyAccess(c.req.header("Cf-Access-Jwt-Assertion"), c.env, opts.certs);
      if (!ok) return c.json({ error: "unauthorized" }, 401);
    }
    if (!safeEqual(c.req.header("X-Ops-Key") ?? "", key))
      return c.json({ error: "unauthorized" }, 401);
    c.header("Cache-Control", "no-store");
    await next();
  });

  mountRoutes(app);
}

function mountRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get("/snapshots", async (c) => {
    const prefix = c.req.query("prefix") ?? "";
    if (!/^[A-Za-z0-9_.:/@-]{0,200}$/.test(prefix)) return c.json({ error: "invalid_prefix" }, 400);
    return c.json({ snapshots: await listBackups(deps(c.env), prefix) });
  });

  app.post("/backup", async (c) => {
    try {
      return c.json({ ok: true, ...(await runBackup(deps(c.env))) });
    } catch (e) {
      logEvent({
        event: "backup_error",
        worker: "ops",
        errorName: e instanceof Error ? e.name : "unknown",
      });
      return c.json({ error: "backup_failed" }, 502);
    }
  });

  app.post("/restore", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      key?: unknown;
      dryRun?: unknown;
    } | null;
    const key = body?.key;
    if (
      typeof key !== "string" ||
      !/^\d{4}-\d{2}-\d{2}\/[A-Za-z0-9_.:/@-]{1,200}\.jsonl\.enc$/.test(key)
    )
      return c.json({ error: "invalid_key" }, 400);
    const r = await restoreBackup(deps(c.env), key, body?.dryRun === true);
    logEvent({
      event: "restore",
      worker: "ops",
      env: c.env.ENVIRONMENT,
      ok: r.ok,
      reason: r.ok ? "" : r.error,
    });
    if (r.ok) return c.json(r);
    return c.json(r, r.error === "restore_disabled" ? 403 : r.error === "not_found" ? 404 : 422);
  });

  app.all("*", (c) => c.json({ error: "not_found" }, 404));
  app.onError((_e, c) => c.json({ error: "internal_error" }, 500));
}

export const app = createOpsApp();

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const d = deps(env);
    // The second cron is the retention job; the first snapshots and then prunes old snapshots.
    if (controller.cron === "47 3 * * *") await runRetention(d);
    else {
      await runBackup(d);
      await pruneBackups(d);
    }
  },
} satisfies ExportedHandler<Env>;
