// Agent connections (per host app: last call, scopes, revoke) and pilot cohorts (invite lists and
// feature flags per cohort, admin only). API-CONTRACT "v3 brains".

import { Hono } from "hono";
import { viewOf } from "../auth.ts";
import { tenantStub } from "../stubs.ts";
import { FLAG_KEYS } from "../tenant-policy.ts";
import type { AppDeps, AppEnv } from "../types.ts";
import { audit, bad, type C, forbidden, notFound, readObject, sess, text } from "../ux/util.ts";
import { isAdmin } from "../uxv2/shared.ts";
import { cleanText } from "../wiki/text.ts";
import { HOSTS, isHostId } from "./model.ts";

const GRANT_ID = /^[A-Za-z0-9_-]{1,128}$/;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const COHORT_ID = /^[a-z0-9][a-z0-9-]{0,40}$/;
const iso = (ms: number): string => new Date(ms).toISOString();

async function cohortInput(
  c: C,
): Promise<{ name: string; members: string[]; flags: Record<string, boolean> }> {
  const b = await readObject(c);
  const name = cleanText(text(b.name, 1, 60, "invalid_name"), 60);
  if (!name) throw bad("invalid_name");
  if (!Array.isArray(b.members) || b.members.length > 500) throw bad("invalid_members");
  const members = b.members.map((m) => (typeof m === "string" ? m.trim().toLowerCase() : ""));
  if (members.some((m) => !EMAIL.test(m) || m.length > 254)) throw bad("invalid_members");
  const flags: Record<string, boolean> = {};
  if (b.flags !== undefined) {
    if (!b.flags || typeof b.flags !== "object" || Array.isArray(b.flags))
      throw bad("invalid_flags");
    for (const [k, v] of Object.entries(b.flags)) {
      if (!(FLAG_KEYS as readonly string[]).includes(k) || typeof v !== "boolean")
        throw bad("invalid_flags");
      flags[k] = v;
    }
  }
  return { name, members, flags };
}

