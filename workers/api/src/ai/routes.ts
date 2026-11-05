// AI routes, mounted once in routes.ts: `v1.route("/", aiRoutes(deps))`. Everything here sits behind
// `authenticate`, builds the caller's admitted view first, and answers only from it.
//   GET  /ai/status        what the UI may say about the processor (no secrets)
//   POST /briefs           prepare a meeting brief (evidence-first, cite or say unknown)
//   POST /briefs/save      save a brief the caller holds to their Personal Brain
//   POST /genui/plan       LLM planner when configured, else falls through to the deterministic one

import { type AdmittedView, isPersonalKind } from "@secondary/policy";
import { type Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { appendReceipt, newReceiptId, type Receipt } from "../audit.ts";
import { requireOrg, viewOf } from "../auth.ts";
import { MAX_PROMPT } from "../genui.ts";
import { tenantStub, workspaceStub } from "../stubs.ts";
import type { AppDeps, AppEnv } from "../types.ts";
import { metered, recordUsage } from "../uxv2/ledger.ts";
import {
  type Brief,
  contractGate,
  gate,
  generateBrief,
  PROCESSOR,
  REGION_NOTE,
  renderBrief,
} from "./brief.ts";
import { doBudget, withUserCap } from "./budget.ts";
import { llmPlan } from "./planner.ts";
import { validateBrief, withoutPersonalClaims } from "./prompt.ts";
import { briefProof, briefProofValid } from "./proof.ts";

const NODE_ID = /^[a-z0-9][a-z0-9_.:-]{0,127}$/;
const MAX_QUESTION = 500;
const BRIEFS_PER_MIN = 20;

const bad = (code: string) => new HTTPException(400, { message: code });
const notFound = () => new HTTPException(404, { message: "not_found" });

async function readObject(raw: string, emptyOk = false): Promise<Record<string, unknown>> {
  if (!raw.trim() && emptyOk) return {};
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    throw bad("invalid_json");
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) throw bad("invalid_json");
  return v as Record<string, unknown>;
}

const idOf = (v: unknown, code: string): string | undefined => {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string" || !NODE_ID.test(v)) throw bad(code);
  return v;
};

const sha14 = async (s: string): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))]
    .slice(0, 7)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

/** The three optional node ids of a request, validated. */
function targetIn(o: Record<string, unknown>): {
  accountId?: string;
  nodeId?: string;
  meetingId?: string;
} {
  const accountId = idOf(o.accountId, "invalid_account_id");
  const nodeId = idOf(o.nodeId, "invalid_node_id");
  const meetingId = idOf(o.meetingId, "invalid_meeting_id");
  return {
    ...(accountId ? { accountId } : {}),
    ...(nodeId ? { nodeId } : {}),
    ...(meetingId ? { meetingId } : {}),
  };
}

type Target = { accountId: string | null; nodeId: string; meetingId: string | null };

/** Resolves the request to nodes in the caller's view. Anything else is a 404. */
function resolveTarget(
  view: AdmittedView,
  o: { accountId?: string; nodeId?: string; meetingId?: string },
): Target {
  let accountId = o.accountId ?? null;
  const meeting = o.meetingId ? view.nodes.get(o.meetingId) : undefined;
  if (o.meetingId) {
    if (meeting?.kind !== "meeting") throw notFound();
    if (accountId && meeting.account !== accountId) throw notFound();
    accountId = meeting.account ?? null;
  }
  const nodeId = o.nodeId ?? accountId;
  if (!nodeId) throw bad("target_required");
  const n = view.nodes.get(nodeId);
  if (!n || n.level === "structure") throw notFound();
  if (isPersonalKind(n.kind)) throw new HTTPException(403, { message: "personal_not_processed" });
  if (accountId) {
    if (view.nodes.get(accountId)?.kind !== "account") throw notFound();
    if (o.nodeId && n.account !== accountId && n.id !== accountId) throw notFound();
  } else if (n.kind === "account") accountId = n.id;
  else if (n.account) accountId = n.account;
  return { accountId, nodeId, meetingId: o.meetingId ?? null };
}

