// /v1/rules: brain rules for admins (tenant wide) and stewards (their brains). The model, validator,
// evaluator and simulator are pure and live in packages/policy/src/rules.ts. This file is authority,
// storage and receipts. Every mutation writes a content-free receipt first and fails closed.

import {
  affectsProtectedBrains,
  FLOOR_IDS,
  type FloorId,
  floorMin,
  type RuleAction,
  type RuleEffect,
  type RuleScope,
  type SimEvent,
  scopeReaches,
  simulateRules,
  validateRule,
} from "@secondary/policy";
import { Hono } from "hono";
import type { Receipt as StoredReceipt } from "../../../../packages/contracts/src/audit-receipt.ts";
import { isConfigure } from "../admin/validate.ts";
import { fetchReceipts } from "../audit.ts";
import { requireOrg, viewOf } from "../auth.ts";
import { brainOf } from "../brains/open.ts";
import type { AppDeps, AppEnv } from "../types.ts";
import { audit, bad, type C, notFound, readObject, sess } from "../ux/util.ts";
import { rulesClient } from "./client.ts";
import { brainTypeFor, tenantTime } from "./context.ts";
import { approverInGroup } from "./gate.ts";
import type { Hold, StoredRule } from "./store.ts";

const iso = (ms: number): string => new Date(ms).toISOString();
const DAY = 86_400_000;
const RULE_ID = /^[A-Za-z0-9_]{1,40}$/;
const FLOOR_ROW = "floor:mcp_review";

type Who = { admin: boolean; view: ReturnType<typeof viewOf> };

const who = (c: C): Who => {
  const view = viewOf(sess(c));
  return { admin: isConfigure(view.roles), view };
};

/** Account, Global, restricted and NDA brains (a node under a restricted parent counts). */
function protectedBrain(org: ReturnType<typeof requireOrg>, id: string): boolean {
  const n = org.nodes.get(id);
  if (!n) return true; // fail closed: an id nobody can place counts as protected
  if (n.kind === "account" || n.kind === "core") return true;
  for (let p: typeof n | undefined = n; p; p = p.parentId ? org.nodes.get(p.parentId) : undefined)
    if (p.restricted || p.nda) return true;
  return false;
}

const scopeLabel = (scope: RuleScope, w: Who): string => {
  if (scope.kind === "tenant") return "Whole tenant";
  if (scope.kind === "brain_types")
    return scope.types
      .map(
        (t) =>
          ({ team: "Team brains", account: "Account brains", global: "Company Global" })[
            t as "team"
          ] ?? t,
      )
      .join(", ");
  return scope.ids.map((id) => w.view.nodes.get(id)?.label ?? "a restricted brain").join(", ");
};

/** Can this person edit and publish the rule? Admins any rule; a steward a rule on brains they decide in. */
async function editable(
  c: C,
  w: Who,
  scope: RuleScope,
  cache: Map<string, boolean>,
): Promise<boolean> {
  if (w.admin) return true;
  if (scope.kind !== "brains") return false;
  for (const id of scope.ids) {
    let ok = cache.get(id);
    if (ok === undefined) {
      ok = (await brainOf(c, id))?.can.decide === true;
      cache.set(id, ok);
    }
    if (!ok) return false;
  }
  return true;
}

async function row(c: C, w: Who, r: StoredRule, cache: Map<string, boolean>) {
  const body = r.published ?? r.draft;
  if (!body) throw new Error("rule without a body");
  const can = await editable(c, w, body.scope, cache);
  return {
    id: r.id,
    name: (can ? (r.draft ?? body) : body).name,
    scope: body.scope,
    scopeLabel: scopeLabel(body.scope, w),
    status: r.published?.status ?? "draft",
    version: r.version,
    effect: body.then.effect as RuleEffect,
    updatedAt: iso(r.editedAt),
    updatedBy: r.editedBy,
    hasDraft: can && r.draft !== null,
    editable: can,
  };
}

