// Operations admin routes (authenticated, Platform admin / "configure" only) and the kill switch gate.
//   GET  /v1/admin/switches            state of the switches and pending re-enable requests
//   POST /v1/admin/switches            { switch, enabled }; re-enabling needs a second person in prod.
//   POST /v1/admin/rights/export       { principal } (id or email); needs a second person (202 until then)
//   POST /v1/admin/rights/erase        { principal }; always needs a second person

import { Hono, type MiddlewareHandler } from "hono";
import { quorumConfirmed } from "../../../src/state/quorum.ts";
import { HTTPException } from "hono/http-exception";
import { appendReceipt, newReceiptId } from "./audit.ts";
import { requireOrg, viewOf } from "./auth.ts";
import { humanIdsOf } from "./human.ts";
import {
  eraseSubject,
  exportSubject,
  pseudonymFor,
  resolveSubject,
  SUBJECT_PARAM,
} from "./ops-rights.ts";
import { tenantStub } from "./stubs.ts";
import { isSwitchName, SWITCHES, type SwitchName } from "./switches.ts";
import type { AppDeps, AppEnv, Session } from "./types.ts";

const envName = (env: Env): string => env.ENVIRONMENT;
const isProd = (env: Env): boolean => envName(env) === "prod";

// ---- kill switch gate ----

const GATES: { name: SwitchName; match: (method: string, path: string) => boolean }[] = [
  {
    name: "contribute",
    match: (m, p) => m === "POST" && /^\/v1\/personal\/items\/[^/]+\/contribute$/.test(p),
  },
  // Every route that can reach the model: the planner, /v1/ai/*, and briefs (H-05). New AI routes
  // must be listed here AND call gate(env, switches.ai) in the handler. Wiki ingest runs in a Durable Object job
  // without a session: it reads the tenant's `ai` switch itself (wiki/engine.ts, aiSwitchOn) and passes it to gate().
  {
    name: "ai",
    match: (_m, p) =>
      p === "/v1/genui/plan" ||
      p.startsWith("/v1/ai/") ||
      p === "/v1/briefs" ||
      p.startsWith("/v1/briefs/"),
  },
  // Synced source files are served from /v1/sources/:id; search hits are gated in the handler (M-04).
  {
    name: "connector",
    match: (_m, p) => p.startsWith("/v1/connectors/") || p.startsWith("/v1/sources/"),
  },
];

export const switchedOff = (name: SwitchName) => ({ error: "switched_off", switch: name });

/** Runs after authentication. MCP calls need the mcp switch, other routes the switch that owns them. */
export const switchGate: MiddlewareHandler<AppEnv> = async (c, next) => {
  const s = c.get("session");
  if (s.internal && !s.switches.mcp) return c.json(switchedOff("mcp"), 503);
  const path = new URL(c.req.url).pathname;
  for (const g of GATES)
    if (!s.switches[g.name] && g.match(c.req.method, path)) return c.json(switchedOff(g.name), 503);
  await next();
};

// ---- routes ----

const forbidden = (reason: string) => new HTTPException(403, { message: reason });

