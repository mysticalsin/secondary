// Operations admin routes (authenticated, Platform admin / "configure" only) and the kill switch gate.
//   GET  /v1/admin/switches            state of the switches and pending re-enable requests
//   POST /v1/admin/switches            { switch, enabled }; re-enabling needs a second person in prod.
//   POST /v1/admin/rights/export       { principal } (id or email); needs a second person (202 until then)
//   POST /v1/admin/rights/erase        { principal }; a second person, unless this subject already holds their grant

import { Hono, type MiddlewareHandler } from "hono";
import { decodeErasureLedger, erasureGrantOk, erasurePlan } from "../../../src/state/erasure-request.ts";
import { quorumConfirmed } from "../../../src/state/quorum.ts";
import { HTTPException } from "hono/http-exception";
import { appendReceipt, newReceiptId } from "./audit.ts";
import { requireOrg, viewOf } from "./auth.ts";
import { humanIdsOf } from "./human.ts";
import {
  companyScopes,
  eraseSubject,
  exportSubject,
  pseudonymKey,
  resolveSubject,
  SUBJECT_PARAM,
} from "./ops-rights.ts";
import { tenantStub } from "./stubs.ts";
import {
  httpSwitch,
  internalSwitch,
  isSwitchName,
  SWITCHES,
  switchedOff,
  type SwitchName,
} from "./switches.ts";
import type { AppDeps, AppEnv, Session } from "./types.ts";

const envName = (env: Env): string => env.ENVIRONMENT;
const isProd = (env: Env): boolean => envName(env) === "prod";
const AUDIT_WAIT_MS = 1_000;

type AuditOutcome = "succeeded" | "refused" | "timed_out";

/** The off path must return even when the audit call does not. */
function boundedAudit(run: Promise<boolean>): Promise<AuditOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve("timed_out");
    }, AUDIT_WAIT_MS);
    run.then(
      (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ok ? "succeeded" : "refused");
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve("refused");
      },
    );
  });
}

// ---- kill switch gate ----

export { switchedOff };

/** Runs after authentication. An internal call is refused on mcp before any path row. */
export const switchGate: MiddlewareHandler<AppEnv> = async (c, next) => {
  const s = c.get("session");
  const mcp = internalSwitch();
  if (s.internal && !s.switches[mcp]) return c.json(switchedOff(mcp), 503);
  const path = new URL(c.req.url).pathname;
  const name = httpSwitch(c.req.method, path, s.switches);
  if (name) return c.json(switchedOff(name), 503);
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
    // Turning a switch off must never wait on a stuck audit log (incident response).
    if (!enabled) {
      const auditOutcome = await boundedAudit(audit(c, s, "switch_disable", `${name} off`));
      if (auditOutcome !== "succeeded" || res.status !== "applied")
        console.warn(
          JSON.stringify({
            at: "switch_disable",
            audit: auditOutcome,
            switch: res.status,
          }),
        );
    }
    if (res.status === "refused" || res.status === "replay" || res.sameActor === true)
      return c.json({ error: "switch_refused" }, 409);
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
    const key = await pseudonymKey(c.env, s.tenantId, principalId);
    if (key.tag === "refused") return c.json({ error: "export_disabled" }, 503);
    const pseudonym = key.pseudonym;
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
    const key = await pseudonymKey(c.env, s.tenantId, principalId);
    if (key.tag === "refused") return c.json({ error: "erase_disabled" }, 503);
    const pseudonym = key.pseudonym;
    if ((await humanIdsOf(c.env, s)).includes(principalId))
      return c.json({ error: "cannot_erase_self" }, 409);

    const tenant = tenantStub(c.env, s.tenantId);
    const plan = erasurePlan(companyScopes(org));
    const existing = decodeErasureLedger(await tenant.erasureLoad(principalId), principalId);
    const tag = existing.status.tag;
    const resumable =
      (tag === "requested" || tag === "running" || tag === "partial_failed") &&
      erasureGrantOk(existing.grant, principalId, plan);
    if (!resumable) {
      const step = await tenant.requestSecond(
        `erase:${principalId}`,
        s.principal.id,
        now(),
        s.principal.email,
        plan,
      );
      if (!quorumConfirmed(step)) {
        await audit(c, s, "rights_erase_request", `erase requested for ${pseudonym}`);
        return c.json({ ok: true, status: "pending", needs: "second_person", pseudonym }, 202);
      }
    }
    const outcome = await eraseSubject(c.env, s.tenantId, org, principalId, pseudonym, now());
    if ("reason" in outcome) return c.json({ error: "erase_disabled" }, 503);
    if (outcome.status !== "completed")
      return c.json({ error: "erase_incomplete", status: outcome.status, step: outcome.step }, 502);
    await audit(c, s, "rights_erase", `erased ${pseudonym}`);
    return c.json({ ok: true, ...outcome, status: "erased" });
  });

  return r;
}
