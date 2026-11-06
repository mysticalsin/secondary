// Review desk API (docs/DESIGN-V8-AMAZING.md section 1). It is a view over the questions the caller
// may already decide (`questionsOf`), scored and sectioned, plus a per-item discussion, snooze,
// reassignment and a per-brain review SLA. Deciding stays where it was (POST /v1/questions/:id), so
// "approve needs every change seen" and the two-person and role rules are enforced there, not here.
// Everything written here is audited first and refused when the audit worker is down.

import { Hono } from "hono";
import { viewOf } from "../auth.ts";
import { type Brain, brainOf, needBrain } from "../brains/open.ts";
import { rateLimit } from "../brains/shared.ts";
import { humanIdsOf } from "../human.ts";
import { detectSensitivity } from "../sensitivity.ts";
import type { AppDeps, AppEnv } from "../types.ts";
import { notifyChangesRequested } from "../ux/notify.ts";
import { audit, bad, type C, forbidden, notFound, readObject, sess, text } from "../ux/util.ts";
import { type Question, questionsOf, resolveQuestion } from "../uxv2/questions.ts";
import { safeJson } from "../uxv2/shared.ts";
import { KeyUnavailable, keyed, keyOf } from "../v8-keys.ts";
import { readableMany } from "../wiki/routes.ts";
import { eligiblePeople, notify, type Person } from "./eligible.ts";
import {
  addedStatements,
  ageOf,
  DAY,
  DEFAULT_SLA_DAYS,
  type DeskKind,
  type DiffLineIn,
  effortMinutes,
  kpisOf,
  mentionsIn,
  priorityOf,
  riskFlags,
  riskOf,
  type Section,
  SLA_MAX_DAYS,
  SLA_MIN_DAYS,
  SNOOZE_MAX_DAYS,
  sectionOf,
  sensitivityOf,
  stripOf,
  summaryOf,
  whatOf,
  wordCount,
} from "./model.ts";
import {
  emptyState,
  type ReviewState,
  readSla,
  readState,
  readStates,
  writeSla,
  writeState,
} from "./store.ts";

const COMMENT_MAX = 2_000;
const COMMENTS_SHOWN = 100;
const FYI_MAX = 10;
const CONTEXT_CHARS = 6_000;
const ID = /^(?:cand:[a-z0-9][A-Za-z0-9_.:@-]*:[0-9a-f]{8}|ask:[0-9a-f]{16})$/;

/** What the desk knows about one brain, read once per request. */
interface Ctx {
  /** The caller's person key, null while PSEUDONYM_KEY is not configured (then no per-person state shows). */
  meKey: string | null;
  brain: Brain | null;
  sla: number;
  states: Map<string, ReviewState>;
  fieldLabels: string[];
}

async function ctxFor(c: C, ids: string[]): Promise<Map<string, Ctx>> {
  const s = sess(c);
  const human = await humanIdsOf(c.env, s);
  const meKey = await keyOf(c.env, s.tenantId, s.principal.id).catch((e) => {
    if (e instanceof KeyUnavailable) return null;
    throw e;
  });
  const out = new Map<string, Ctx>();
  await Promise.all(
    [...new Set(ids)].map(async (id) => {
      const brain = await brainOf(c, id, human);
      if (!brain) {
        out.set(id, {
          meKey,
          brain: null,
          sla: DEFAULT_SLA_DAYS,
          states: new Map(),
          fieldLabels: [],
        });
        return;
      }
      const [sla, states, cfg] = await Promise.all([
        readSla(brain.stub),
        readStates(brain.stub),
        brain.stub.brainConfig(),
      ]);
      out.set(id, {
        meKey,
        brain,
        sla,
        states,
        fieldLabels: cfg.fields.filter((f) => f.sensitivity !== "none").map((f) => f.label),
      });
    }),
  );
  return out;
}