/** The request names the account by its label or by the first word of it ("Ember Sample SAS" is "Ember"). */
const namesAccount = (asked: string, label: string): boolean => {
  const l = label.toLowerCase();
  const first = l.split(/\s+/)[0] ?? "";
  return asked.includes(l) || (first.length >= 4 && asked.includes(first));
};

export function aiRoutes(deps: AppDeps): Hono<AppEnv> {
  const ai = new Hono<AppEnv>();

  const audit = (
    c: Context<AppEnv>,
    i: Pick<Receipt, "nodeId" | "scopeId" | "decision" | "reason">,
    action = "ai.brief",
  ): Promise<boolean> => {
    const s = c.get("session");
    return appendReceipt(c.env, {
      ...i,
      receiptId: newReceiptId(),
      at: new Date().toISOString(),
      tenantId: s.tenantId,
      principalId: s.principal.id,
      action,
      revision: null,
      requestId: c.get("requestId") ?? null,
      clientId: s.internal?.clientId ?? null,
      tool: s.internal?.tool ?? null,
    });
  };

  /** The tenant's day, with one person's share of it (M-06). */
  const budgetFor = (
    env: Env,
    s: AppEnv["Variables"]["session"],
    g: Extract<ReturnType<typeof gate>, { ok: true }>,
    now: number,
  ) =>
    withUserCap(
      doBudget(env, s.tenantId, now),
      doBudget(env, s.tenantId, now, `u-${s.principal.id}`),
      g.userDailyBudget,
    );

  ai.get("/ai/status", (c) => {
    const g = gate(c.env, c.get("session").switches.ai);
    return c.json({
      state: g.ok ? "ready" : g.error === "ai_disabled" ? "disabled" : "not_configured",
      reason: g.ok ? null : g.reason,
      processor: PROCESSOR,
      model: g.ok ? g.model : null,
      region: REGION_NOTE,
    });
  });

  /** Writes or re-versions the brief as a private Personal Brain item. */
  async function persist(
    env: Env,
    s: AppEnv["Variables"]["session"],
    view: AdmittedView,
    b: Brief,
  ): Promise<{ id: string; revision: number }> {
    // R-110 again at the storage boundary: nothing personal is written, whatever the source.
    const safe: Brief = { ...b, sections: withoutPersonalClaims(b.sections) };
    const root = view.nodes.get(b.target.nodeId);
    const meeting = b.target.meetingId ? view.nodes.get(b.target.meetingId) : undefined;
    const title =
      `Brief: ${root?.label ?? b.target.nodeId}${meeting ? ` / ${meeting.label}` : ""}`.slice(
        0,
        200,
      );
    const body = renderBrief(safe);
    const id = `pi:${await sha14(`${b.target.nodeId}|${b.target.meetingId ?? ""}`)}`;
    const ws = workspaceStub(env, s.tenantId, `personal:${s.principal.id}`);
    for (let attempt = 0; attempt < 3; attempt++) {
      const existing = await ws.get(id);
      if (existing) {
        const r = await ws.edit(id, existing.revision, { title, body }, s.ctx.now, s.principal.id);
        if ("ok" in r && r.ok) return { id, revision: r.revision };
        continue;
      }
      const made = await ws.create(
        {
          id,
          label: title,
          kind: "personalitem",
          plane: "PERSONAL_HOSTED",
          origin: "personal",
          status: "draft",
          authorId: s.principal.id,
          body,
          tags: ["brief"],
        },
        s.ctx.now,
      );
      if (!("ok" in made)) return { id, revision: made.revision };
    }
    throw new HTTPException(409, { message: "revision_conflict" });
  }

  ai.post("/briefs", async (c) => {
    const s = c.get("session");
    const g = gate(c.env, s.switches.ai);
    if (!g.ok) return c.json({ error: g.error, reason: g.reason }, g.status);
    const body = await readObject(await c.req.text());
    const q = body.question;
    if (q !== undefined && q !== null && (typeof q !== "string" || q.trim().length > MAX_QUESTION))
      throw bad("invalid_question");
    const question = typeof q === "string" && q.trim() ? q.trim() : null;
    const save = body.save !== false;
    const view = viewOf(s);
    const target = resolveTarget(view, targetIn(body));
    const now = s.ctx.now;
    const limited = await tenantStub(c.env, s.tenantId).hit(
      `ai:${s.principal.id}`,
      now,
      BRIEFS_PER_MIN,
    );
    if (limited.limited) {
      c.header("Retry-After", String(limited.retryAfter));
      return c.json({ error: "rate_limited" }, 429);
    }
    // The customer contract record gates processing. No call is made on a refusal.
    const refusal = contractGate(view, target.accountId ?? undefined);
    if (refusal) {
      await audit(c, {
        nodeId: target.nodeId,
        scopeId: target.accountId,
        decision: "deny",
        reason: refusal.error,
      });
      return c.json(
        { error: refusal.error, reason: refusal.reason, aiProcessing: refusal.aiProcessing },
        refusal.status,
      );
    }
    // Fail closed: the receipt is written before anything leaves the system.
    if (
      !(await audit(c, {
        nodeId: target.nodeId,
        scopeId: target.accountId,
        decision: "allow",
        reason: "brief requested",
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    const out = await generateBrief({
      env: c.env,
      tenantId: s.tenantId,
      view,
      principal: s.principal,
      ai: g,
      budget: budgetFor(c.env, s, g, now),
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
      ...(deps.sleep ? { sleep: deps.sleep } : {}),
      now,
      target,
      question,
    });
    if (!out.ok) return c.json({ error: out.error, reason: out.reason }, out.status);
    const used = out.brief.disclosure.usage;
    await recordUsage(c.env, s.tenantId, s.principal.id, now, {
      capability: "brief",
      tokens: used.inputTokens + used.outputTokens,
      runs: 1,
    });
    const saved =
      save && !out.brief.insufficientEvidence ? await persist(c.env, s, view, out.brief) : null;
    // The proof lets the save endpoint tell this brief from one a client made up (L-04).
    const proof = await briefProof(c.env, s.tenantId, s.principal.id, out.brief);
    return c.json({ brief: { ...out.brief, ...(proof ? { proof } : {}) }, saved }, 200);
  });

  ai.post("/briefs/save", async (c) => {
    const s = c.get("session");
    if (!s.switches.ai) return c.json({ error: "switched_off", switch: "ai" }, 503);
    requireOrg(s);
    const body = await readObject(await c.req.text());
    const raw = body.brief as Record<string, unknown> | undefined;
    if (!raw || typeof raw !== "object") throw bad("invalid_brief");
    // Only a brief this server generated for this person, unchanged and recent, can be stored (L-04).
    if (
      !(await briefProofValid(
        c.env,
        s.tenantId,
        s.principal.id,
        raw as Parameters<typeof briefProofValid>[3],
        raw.proof,
        s.ctx.now,
      ))
    )
      throw bad("brief_not_generated_here");
    const view = viewOf(s);
    const t = (raw.target ?? {}) as Record<string, unknown>;
    const target = resolveTarget(view, targetIn(t));
    // Evidence is taken from the caller's view, never from the request: titles and planes come from there.
    const evidence = (Array.isArray(raw.evidence) ? raw.evidence : []).flatMap((e: unknown) => {
      const o = e as { id?: unknown; nodeId?: unknown };
      const n = typeof o?.nodeId === "string" ? view.nodes.get(o.nodeId) : undefined;
      return n && typeof o.id === "string" && /^E\d{1,2}$/.test(o.id) && !isPersonalKind(n.kind)
        ? [{ id: o.id, nodeId: n.id, title: n.label, plane: n.plane }]
        : [];
    });
    const parsed = validateBrief(raw, new Set(evidence.map((e) => e.id)));
    if (!parsed?.sections.length) throw bad("invalid_brief");
    const d = (raw.disclosure ?? {}) as Record<string, unknown>;
    const str = (v: unknown, n: number) =>
      typeof v === "string" ? v.replace(/[^\w .:+-]/g, "").slice(0, n) : "";
    const brief: Brief = {
      target,
      question: null,
      title: parsed.title,
      sections: parsed.sections,
      evidence,
      excluded: [],
      insufficientEvidence: false,
      dropped: parsed.dropped,
      disclosure: {
        processor: PROCESSOR,
        model: str(d.model, 80) || "unknown",
        region: REGION_NOTE,
        generatedAt: str(d.generatedAt, 40) || new Date(s.ctx.now).toISOString(),
        usage: { inputTokens: 0, outputTokens: 0 },
      },
    };
    return c.json({ saved: await persist(c.env, s, view, brief) }, 201);
  });

  // The LLM planner only runs when the processor is ready; every other case, and every failure, is
  // answered by the deterministic planner registered after this one.
  ai.post("/genui/plan", async (c, next) => {
    const s = c.get("session");
    const g = gate(c.env, s.switches.ai);
    if (!g.ok) return next();
    let prompt: string | undefined;
    let nodeId: string | undefined;
    try {
      const body = await readObject(await c.req.text(), true);
      if (typeof body.prompt === "string") {
        if (body.prompt.trim().length > MAX_PROMPT) return next();
        prompt = body.prompt.trim();
      } else if (body.prompt !== undefined && body.prompt !== null) return next();
      nodeId = idOf(body.nodeId, "invalid_node_id");
    } catch {
      return next();
    }
    if (!prompt && !nodeId) return next();
    const view = viewOf(s);
    // M-06: the account contract decides, as it does for a brief. An account the node belongs to, or
    // that the request names, without an explicit "allowed" keeps the request with the deterministic
    // planner: nothing is sent. Every call to the model is on the record first, ids only.
    const node = nodeId ? view.nodes.get(nodeId) : undefined;
    if (nodeId && !node) return next();
    const accounts = new Set<string>();
    if (node) {
      const a = node.kind === "account" ? node.id : node.account;
      if (a) accounts.add(a);
    }
    const asked = (prompt ?? "").toLowerCase();
    if (asked)
      for (const [id, n] of view.nodes)
        if (
          n.kind === "account" &&
          (asked.includes(id.toLowerCase()) || namesAccount(asked, n.label))
        )
          accounts.add(id);
    for (const a of accounts) {
      const refusal = contractGate(view, a);
      if (refusal) {
        await audit(
          c,
          { nodeId: nodeId ?? a, scopeId: a, decision: "deny", reason: refusal.error },
          "ai.plan",
        );
        return next();
      }
    }
    if (
      !(await audit(
        c,
        {
          nodeId: nodeId ?? null,
          scopeId: [...accounts][0] ?? null,
          decision: "allow",
          reason: "plan requested",
        },
        "ai.plan",
      ))
    )
      return next();
    const meter = metered(budgetFor(c.env, s, g, s.ctx.now));
    const plan = await llmPlan({
      ai: g,
      view,
      budget: meter.store,
      ...(prompt ? { prompt } : {}),
      ...(nodeId ? { nodeId } : {}),
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
      ...(deps.sleep ? { sleep: deps.sleep } : {}),
    });
    await recordUsage(c.env, s.tenantId, s.principal.id, s.ctx.now, {
      capability: "planner",
      tokens: meter.spent(),
      runs: 1,
    });
    return plan ? c.json(plan) : next();
  });

  return ai;
}