const floorRow = () => ({
  id: FLOOR_ROW,
  name: "Agent proposals in shared brains need review",
  scope: { kind: "tenant" } as RuleScope,
  scopeLabel: "Whole tenant",
  status: "enforced",
  version: 0,
  effect: "review" as RuleEffect,
  updatedAt: iso(0),
  updatedBy: "System",
  hasDraft: false,
  editable: false,
  readOnly: true as const,
  floor: "mcp_review" as FloorId,
});

const holdRow = async (c: C, h: Hold) => {
  const s = sess(c);
  const b = await brainOf(c, h.brainId);
  const mine = h.requestedBy === s.principal.id;
  const canDecide =
    !mine &&
    h.status === "pending" &&
    b?.can.decide === true &&
    (await approverInGroup(c, h.group, h.brainId, viewOf(s)));
  return {
    row: {
      id: h.id,
      rule: h.rule,
      action: h.action,
      brain: {
        id: h.brainId,
        label: b?.label ?? s.org?.nodes.get(h.brainId)?.label ?? "a restricted brain",
      },
      requestedAt: iso(h.requestedAt),
      required: h.required,
      approvals: h.approvals.length,
      group: h.group,
      mine,
      canDecide,
      status: h.status,
    },
    visible: mine || b?.can.decide === true,
  };
};

async function holdsFor(c: C) {
  const all = await rulesClient(c.env, sess(c).tenantId).holdList(sess(c).ctx.now);
  const out = [];
  for (const h of all) {
    const r = await holdRow(c, h);
    if (r.visible) out.push(r.row);
  }
  return out;
}

async function incidentView(c: C) {
  const s = sess(c);
  const client = rulesClient(c.env, s.tenantId);
  const inc = await client.incident(s.ctx.now);
  const pendingBy = (await tenantPending(c)) ?? null;
  return {
    on: inc.on,
    since: inc.since === null ? null : iso(inc.since),
    until: inc.until === null ? null : iso(inc.until),
    ...(inc.by ? { by: inc.by === s.principal.id ? "you" : "other" } : {}),
    pending: pendingBy !== null,
    ...(pendingBy !== null ? { pendingBy: pendingBy === s.principal.id ? "you" : "other" } : {}),
  };
}

async function tenantPending(c: C): Promise<string | null> {
  const s = sess(c);
  const { tenantStub } = await import("../stubs.ts");
  return tenantStub(c.env, s.tenantId).pendingRequester("incident:on", s.ctx.now);
}

async function detail(c: C, w: Who, r: StoredRule, cache = new Map<string, boolean>()) {
  const s = sess(c);
  const base = await row(c, w, r, cache);
  const client = rulesClient(c.env, s.tenantId);
  const body = r.published ?? r.draft;
  if (!body) throw new Error("rule without a body");
  const org = requireOrg(s);
  const history = await client.history(r.id);
  const pending = base.editable ? await client.pendingOf(r.id, s.ctx.now) : null;
  const edit = base.editable ? (r.draft ?? r.published ?? body) : body;
  return {
    ...base,
    draft: edit,
    published: r.published,
    nextVersion: r.version + 1,
    editedBy: r.editedBy,
    editedAt: iso(r.editedAt),
    needsSecond: affectsProtectedBrains(edit.scope, (id) => protectedBrain(org, id)),
    pending: pending
      ? {
          by: pending.by === s.principal.id ? "you" : "other",
          at: iso(pending.at),
          kind: pending.kind,
          version: pending.version,
        }
      : null,
    history: history.map((v) => ({
      version: v.version,
      status: v.status,
      by: v.byLabel,
      at: iso(v.at),
      ...(v.rolledBackFrom !== null ? { rolledBackFrom: v.rolledBackFrom } : {}),
      changes: v.changes,
    })),
  };
}

const refuse = (c: C, issues: { code: string; path: string; message: string; floor?: FloorId }[]) =>
  c.json({ error: "rule_refused", issues }, 422);

/** Receipt actions of the rules, for the simulator's legacy mapping of receipts with no metadata. */
const LEGACY: Record<string, RuleAction> = {
  "wiki.propose": "propose_page",
  "brain.push_page": "propose_page",
  "brain.push_change": "propose_change",
  "brain.push_session_report": "write_session_report",
  "brain.import": "import",
  "brain.export": "export",
  "wiki.approve": "publish",
};