/** What a wiki proposal or a candidate carries in its question detail (see uxv2/questions.ts). */
interface Detail {
  revisionHash?: string;
  approvals?: number;
  required?: number;
  authorId?: string | null;
  changeCount?: number;
  pages?: { pageId: string; title: string; diff: DiffLineIn[] }[];
  pageTypes?: string[];
  rationale?: string;
  text?: string;
  rule?: string;
}
const dOf = (q: Question): Detail => q.detail as Detail;

const isAgent = (authorId: string | null | undefined): boolean => !!authorId?.startsWith("svc:");

const diffOf = (q: Question): DiffLineIn[] => (dOf(q).pages ?? []).flatMap((p) => p.diff);

const ruleOf = (q: Question): string | null => dOf(q).rule ?? null;

/** One row of the desk, built from a question and what the brain knows about it. */
function rowOf(c: C, q: Question, x: Ctx) {
  const s = sess(c);
  const now = s.ctx.now;
  const me = s.principal.id;
  const view = viewOf(s);
  const d = dOf(q);
  const diff = diffOf(q);
  const added = addedStatements(diff);
  const removed = diff.filter((l) => l.type === "del").map((l) => l.text);
  const pages = d.pages ?? [];
  const candidateText = typeof d.text === "string" ? [d.text] : [];
  const brainNode = x.brain?.nodeId ?? q.workspaceId;
  const clientNames = [...view.nodes.values()]
    .filter((n) => n.kind === "account" && n.id !== brainNode)
    .map((n) => n.label);
  const risk = riskOf({
    addedText: added.length ? added : candidateText,
    clientNames,
    fieldLabels: x.fieldLabels,
    rule: ruleOf(q),
  });
  const flags = riskFlags(risk);
  const what = whatOf({
    kind: q.kind as DeskKind,
    title: q.title,
    pageTypes: d.pageTypes ?? [],
    pageIds: pages.map((p) => p.pageId),
    rationale: d.rationale ?? "",
    allAdds: pages.length > 0 && pages.every((p) => p.diff.every((l) => l.type !== "del")),
  });
  const created = Date.parse(q.createdAt);
  const age = ageOf(created, now, x.sla);
  const sens = x.brain ? sensitivityOf(x.brain.facts) : "medium";
  const scored = priorityOf({
    what,
    approvals: d.approvals ?? 0,
    required: d.required ?? 1,
    age,
    sensitivity: sens,
    risk: flags,
  });
  const st = x.states.get(q.id) ?? emptyState();
  const mk = x.meKey;
  const snoozedUntil = (mk && st.snooze[mk]) || null;
  const mentioned = !!mk && (st.mentions[mk] ?? 0) > (st.answered[mk] ?? 0);
  const assignedToMe = !!mk && st.assignedTo === mk;
  const waitingOnAuthor = !!st.changes && st.changes.hash === (d.revisionHash ?? "");
  const section = sectionOf({
    what,
    state: { snoozedUntil, waitingOnAuthor, mentioned },
    nowMs: now,
  });
  const changes = d.changeCount ?? 0;
  const subject =
    q.kind === "contradiction" ? q.title.replace(/^Contradiction:\s*/, "") : undefined;
  return {
    id: q.id,
    kind: q.kind,
    what,
    title: q.title,
    brain: {
      id: q.workspaceId,
      name: x.brain?.label ?? q.workspaceId,
      type: x.brain?.facts.type ?? null,
      sensitivity: sens,
    },
    author: d.authorId ? { id: d.authorId, agent: isAgent(d.authorId) } : null,
    createdAt: q.createdAt,
    age,
    effortMinutes: effortMinutes({
      addedWords: wordCount(added.length ? added : candidateText),
      removedWords: wordCount(removed),
      changes,
    }),
    risk: flags,
    priority: scored.priority,
    reasons: scored.reasons,
    section,
    snoozedUntil: snoozedUntil && snoozedUntil > now ? new Date(snoozedUntil).toISOString() : null,
    // The record holds a keyed id: the list names the caller only. The item view resolves the person.
    assignedTo: assignedToMe ? me : null,
    assignedToMe,
    assigned: !!st.assignedTo,
    waitingOnAuthor,
    summary: {
      text: summaryOf({
        what,
        pageTitles: pages.map((p) => p.title),
        added: added.length || (candidateText.length ? 1 : 0),
        removed: removed.length,
        changes,
        ...(subject ? { subject } : {}),
        ...(d.required ? { required: d.required } : {}),
        approvals: d.approvals ?? 0,
      }),
      source: "rules" as const,
    },
    approvals: d.approvals ?? 0,
    required: d.required ?? 1,
    changeCount: changes,
    risk_detail: risk,
  };
}