export function agentRoutes(_deps: AppDeps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  // ---- agent connections: the caller's own ----

  r.get("/agents", async (c) => {
    const s = sess(c);
    const rows = await tenantStub(c.env, s.tenantId).agentList(s.principal.id);
    c.header("Cache-Control", "no-store");
    return c.json({
      hosts: HOSTS.map(([id, label]) => {
        const mine = rows.filter((x) => x.host === id);
        const active = mine.filter((x) => !x.revoked);
        const last = mine.length ? Math.max(...mine.map((x) => x.lastAt)) : null;
        return {
          id,
          label,
          connected: active.length > 0,
          lastCallAt: last === null ? null : iso(last),
          calls: mine.reduce((n, x) => n + x.calls, 0),
          scopes: [...new Set(active.flatMap((x) => x.scopes))].sort(),
          connections: mine.map((x) => ({
            id: x.grantId,
            lastCallAt: iso(x.lastAt),
            lastTool: x.lastTool,
            scopes: x.scopes,
            state: x.revoked ? "revoked" : "active",
          })),
        };
      }),
    });
  });

  // Where the MCP door is: the configured MCP_PUBLIC_URL plus /mcp, or null when none is configured (the
  // web page then guesses). Public configuration, same for everyone: no tenant or person data.
  r.get("/agents/config", (c) => {
    const base = (c.env.MCP_PUBLIC_URL ?? "").trim().replace(/\/+$/, "");
    c.header("Cache-Control", "no-store");
    return c.json({ mcpUrl: /^https?:\/\/[^\s/]+$/.test(base) ? `${base}/mcp` : null });
  });

  r.post("/agents/connections/:id/revoke", async (c) => {
    const s = sess(c);
    const id = c.req.param("id");
    // A connection id is required and well formed: nothing is revoked on a guess (M-3).
    if (!GRANT_ID.test(id)) throw bad("connection_id_required");
    const tenant = tenantStub(c.env, s.tenantId);
    if (!(await tenant.agentList(s.principal.id)).some((x) => x.grantId === id)) throw notFound();
    if (!(await audit(c, { action: "agent.revoke", nodeId: null, scopeId: null, revision: null })))
      return c.json({ error: "audit_unavailable" }, 503);
    const done = await tenant.agentRevoke(s.principal.id, { grantId: id }, s.ctx.now);
    return c.json({ ok: true, revoked: done.length });
  });

  // Revoke every connection of the caller, on purpose: the body must say so. Never reached by a missing id.
  r.post("/agents/revoke-all", async (c) => {
    const s = sess(c);
    const body = await readObject(c).catch(() => ({}) as Record<string, unknown>);
    if (body.confirm !== true) throw bad("confirm_required");
    if (
      !(await audit(c, { action: "agent.revoke_all", nodeId: null, scopeId: null, revision: null }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    const done = await tenantStub(c.env, s.tenantId).agentRevoke(
      s.principal.id,
      { all: true },
      s.ctx.now,
    );
    return c.json({ ok: true, revoked: done.length });
  });

  r.post("/agents/hosts/:host/revoke", async (c) => {
    const s = sess(c);
    const host = c.req.param("host");
    if (!isHostId(host)) throw notFound();
    if (
      !(await audit(c, {
        action: "agent.revoke_host",
        nodeId: null,
        scopeId: null,
        revision: null,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    const done = await tenantStub(c.env, s.tenantId).agentRevoke(
      s.principal.id,
      { host },
      s.ctx.now,
    );
    return c.json({ ok: true, revoked: done.length });
  });

  // ---- feature flags of the caller ----

  r.get("/me/flags", async (c) => {
    const s = sess(c);
    c.header("Cache-Control", "no-store");
    return c.json({ flags: await tenantStub(c.env, s.tenantId).flagsFor(s.principal.email) });
  });

  // ---- pilot cohorts: admin only ----

  const adminOnly = (c: C): Response | null =>
    isAdmin(viewOf(sess(c))) ? null : forbidden(c, "Pilot cohorts are for a Platform admin");

  r.get("/admin/pilot", async (c) => {
    const no = adminOnly(c);
    if (no) return no;
    c.header("Cache-Control", "no-store");
    return c.json({
      cohorts: await tenantStub(c.env, sess(c).tenantId).pilotList(),
      flagKeys: FLAG_KEYS,
    });
  });

  r.post("/admin/pilot", async (c) => {
    const no = adminOnly(c);
    if (no) return no;
    const s = sess(c);
    const input = await cohortInput(c);
    if (!(await audit(c, { action: "pilot.create", nodeId: null, scopeId: null, revision: null })))
      return c.json({ error: "audit_unavailable" }, 503);
    const id = `c-${[...crypto.getRandomValues(new Uint8Array(5))].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
    const res = await tenantStub(c.env, s.tenantId).pilotSave({ id, ...input }, true, s.ctx.now);
    if (res === "too_many") return c.json({ error: "too_many", reason: "At most 20 cohorts" }, 422);
    return c.json({ ok: true, id }, 201);
  });

  r.put("/admin/pilot/:id", async (c) => {
    const no = adminOnly(c);
    if (no) return no;
    const s = sess(c);
    const id = c.req.param("id");
    if (!COHORT_ID.test(id)) throw notFound();
    const input = await cohortInput(c);
    if (!(await audit(c, { action: "pilot.update", nodeId: null, scopeId: null, revision: null })))
      return c.json({ error: "audit_unavailable" }, 503);
    const res = await tenantStub(c.env, s.tenantId).pilotSave({ id, ...input }, false, s.ctx.now);
    if (res === "not_found") throw notFound();
    return c.json({ ok: true, id });
  });

  r.delete("/admin/pilot/:id", async (c) => {
    const no = adminOnly(c);
    if (no) return no;
    const s = sess(c);
    const id = c.req.param("id");
    if (!COHORT_ID.test(id)) throw notFound();
    if (!(await audit(c, { action: "pilot.delete", nodeId: null, scopeId: null, revision: null })))
      return c.json({ error: "audit_unavailable" }, 503);
    if (!(await tenantStub(c.env, s.tenantId).pilotDelete(id))) throw notFound();
    return c.json({ ok: true });
  });

  return r;
}