/** One receipt as a replayable event, or null when it carries nothing a rule could match. */
export function eventOf(
  r: StoredReceipt,
  env: Env,
  typeOf: (nodeId: string) => "team" | "account" | "global" | null,
): SimEvent | null {
  if (r.action === "rule.would_match" || r.action === "rule.hold") return null;
  const at = Date.parse(r.at);
  if (!Number.isFinite(at)) return null;
  const m = r.meta;
  if (m?.brainId && m.brainType && m.brainType !== "personal")
    return {
      at,
      actor: {
        kind: m.actor,
        host: (m.host as SimEvent["actor"]["host"]) ?? null,
        roles: [],
      },
      action: m.action as RuleAction,
      brain: { id: m.brainId, type: m.brainType },
      flags: m.flags as SimEvent["flags"],
      pages: m.pages,
      contract: m.contract,
      time: tenantTime(env, at),
    };
  const action = LEGACY[r.action];
  const node = r.nodeId;
  const type = node ? typeOf(node) : null;
  if (!action || !node || !type) return null;
  return {
    at,
    actor: { kind: r.clientId || r.tool ? "agent" : "human", host: null, roles: [] },
    action,
    brain: { id: node, type },
    flags: [],
    pages: null,
    contract: null,
    time: tenantTime(env, at),
  };
}