export function opsAdminRoutes(deps: AppDeps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const now = () => deps.now?.() ?? Date.now();

  async function requireConfigure(c: { get: (k: "session") => Session }): Promise<Session> {
    const s = c.get("session");
    requireOrg(s);
    const ok = viewOf(s).roles.some((x) => x.grants.some((g) => g.actions.includes("configure")));
    if (!ok) throw forbidden("forbidden");
    return s;
  }

  /** Receipt for an admin operation. Ids only, never content. */
  async function audit(
    c: { env: Env; get: (k: "requestId") => string },
    s: Session,
    action: string,
    reason: string,
  ): Promise<boolean> {
    return appendReceipt(c.env, {
      receiptId: newReceiptId(),
      at: new Date(now()).toISOString(),
      tenantId: s.tenantId,
      principalId: s.principal.id,
      action,
      nodeId: null,
      scopeId: null,
      decision: "allow",
      reason,
      revision: null,
      requestId: c.get("requestId") ?? null,
      clientId: null,
      tool: null,
    });
  }

  r.get("/switches", async (c) => {
    const s = await requireConfigure(c);
    const st = await tenantStub(c.env, s.tenantId).switchStatus(now());
    return c.json({ ...st, twoPersonReenable: isProd(c.env), names: SWITCHES });
  });

  r.post("/switches", async (c) => {
    const s = await requireConfigure(c);
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || !isSwitchName(body.switch) || typeof body.enabled !== "boolean")
      return c.json({ error: "invalid_switch" }, 400);
    const { switch: name, enabled } = body as { switch: SwitchName; enabled: boolean };
    // Re-enabling is the risky direction: it is audited first, and in prod it needs a second person.
    if (enabled && !(await audit(c, s, "switch_enable", `${name} on requested`)))
      return c.json({ error: "audit_unavailable" }, 503);
    const res = await tenantStub(c.env, s.tenantId).setSwitch(
      name,
      enabled,
      s.principal.id,
      now(),
      isProd(c.env),
      s.principal.email,
    );
    // Turning a switch off must never wait for the audit log (incident response).
    if (!enabled) await audit(c, s, "switch_disable", `${name} off`);
    if (res.status === "pending")
      return c.json({ ok: true, status: "pending", switch: name, needs: "second_person" }, 202);
    return c.json({ ok: true, status: "applied", switch: name, enabled });
  });

  // H-06: an export returns a person's whole Personal Brain, so one configure holder is not enough.
  // The first request records, a different configure holder confirms within 24 hours and receives
  // the bundle. Both steps are audited with the subject's pseudonym, never the id or the content.
  // N-03: both steps are a POST (JSON body, behind the mutation guard), so a link or a cross-site
  // navigation cannot confirm for a second admin. A GET is refused.
  r.get("/rights/export", (c) => c.json({ error: "method_not_allowed" }, 405, { Allow: "POST" }));
  r.post("/rights/export", async (c) => {
    const s = await requireConfigure(c);
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const raw = typeof body?.principal === "string" ? body.principal : "";
    if (!SUBJECT_PARAM.test(raw)) return c.json({ error: "invalid_principal" }, 400);
    const org = requireOrg(s);
    const principalId = await resolveSubject(c.env, s.tenantId, raw);
    const pseudonym = await pseudonymFor(c.env, s.tenantId, principalId);
    if (!pseudonym) return c.json({ error: "export_disabled" }, 503);
    const step = await tenantStub(c.env, s.tenantId).requestSecond(
      `export:${principalId}`,
      s.principal.id,
      now(),
      s.principal.email,
    );
    if (!quorumConfirmed(step)) {
      if (!(await audit(c, s, "rights_export_request", `export requested for ${pseudonym}`)))
        return c.json({ error: "audit_unavailable" }, 503);
      return c.json({ ok: true, status: "pending", needs: "second_person", pseudonym }, 202);
    }
    if (!(await audit(c, s, "rights_export", `export of ${pseudonym}`)))
      return c.json({ error: "audit_unavailable" }, 503);
    const bundle = await exportSubject(c.env, s.tenantId, org, principalId);
    c.header("Content-Disposition", 'attachment; filename="subject-export.json"');
    return c.json(bundle);
  });

  r.post("/rights/erase", async (c) => {
    const s = await requireConfigure(c);
    const org = requireOrg(s);
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const raw = typeof body?.principal === "string" ? body.principal : "";
    if (!SUBJECT_PARAM.test(raw)) return c.json({ error: "invalid_principal" }, 400);
    const principalId = await resolveSubject(c.env, s.tenantId, raw);
    const pseudonym = await pseudonymFor(c.env, s.tenantId, principalId);
    if (!pseudonym) return c.json({ error: "erase_disabled" }, 503);
    if ((await humanIdsOf(c.env, s)).includes(principalId))
      return c.json({ error: "cannot_erase_self" }, 409);

    const step = await tenantStub(c.env, s.tenantId).requestSecond(
      `erase:${principalId}`,
      s.principal.id,
      now(),
      s.principal.email,
    );
    if (!quorumConfirmed(step)) {
      await audit(c, s, "rights_erase_request", `erase requested for ${pseudonym}`);
      return c.json({ ok: true, status: "pending", needs: "second_person", pseudonym }, 202);
    }
    const done = await eraseSubject(c.env, s.tenantId, org, principalId, pseudonym);
    if (!done) return c.json({ error: "erase_incomplete", reason: "audit_unavailable" }, 502);
    await audit(c, s, "rights_erase", `erased ${pseudonym}`);
    return c.json({ ok: true, status: "erased", ...done });
  });

  return r;
}
