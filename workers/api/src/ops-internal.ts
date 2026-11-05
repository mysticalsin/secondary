// Calls from workers/ops over a service binding. Every route verifies an HMAC signed with OPS_HMAC_KEY
// (packages/contracts/src/ops-auth.ts), a key the internet-facing MCP worker never holds (M-01), checks
// the nonce against the replay cache, and refuses public traffic. No Access identity is involved: these
// are machine calls and carry no user data beyond the snapshot they were asked for.
//
// workers/mcp has its own read-only route for the kill switch state: GET /v1/internal/mcp/switches,
// signed with INTERNAL_HMAC_KEY. That key cannot reach anything under /v1/internal/ops.

import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { verifyOpsRequest } from "../../../packages/contracts/src/ops-auth.ts";
import { getOrg } from "./org.ts";
import { internalKeys, opsKeys, replayStore } from "./replay.ts";
import { scopeOfNode } from "./scope.ts";
import { tenantStub, workspaceStub } from "./stubs.ts";
import type { AppDeps } from "./types.ts";

const TENANT_ID = /^[a-z0-9_]{3,64}$/;
const SCOPE_ID = /^[a-z0-9][A-Za-z0-9_.:@-]{0,127}$/;
const MAX_RESTORE_BYTES = 16 * 1024 * 1024;
const DAY_MS = 86_400_000;

/** Tenants this deployment knows: the default one and every tenant named in TENANT_DOMAINS. */
export function tenantIds(env: Env): string[] {
  const out = new Set<string>();
  if (TENANT_ID.test(env.DEFAULT_TENANT_ID ?? "")) out.add(env.DEFAULT_TENANT_ID);
  try {
    const parsed: unknown = JSON.parse(env.TENANT_DOMAINS || "{}");
    if (parsed && typeof parsed === "object")
      for (const v of Object.values(parsed))
        if (typeof v === "string" && TENANT_ID.test(v)) out.add(v);
  } catch {
    // A broken mapping adds nothing.
  }
  return [...out].sort();
}

/** Every workspace scope of a tenant: the organisation's scopes plus one Personal Brain per principal. */
export async function tenantScopes(env: Env, tenantId: string): Promise<string[]> {
  const t = tenantStub(env, tenantId);
  const config = await t.getConfig();
  const scopes = new Set<string>();
  if (config) {
    for (const n of getOrg(config).nodes.values()) {
      const s = scopeOfNode(n);
      if (s) scopes.add(s);
    }
  }
  for (const id of await t.listPrincipalIds()) scopes.add(`personal:${id}`);
  return [...scopes].sort();
}