type Row = ReturnType<typeof rowOf>;

const byPriority = (a: Row, b: Row) =>
  b.priority - a.priority || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/** Decisions and timeline for the brains where the caller decides: the strip and the KPIs. */
async function history(c: C, ctxs: Map<string, Ctx>, humanIds: ReadonlySet<string>) {
  const s = sess(c);
  const now = s.ctx.now;
  const proposals: { id: string; status: string; createdAt: number }[] = [];
  const decided: { createdAt: number; decidedAt: number }[] = [];
  const fyi: {
    id: string;
    title: string;
    brainId: string;
    brainName: string;
    decidedAt: string;
    by: string;
    status: string;
  }[] = [];
  for (const x of ctxs.values()) {
    const b = x.brain;
    if (!b || b.personal || !b.can.decide) continue;
    const [open, ok, no, log] = await Promise.all([
      b.stub.wikiProposals("candidate"),
      b.stub.wikiProposals("approved"),
      b.stub.wikiProposals("rejected"),
      b.stub.wikiLog(400),
    ]);
    const all = [...open, ...ok, ...no].filter((p) => p.createdAt >= now - 30 * DAY);
    // A proposal counts only where every source its title could show is readable (as Insights does).
    const [readable] = await readableMany(c, [
      {
        w: { view: b.view, personal: false, stub: b.stub },
        ids: all.flatMap((p) => p.titleSources),
      },
    ]);
    const visible = all.filter((p) => p.titleSources.every((i) => readable?.has(i)));
    const decisionAt = new Map<string, { at: number; actor: string }>();
    for (const e of log) {
      const m = /\.(approval|rejected)$/.exec(e.kind);
      const id = safeJson(e.detail).id;
      if (!m || typeof id !== "string") continue;
      const det = safeJson(e.detail);
      // An approval that is not the last needed one does not close the proposal.
      if (m[1] === "approval" && Number(det.approvals) < Number(det.required)) continue;
      if (!decisionAt.has(id)) decisionAt.set(id, { at: e.at, actor: e.actor });
    }
    for (const p of visible) {
      proposals.push({ id: p.id, status: p.status, createdAt: p.createdAt });
      const dec = decisionAt.get(p.id);
      if (p.status !== "candidate" && dec) {
        decided.push({ createdAt: p.createdAt, decidedAt: dec.at });
        if (
          p.status === "approved" &&
          dec.at >= now - 7 * DAY &&
          !humanIds.has(dec.actor) &&
          fyi.length < FYI_MAX * 3
        )
          fyi.push({
            id: p.id,
            title: p.title,
            brainId: b.param,
            brainName: b.label,
            decidedAt: new Date(dec.at).toISOString(),
            by: dec.actor,
            status: p.status,
          });
      }
    }
  }
  return {
    proposals,
    decided,
    fyi: fyi.sort((a, z) => z.decidedAt.localeCompare(a.decidedAt)).slice(0, FYI_MAX),
  };
}

/** The queue the caller sees, as rows. One call to the questions source, then per-brain state. */
async function deskRows(
  c: C,
): Promise<{ qs: Question[]; rows: Row[]; ctxs: Map<string, Ctx>; humanIds: Set<string> }> {
  const humanIds = new Set(await humanIdsOf(c.env, sess(c)));
  const qs = await questionsOf(c);
  const ctxs = await ctxFor(
    c,
    qs.map((q) => q.workspaceId),
  );
  return { qs, rows: qs.map((q) => rowOf(c, q, ctxs.get(q.workspaceId) as Ctx)), ctxs, humanIds };
}