export function rulesRoutes(_deps: AppDeps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  /** Admins everywhere, stewards for one brain. Anyone else gets 404: the surface does not exist for them. */
  async function gate(
    c: C,
  ): Promise<{ w: Who; brain: { id: string; label: string } | null } | Response> {
    const w = who(c);
    const id = c.req.query("brain");
    if (id !== undefined) {
      const b = await brainOf(c, id);
      if (!b || b.personal || !(b.can.decide || w.admin)) throw notFound();
      return { w, brain: { id: b.nodeId, label: b.label } };
    }
    if (!w.admin) throw notFound();
    return { w, brain: null };
  }

  /** Who may touch rules at all: an admin, or a steward of at least one brain. */
  async function mayEdit(c: C, w: Who, scope: RuleScope): Promise<boolean> {
    return editable(c, w, scope, new Map());
  }

  r.get("/rules", async (c) => {
    const g = await gate(c);
    if (g instanceof Response) return g;
    const s = sess(c);
    const all = await rulesClient(c.env, s.tenantId).list();
    const cache = new Map<string, boolean>();
    const rows: Awaited<ReturnType<typeof row>>[] = [];
    for (const rule of all) {
      const body = rule.published ?? rule.draft;
      if (!body) continue;
      if (g.brain) {
        const org = requireOrg(s);
        const node = org.nodes.get(g.brain.id);
        const type = node
          ? brainTypeFor({ personal: false, vn: g.w.view.nodes.get(g.brain.id) ?? null })
          : null;
        if (!type || !scopeReaches(body.scope, { id: g.brain.id, type })) continue;
      }
      rows.push(await row(c, g.w, rule, cache));
    }
    const since = s.ctx.now - 30 * DAY;
    const counts = {
      total: rows.length,
      enforced: rows.filter((x) => x.status === "enforced").length,
      monitor: rows.filter((x) => x.status === "monitor").length,
      draft: rows.filter((x) => x.status === "draft").length,
      new: all.filter((x) => x.createdAt >= since && rows.some((y) => y.id === x.id)).length,
      since: iso(since).slice(0, 10),
    };
    return c.json({
      canEdit: g.w.admin || rows.some((x) => x.editable) || g.brain !== null,
      brain: g.brain,
      rules: [floorRow(), ...rows],
      counts,
      incident: await incidentView(c),
      holds: await holdsFor(c),
    });
  });

  r.get("/rules/incident", async (c) => {
    const w = who(c);
    if (!w.admin) throw notFound();
    return c.json(await incidentView(c));
  });

  r.put("/rules/incident", async (c) => {
    const w = who(c);
    if (!w.admin) throw notFound();
    const s = sess(c);
    const body = await readObject(c);
    if (typeof body.on !== "boolean") throw bad("invalid_on");
    if (
      !(await audit(c, {
        action: "rules.incident",
        nodeId: null,
        scopeId: null,
        revision: null,
        reason: body.on ? "on" : "off",
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    const res = await rulesClient(c.env, s.tenantId).incidentSet(body.on, {
      by: s.principal.id,
      email: s.principal.email,
      now: s.ctx.now,
    });
    const view = await incidentView(c);
    if (!res.applied)
      return c.json(
        { status: "pending", needs: "second_person", sameActor: res.sameActor, incident: view },
        202,
      );
    return c.json({ status: "applied", incident: view });
  });

  r.get("/rules/holds", async (c) => {
    const w = who(c);
    void w;
    return c.json(await holdsFor(c));
  });

  r.post("/rules/holds/:id/decide", async (c) => {
    const s = sess(c);
    const id = c.req.param("id");
    const body = await readObject(c);
    if (body.decision !== "approve" && body.decision !== "reject") throw bad("invalid_decision");
    const client = rulesClient(c.env, s.tenantId);
    const h = await client.holdGet(id);
    if (!h) throw notFound();
    const row = await holdRow(c, h);
    if (!row.visible) throw notFound();
    if (!row.row.canDecide && !row.row.mine)
      return c.json({ error: "forbidden", reason: "You cannot decide this action" }, 403);
    if (
      !(await audit(c, {
        action: "rules.hold_decide",
        nodeId: h.brainId,
        scopeId: null,
        revision: null,
        reason: body.decision,
        rule: h.rule || null,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    if (!row.row.canDecide)
      return c.json(
        {
          error: "self_approval",
          reason: "You asked for this action, so a different person must decide it",
        },
        403,
      );
    const res = await client.holdDecide(id, body.decision, s.principal.id, s.ctx.now);
    if (!res.ok)
      return c.json({ error: res.code, reason: res.message }, res.status === 404 ? 404 : 409);
    return c.json({ status: res.status, approvals: res.approvals, required: res.required });
  });

  r.put("/rules/groups", async (c) => {
    const w = who(c);
    if (!w.admin) throw notFound();
    const body = await readObject(c);
    const ids = Array.isArray(body.privacy) ? body.privacy : null;
    if (!ids || ids.some((x) => typeof x !== "string" || x.length > 128))
      throw bad("invalid_privacy");
    if (!(await audit(c, { action: "rules.groups", nodeId: null, scopeId: null, revision: null })))
      return c.json({ error: "audit_unavailable" }, 503);
    await rulesClient(c.env, sess(c).tenantId).groupSet(ids as string[]);
    return c.json({ ok: true });
  });

  r.post("/rules/validate", async (c) => {
    const w = who(c);
    const s = sess(c);
    const body = await readObject(c);
    const v = validateRule(body);
    if (!v.ok) return refuse(c, v.issues);
    if (!(await mayEdit(c, w, v.rule.scope)))
      return c.json(
        { error: "scope_not_allowed", reason: "You cannot write rules for that scope" },
        403,
      );
    const org = requireOrg(s);
    return c.json({
      ok: true,
      needsSecond: affectsProtectedBrains(v.rule.scope, (id) => protectedBrain(org, id)),
    });
  });

  r.post("/rules/simulate", async (c) => {
    const w = who(c);
    const s = sess(c);
    const body = await readObject(c);
    const days = body.days === 30 ? 30 : body.days === 7 ? 7 : null;
    if (!days) throw bad("invalid_days");
    const v = validateRule(body.rule);
    if (!v.ok) return refuse(c, v.issues);
    if (!(await mayEdit(c, w, v.rule.scope)))
      return c.json(
        { error: "scope_not_allowed", reason: "You cannot write rules for that scope" },
        403,
      );
    const receipts = await fetchReceipts(c.env, s.tenantId, null, days, 1000);
    if (!receipts)
      return c.json(
        { error: "audit_unavailable", reason: "The audit service is not answering" },
        503,
      );
    const org = requireOrg(s);
    const typeOf = (id: string) => {
      const n = org.nodes.get(id);
      return n
        ? ((brainTypeFor({
            personal: false,
            vn: w.view.nodes.get(id) ?? ({ kind: n.kind } as never),
          }) as "team" | "account" | "global" | null) ?? null)
        : null;
    };
    const cache = new Map<string, boolean>();
    const events: SimEvent[] = [];
    const since = s.ctx.now - days * DAY;
    for (const rc of receipts) {
      const e = eventOf(rc, c.env, typeOf);
      if (!e || e.at < since) continue;
      // A steward replays only the brains they decide in. An admin replays the tenant (ids only).
      if (!w.admin) {
        let ok = cache.get(e.brain.id);
        if (ok === undefined) {
          ok = (await brainOf(c, e.brain.id))?.can.decide === true;
          cache.set(e.brain.id, ok);
        }
        if (!ok) continue;
      }
      events.push(e);
    }
    const sim = simulateRules(v.rule, events, { days, incident: false });
    return c.json({
      days: sim.days,
      total: sim.total,
      matches: sim.matches,
      split: sim.split,
      samples: sim.samples.map((x) => ({
        at: iso(x.at),
        actor: { kind: x.actor.kind, host: x.actor.host ?? null },
        action: x.action,
        brain: w.view.nodes.has(x.brainId)
          ? { id: x.brainId, label: w.view.nodes.get(x.brainId)?.label ?? x.brainId }
          : { id: "restricted", label: "" },
        effect: x.effect,
      })),
      addedWaitMin: sim.addedWaitMin,
      approvalsPerDay: sim.approvalsPerDay,
      estimate: true,
    });
  });

  r.get("/rules/:id", async (c) => {
    const w = who(c);
    const id = c.req.param("id");
    if (!RULE_ID.test(id)) throw notFound();
    const rule = await rulesClient(c.env, sess(c).tenantId).get(id);
    if (!rule) throw notFound();
    const body = rule.published ?? rule.draft;
    // A steward sees a rule only when it reaches a brain they decide in.
    if (!w.admin) {
      const cache = new Map<string, boolean>();
      const mine = body ? await editable(c, w, body.scope, cache) : false;
      if (!mine) {
        const view = w.view;
        const reaches = body
          ? [...view.nodes.values()].some((n) => {
              const t = brainTypeFor({ personal: false, vn: n });
              return t && scopeReaches(body.scope, { id: n.id, type: t }) && n.level === "content";
            })
          : false;
        if (!reaches) throw notFound();
      }
    }
    return c.json(await detail(c, w, rule));
  });

  const save = async (c: C, id: string | null) => {
    const w = who(c);
    const s = sess(c);
    const body = await readObject(c);
    const client = rulesClient(c.env, s.tenantId);
    // A rule that is not yours to edit is not there for you.
    if (id) {
      const cur = await client.get(id);
      if (!cur) throw notFound();
      const was = cur.published ?? cur.draft;
      if (was && !(await mayEdit(c, w, was.scope))) throw notFound();
    }
    const v = validateRule(body);
    if (!v.ok) return refuse(c, v.issues);
    if (!(await mayEdit(c, w, v.rule.scope)))
      return c.json(
        { error: "scope_not_allowed", reason: "You cannot write rules for that scope" },
        403,
      );
    if (
      !(await audit(c, {
        action: "rules.save",
        nodeId: null,
        scopeId: null,
        revision: null,
        reason: id ?? "new",
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    const saved = await client.save(
      id,
      v.rule,
      s.principal.id,
      displayName(s.principal.email),
      s.ctx.now,
    );
    if (!saved.ok)
      return c.json({ error: saved.code, reason: saved.message }, saved.status === 404 ? 404 : 409);
    const rule = await client.get(saved.id);
    if (!rule) throw notFound();
    return c.json(await detail(c, w, rule), id ? 200 : 201);
  };

  r.post("/rules", (c) => save(c, null));
  r.put("/rules/:id", (c) => {
    const id = c.req.param("id");
    if (!RULE_ID.test(id)) throw notFound();
    return save(c, id);
  });

  r.delete("/rules/:id", async (c) => {
    const w = who(c);
    const s = sess(c);
    const id = c.req.param("id");
    if (!RULE_ID.test(id)) throw notFound();
    const client = rulesClient(c.env, s.tenantId);
    const rule = await client.get(id);
    const body = rule?.published ?? rule?.draft;
    if (!rule || !body || !(await mayEdit(c, w, body.scope))) throw notFound();
    if (
      !(await audit(c, {
        action: "rules.delete",
        nodeId: null,
        scopeId: null,
        revision: null,
        reason: id,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    const res = await client.remove(id);
    if (!res.ok) return c.json({ error: res.code, reason: res.message }, 409);
    return c.body(null, 204);
  });

  r.post("/rules/:id/publish", async (c) => {
    const w = who(c);
    const s = sess(c);
    const id = c.req.param("id");
    if (!RULE_ID.test(id)) throw notFound();
    const body = await readObject(c);
    const client = rulesClient(c.env, s.tenantId);
    const rule = await client.get(id);
    if (!rule?.draft) throw notFound();
    if (!(await mayEdit(c, w, rule.draft.scope))) throw notFound();
    // "draft" withdraws the rule: a published version that nothing enforces.
    const status = body.status ?? rule.draft.status;
    if (status !== "draft" && status !== "monitor" && status !== "enforced")
      throw bad("choose_status");
    const v = validateRule({ ...rule.draft, status });
    if (!v.ok) return refuse(c, v.issues);
    const org = requireOrg(s);
    const twoPerson = affectsProtectedBrains(v.rule.scope, (bid) => protectedBrain(org, bid));
    if (
      !(await audit(c, {
        action: "rules.publish",
        nodeId: null,
        scopeId: null,
        revision: null,
        reason: `${status} ${twoPerson ? "two-person" : "single"}`,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    const res = await client.publish(id, status, {
      by: s.principal.id,
      label: displayName(s.principal.email),
      email: s.principal.email,
      now: s.ctx.now,
      twoPerson,
    });
    if (!res.ok)
      return c.json({ error: res.code, reason: res.message }, res.status === 404 ? 404 : 409);
    const fresh = await client.get(id);
    if (!fresh) throw notFound();
    const view = await detail(c, w, fresh);
    if (!res.applied)
      return c.json(
        { status: "pending", needs: "second_person", sameActor: res.sameActor, rule: view },
        202,
      );
    return c.json({ status: "published", version: res.version, rule: view });
  });

  r.post("/rules/:id/rollback", async (c) => {
    const w = who(c);
    const s = sess(c);
    const id = c.req.param("id");
    if (!RULE_ID.test(id)) throw notFound();
    const body = await readObject(c);
    const to = body.toVersion;
    if (typeof to !== "number" || !Number.isInteger(to) || to < 1) throw bad("invalid_version");
    const client = rulesClient(c.env, s.tenantId);
    const rule = await client.get(id);
    const was = rule?.published ?? rule?.draft;
    if (!rule || !was || !(await mayEdit(c, w, was.scope))) throw notFound();
    const old = (await client.history(id)).find((x) => x.version === to);
    if (!old) throw bad("invalid_version");
    if (
      !(await audit(c, {
        action: "rules.rollback",
        nodeId: null,
        scopeId: null,
        revision: to,
        reason: id,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    const res = await client.rollback(id, to, {
      by: s.principal.id,
      label: displayName(s.principal.email),
      email: s.principal.email,
      now: s.ctx.now,
    });
    if (!res.ok)
      return c.json(
        { error: res.code, reason: res.message },
        res.status === 404 ? 404 : res.status === 400 ? 400 : 409,
      );
    const fresh = await client.get(id);
    if (!fresh) throw notFound();
    const view = await detail(c, w, fresh);
    if (!res.applied)
      return c.json(
        { status: "pending", needs: "second_person", sameActor: res.sameActor, rule: view },
        202,
      );
    return c.json({ status: "published", version: res.version, rule: view });
  });

  return r;
}

/** "jane.doe@x" is "Jane Doe". */
const displayName = (email: string): string => {
  const name = (email.split("@")[0] ?? "")
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
  return name.slice(0, 60) || "Unknown";
};

export { FLOOR_IDS, floorMin };