const days = (v: string | undefined, fallback: number): number => {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export function opsInternalRoutes(deps: AppDeps): Hono<{ Bindings: Env }> {
  const r = new Hono<{ Bindings: Env }>();

  r.use("*", async (c, next) => {
    // Public traffic carries CF-Connecting-IP. A service binding does not.
    if (c.req.header("CF-Connecting-IP")) return c.json({ error: "unauthorized" }, 401);
    const at = deps.now?.() ?? Date.now();
    const ok = await verifyOpsRequest(c.req.raw, opsKeys(c.env), {
      now: Math.floor(at / 1000),
      replay: replayStore(c.env, at),
      channel: "ops",
    });
    if (!ok) return c.json({ error: "unauthorized" }, 401);
    c.header("Cache-Control", "no-store");
    await next();
  });

  r.get("/targets", async (c) => {
    const tenants = await Promise.all(
      tenantIds(c.env).map(async (tenantId) => ({
        tenantId,
        scopes: await tenantScopes(c.env, tenantId),
      })),
    );
    return c.json({ tenants });
  });

  const target = (c: { req: { query: (k: string) => string | undefined } }) => {
    const tenant = c.req.query("tenant") ?? "";
    const kind = c.req.query("kind") ?? "";
    const scope = c.req.query("scope") ?? "";
    if (!TENANT_ID.test(tenant)) return null;
    if (kind === "tenant") return { tenant, kind: "tenant" as const, scope: "" };
    if (kind === "workspace" && SCOPE_ID.test(scope))
      return { tenant, kind: "workspace" as const, scope };
    return null;
  };

  r.get("/export", async (c) => {
    const t = target(c);
    if (!t) return c.json({ error: "invalid_target" }, 400);
    const tables =
      t.kind === "tenant"
        ? await tenantStub(c.env, t.tenant).exportAll()
        : await workspaceStub(c.env, t.tenant, t.scope).exportAll();
    return c.json({ tenant: t.tenant, kind: t.kind, scope: t.scope, tables });
  });

  // Dev and staging only by default. Production needs RESTORE_ENABLED=yes set for the duration of the restore.
  r.post(
    "/restore",
    bodyLimit({
      maxSize: MAX_RESTORE_BYTES,
      onError: (c) => c.json({ error: "payload_too_large" }, 413),
    }),
    async (c) => {
      if (c.env.RESTORE_ENABLED !== "yes") return c.json({ error: "restore_disabled" }, 403);
      const t = target(c);
      if (!t) return c.json({ error: "invalid_target" }, 400);
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "invalid_json" }, 400);
      }
      const tables = (body as { tables?: unknown } | null)?.tables;
      try {
        const rows =
          t.kind === "tenant"
            ? await tenantStub(c.env, t.tenant).importAll(tables)
            : await workspaceStub(c.env, t.tenant, t.scope).importAll(tables);
        return c.json({ ok: true, rows });
      } catch {
        return c.json({ error: "invalid_snapshot" }, 422);
      }
    },
  );

  // Delete expired Personal Brain drafts and briefs. Policy: RETENTION_DRAFT_DAYS, RETENTION_BRIEF_DAYS.
  r.post("/retention", async (c) => {
    const now = deps.now?.() ?? Date.now();
    const cutoffs = {
      draft: now - days(c.env.RETENTION_DRAFT_DAYS, 90) * DAY_MS,
      brief: now - days(c.env.RETENTION_BRIEF_DAYS, 30) * DAY_MS,
    };
    let purged = 0;
    let scopes = 0;
    for (const tenantId of tenantIds(c.env)) {
      for (const id of await tenantStub(c.env, tenantId).listPrincipalIds()) {
        scopes++;
        purged += await workspaceStub(c.env, tenantId, `personal:${id}`).purgeExpired(cutoffs);
      }
    }
    return c.json({ ok: true, scopes, purged });
  });

  r.all("*", (c) => c.json({ error: "not_found" }, 404));
  return r;
}

/** Read-only kill switch state for workers/mcp. Signed with INTERNAL_HMAC_KEY, which is all the MCP worker holds. */
export function mcpInternalRoutes(deps: AppDeps): Hono<{ Bindings: Env }> {
  const r = new Hono<{ Bindings: Env }>();
  r.get("/switches", async (c) => {
    if (c.req.header("CF-Connecting-IP")) return c.json({ error: "unauthorized" }, 401);
    const at = deps.now?.() ?? Date.now();
    const ok = await verifyOpsRequest(c.req.raw, internalKeys(c.env), {
      now: Math.floor(at / 1000),
      replay: replayStore(c.env, at),
      channel: "mcp-switches",
    });
    if (!ok) return c.json({ error: "unauthorized" }, 401);
    const tenant = c.req.query("tenant") ?? "";
    if (!TENANT_ID.test(tenant)) return c.json({ error: "invalid_target" }, 400);
    const s = await tenantStub(c.env, tenant).switchStatus(at);
    c.header("Cache-Control", "no-store");
    return c.json({
      switches: Object.fromEntries(Object.entries(s.switches).map(([k, v]) => [k, v.enabled])),
    });
  });
  r.all("*", (c) => c.json({ error: "not_found" }, 404));
  return r;
}