async function findQuestion(c: C, id: string): Promise<{ q: Question; x: Ctx; row: Row }> {
  if (!ID.test(id)) throw notFound();
  const { qs, rows, ctxs } = await deskRows(c);
  const row = rows.find((r) => r.id === id);
  const q = qs.find((z) => z.id === id);
  if (!row || !q) throw notFound();
  return { q, x: ctxs.get(row.brain.id) as Ctx, row };
}

const refuseOwn = (id: string): boolean => id.startsWith("ask:");

/** The caller's person key for a write, or the 503 that says the secret is not configured. */
async function myKey(c: C): Promise<string | Response> {
  try {
    return await keyOf(c.env, sess(c).tenantId, sess(c).principal.id);
  } catch (e) {
    if (e instanceof KeyUnavailable) return c.json({ error: "pseudonym_key_missing" }, 503);
    throw e;
  }
}

export function reviewRoutes(_deps: AppDeps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  // The desk: sections, the 14-day strip and the KPIs.
  r.get("/review-desk", async (c) => {
    const s = sess(c);
    const now = s.ctx.now;
    const { rows, ctxs, humanIds } = await deskRows(c);
    const hist = await history(c, ctxs, humanIds);
    const sections: Record<Section, Row[]> = {
      decision: [],
      contradictions: [],
      mentions: [],
      fyi: [],
      snoozed: [],
    };
    for (const row of rows) sections[row.section].push(row);
    for (const k of Object.keys(sections) as Section[]) sections[k].sort(byPriority);
    const open = rows.filter((x) => x.section !== "snoozed");
    c.header("Cache-Control", "no-store");
    return c.json({
      generatedAt: new Date(now).toISOString(),
      sections: {
        decision: sections.decision,
        contradictions: sections.contradictions,
        mentions: sections.mentions,
        fyi: hist.fyi,
        snoozed: sections.snoozed,
      },
      counts: {
        decision: sections.decision.length,
        contradictions: sections.contradictions.length,
        mentions: sections.mentions.length,
        fyi: hist.fyi.length,
        snoozed: sections.snoozed.length,
        waiting: open.length,
      },
      strip: stripOf(hist.proposals, now),
      kpis: kpisOf({
        waiting: open.length,
        overdue: open.filter((x) => x.age.state === "overdue").length,
        decided: hist.decided,
        nowMs: now,
      }),
      slaDefaultDays: DEFAULT_SLA_DAYS,
    });
  });

  // One item: summary, risk panel, context, discussion, who can take it.
  r.get("/review-desk/:id", async (c) => {
    const id = c.req.param("id");
    const { q, x, row } = await findQuestion(c, id);
    const s = sess(c);
    const me = s.principal.id;
    const stub = x.brain?.stub;
    let context: {
      pageTitle: string | null;
      current: string | null;
      facts: { id: number; subject: string; predicate: string; object: string }[];
      hiddenFacts: number;
    } = { pageTitle: null, current: null, facts: [], hiddenFacts: 0 };
    if (stub && dOf(q).pages?.length) {
      const first = dOf(q).pages?.[0];
      const current = (dOf(q).pages ?? [])
        .map((p) =>
          p.diff
            .filter((l) => l.type !== "add")
            .map((l) => l.text.replace(/\{src:[^}]+\}/g, "").trimEnd())
            .join("\n"),
        )
        .join("\n\n")
        .trim();
      context = {
        pageTitle: first?.title ?? null,
        current: current ? current.slice(0, CONTEXT_CHARS) : null,
        facts: [],
        hiddenFacts: 0,
      };
      if (!id.startsWith("ask:")) {
        const pv = await stub.wikiProposalView(id);
        if (pv?.invalidate.length) {
          const [ok] = await readableMany(c, [
            {
              w: { view: x.brain?.view ?? viewOf(s), personal: !!x.brain?.personal, stub },
              ids: pv.invalidate.flatMap((f) => f.sourceIds),
            },
          ]);
          for (const f of pv.invalidate) {
            if (f.sourceIds.every((i) => ok?.has(i)))
              context.facts.push({
                id: f.factId,
                subject: f.subject,
                predicate: f.predicate,
                object: f.object,
              });
            else context.hiddenFacts++;
          }
        }
      }
    }
    const comments = stub && !refuseOwn(id) ? await stub.comments(id, COMMENTS_SHOWN) : [];
    const people =
      x.brain && !x.brain.personal && !refuseOwn(id)
        ? await eligiblePeople(
            c,
            { nodeId: x.brain.nodeId, stub: x.brain.stub },
            { actions: ["review", "approve_release"], role: "review" },
            dOf(q).authorId ? [dOf(q).authorId as string] : [],
          )
        : [];
    const names = new Map(people.map((p) => [p.id, p]));
    const assignee = (
      await keyed(
        c.env,
        s.tenantId,
        people.map((p) => p.id),
      ).catch(() => null)
    )?.idOf(x.states.get(id)?.assignedTo);
    return c.json({
      id,
      summary: row.summary,
      risk: row.risk_detail,
      context,
      comments: comments
        .slice()
        .reverse()
        .map((m) => ({
          id: m.id,
          authorId: m.authorId,
          name: names.get(m.authorId)?.name ?? null,
          text: m.text,
          at: new Date(m.at).toISOString(),
          mine: m.authorId === me,
          mentions: mentionsIn(m.text),
        })),
      eligible: people.map((p) => ({ id: p.id, name: p.name, handle: p.handle })),
      state: {
        snoozedUntil: row.snoozedUntil,
        assignedTo: assignee ? { id: assignee, name: names.get(assignee)?.name ?? null } : null,
        waitingOnAuthor: row.waitingOnAuthor,
      },
      slaDays: x.sla,
    });
  });

  // A comment. Personal-data wording warns first and posts only when the person confirms (R-110).
  r.post("/review-desk/:id/comments", async (c) => {
    const id = c.req.param("id");
    const body = await readObject(c);
    const t = text(body.text, 1, COMMENT_MAX, "invalid_text");
    if (body.acknowledged !== undefined && typeof body.acknowledged !== "boolean")
      throw bad("invalid_acknowledged");
    if (refuseOwn(id)) throw notFound();
    const limited = await rateLimit(c, "review_write", 30);
    if (limited) return limited;
    const { q, x } = await findQuestion(c, id);
    if (!x.brain) throw notFound();
    const flags = detectSensitivity({ body: t });
    if (flags.length && body.acknowledged !== true)
      return c.json(
        {
          error: "personal_data_warning",
          reason: "This comment looks like it holds personal data. Remove it, or confirm to post.",
          kinds: [...new Set(flags.map((f) => f.type))],
        },
        409,
      );
    const s = sess(c);
    const me = s.principal.id;
    const people = await eligiblePeople(
      c,
      { nodeId: x.brain.nodeId, stub: x.brain.stub },
      { actions: ["review", "approve_release"], role: "review" },
      dOf(q).authorId ? [dOf(q).authorId as string] : [],
    );
    const handles = mentionsIn(t);
    const hit = people.filter((p) => handles.includes(p.handle) && p.id !== me);
    const mine = await myKey(c);
    if (mine instanceof Response) return mine;
    const hitKeys = await keyed(
      c.env,
      s.tenantId,
      hit.map((p) => p.id),
    );
    const unresolved = handles.filter((h) => !people.some((p) => p.handle === h));
    if (
      !(await audit(c, {
        action: "review.comment",
        nodeId: id,
        scopeId: x.brain.scope,
        revision: null,
        reason: `mentions:${hit.length}${flags.length ? ",personal_data_confirmed" : ""}`,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    const m = await x.brain.stub.comment(id, me, t, s.ctx.now);
    const st = await readState(x.brain.stub, id);
    st.answered[mine] = s.ctx.now;
    for (const p of hit) st.mentions[hitKeys.of(p.id)] = s.ctx.now;
    await writeState(x.brain.stub, id, st, x.brain.plane, s.ctx.now);
    await notify(
      c,
      hit.map((p) => p.id),
      "review_mention",
      `You were mentioned on a proposal in ${x.brain.label}`,
      id,
    );
    return c.json(
      {
        ok: true,
        comment: { id: m.id, at: new Date(m.at).toISOString() },
        mentioned: hit.map((p) => p.id),
        unresolved,
      },
      201,
    );
  });

  // Snooze for this person only, until a date. `until: null` brings it back.
  r.post("/review-desk/:id/snooze", async (c) => {
    const id = c.req.param("id");
    const body = await readObject(c);
    const s = sess(c);
    let until: number | null = null;
    if (body.until !== null) {
      if (typeof body.until !== "string") throw bad("invalid_until");
      until = Date.parse(body.until);
      if (
        !Number.isFinite(until) ||
        until <= s.ctx.now ||
        until > s.ctx.now + SNOOZE_MAX_DAYS * DAY
      )
        throw bad("invalid_until");
    }
    const limited = await rateLimit(c, "review_write", 30);
    if (limited) return limited;
    const mine = await myKey(c);
    if (mine instanceof Response) return mine;
    const { x } = await findQuestion(c, id);
    if (!x.brain) throw notFound();
    if (
      !(await audit(c, {
        action: until === null ? "review.unsnooze" : "review.snooze",
        nodeId: id,
        scopeId: x.brain.scope,
        revision: null,
        reason: until === null ? "owner" : `until:${new Date(until).toISOString().slice(0, 10)}`,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    const st = await readState(x.brain.stub, id);
    if (until === null) delete st.snooze[mine];
    else st.snooze[mine] = until;
    await writeState(x.brain.stub, id, st, x.brain.plane, s.ctx.now);
    return c.json({
      ok: true,
      snoozedUntil: until === null ? null : new Date(until).toISOString(),
    });
  });

  // Reassign to an eligible reviewer only: the directory, the policy and the stored brain role decide.
  r.post("/review-desk/:id/reassign", async (c) => {
    const id = c.req.param("id");
    const body = await readObject(c);
    if (body.to !== null && typeof body.to !== "string") throw bad("invalid_to");
    if (refuseOwn(id)) throw notFound();
    const limited = await rateLimit(c, "review_write", 30);
    if (limited) return limited;
    const { q, x } = await findQuestion(c, id);
    if (!x.brain || x.brain.personal) throw notFound();
    const s = sess(c);
    const people: Person[] = await eligiblePeople(
      c,
      { nodeId: x.brain.nodeId, stub: x.brain.stub },
      { actions: ["review", "approve_release"], role: "review" },
      dOf(q).authorId ? [dOf(q).authorId as string] : [],
    );
    const to = body.to as string | null;
    if (to !== null && !people.some((p) => p.id === to))
      return forbidden(c, "That person cannot review this brain, so the item cannot go to them");
    const mine = await myKey(c);
    if (mine instanceof Response) return mine;
    const toKey = to === null ? null : await keyOf(c.env, s.tenantId, to);
    if (
      !(await audit(c, {
        action: to === null ? "review.unassign" : "review.reassign",
        nodeId: id,
        scopeId: x.brain.scope,
        revision: null,
        reason: to === null ? "owner" : `to:${to}`,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    const st = await readState(x.brain.stub, id);
    st.assignedTo = toKey;
    st.assignedBy = to === null ? null : mine;
    st.assignedAt = to === null ? null : s.ctx.now;
    await writeState(x.brain.stub, id, st, x.brain.plane, s.ctx.now);
    if (to)
      await notify(
        c,
        [to],
        "review_assigned",
        `A proposal in ${x.brain.label} was assigned to you`,
        id,
      );
    return c.json({ ok: true, assignedTo: to });
  });

  // Request changes with a note. A contribution candidate uses the questions rule it always had; a
  // wiki proposal stays open, waits on its author and comes back when the author changes it.
  r.post("/review-desk/:id/request-changes", async (c) => {
    const id = c.req.param("id");
    const body = await readObject(c);
    const note = text(body.note, 1, COMMENT_MAX, "invalid_note");
    if (typeof body.revisionHash !== "string" || body.revisionHash.length > 128)
      throw bad("invalid_revision_hash");
    if (refuseOwn(id)) throw notFound();
    const { q, x } = await findQuestion(c, id);
    if (!x.brain) throw notFound();
    const flags = detectSensitivity({ body: note });
    if (flags.length && body.acknowledged !== true)
      return c.json(
        {
          error: "personal_data_warning",
          reason: "This note looks like it holds personal data. Remove it, or confirm to send.",
          kinds: [...new Set(flags.map((f) => f.type))],
        },
        409,
      );
    if (q.kind === "contradiction" || q.kind === "ingest")
      return c.json(
        { error: "not_available", reason: "Changes cannot be requested on this item" },
        409,
      );
    // A contribution candidate (no page diff) keeps the questions rule: revisionHash, role, audit.
    if (!dOf(q).pages)
      return resolveQuestion(c, id, {
        action: "request_changes",
        revisionHash: body.revisionHash,
        note,
      });
    if (body.revisionHash !== dOf(q).revisionHash)
      return c.json(
        { error: "revision_conflict", reason: "The proposal changed since you read it. Reload it" },
        409,
      );
    const s = sess(c);
    const mine = await myKey(c);
    if (mine instanceof Response) return mine;
    if (
      !(await audit(c, {
        action: "review.request_changes",
        nodeId: id,
        scopeId: x.brain.scope,
        revision: null,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    await x.brain.stub.comment(id, s.principal.id, note, s.ctx.now);
    const st = await readState(x.brain.stub, id);
    st.changes = { at: s.ctx.now, by: mine, hash: body.revisionHash };
    st.answered[mine] = s.ctx.now;
    await writeState(x.brain.stub, id, st, x.brain.plane, s.ctx.now);
    await notifyChangesRequested(c, x.brain.nodeId, id, dOf(q).authorId ?? null);
    return c.json({ ok: true });
  });

  // The review SLA of a brain: readers see it (Members and access shows it), a manager sets it.
  r.get("/brains/:id/review-sla", async (c) => {
    const b = await needBrain(c, c.req.param("id"), "read");
    if (b instanceof Response) return b;
    if (b.personal) throw notFound();
    return c.json({
      days: await readSla(b.stub),
      defaultDays: DEFAULT_SLA_DAYS,
      min: SLA_MIN_DAYS,
      max: SLA_MAX_DAYS,
      canSet: b.can.manage,
    });
  });

  r.put("/brains/:id/review-sla", async (c) => {
    const b = await needBrain(c, c.req.param("id"), "manage");
    if (b instanceof Response) return b;
    if (b.personal) throw notFound();
    const body = await readObject(c);
    const days = body.days;
    if (
      typeof days !== "number" ||
      !Number.isInteger(days) ||
      days < SLA_MIN_DAYS ||
      days > SLA_MAX_DAYS
    )
      throw bad("invalid_days");
    const s = sess(c);
    if (
      !(await audit(c, {
        action: "review.sla",
        nodeId: b.nodeId,
        scopeId: b.scope,
        revision: null,
        reason: `days:${days}`,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    await writeSla(b.stub, days, b.plane, s.ctx.now);
    return c.json({
      days,
      defaultDays: DEFAULT_SLA_DAYS,
      min: SLA_MIN_DAYS,
      max: SLA_MAX_DAYS,
      canSet: true,
    });
  });

  return r;
}
