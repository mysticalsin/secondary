// Brain > Gaps API (docs/DESIGN-V8-AMAZING.md section 2): ranked gaps, assign with a due date, start a
// page (a draft in review), merge, dismiss with a reason, the steward KPI, and the Home top gaps.
// Reading needs the contribute right in the brain. Assign, merge and dismiss are for stewards (the
// right to decide or manage). Starting a page needs only contribute and lands as a proposal in review.

import { Hono } from "hono";
import { admittedBrainParams, type Brain, brainOf, needBrain } from "../brains/open.ts";
import { rateLimit } from "../brains/shared.ts";
import { humanIdsOf } from "../human.ts";
import { eligiblePeople, notify, type Person } from "../review/eligible.ts";
import { detectSensitivity } from "../sensitivity.ts";
import type { AppDeps, AppEnv } from "../types.ts";
import { audit, bad, type C, forbidden, notFound, readObject, sess } from "../ux/util.ts";
import { GENERATED, PAGE_ID, slug } from "../wiki/text.ts";
import {
  closureRate,
  DAY,
  DAYS_SHOWN,
  DISMISS_REASONS,
  type DismissReason,
  DUE_MAX_DAYS,
  dayOf,
  daysOf,
  scoreOf,
  titleOf,
} from "./model.ts";
import { type Gap, getGap, listGaps, putGap } from "./store.ts";

const ACTIVE = new Set(["open", "assigned", "drafted"]);
const KPI_DAYS = 90;
const TOP_MAX = 20;

const steward = (b: Brain): boolean => b.can.manage || b.can.decide;

const idOf = (c: C): string => c.req.param("gid") ?? "";

function out(g: Gap, now: number, names: Map<string, Person>) {
  return {
    id: g.id,
    text: g.text,
    count: g.count,
    askers: g.askerHashes.length,
    byRole: g.byRole,
    bySource: g.bySource,
    days: daysOf(g.days, now, DAYS_SHOWN),
    firstAt: new Date(g.firstAt).toISOString(),
    lastAt: new Date(g.lastAt).toISOString(),
    score: scoreOf({ count: g.count, askers: g.askerHashes.length, lastAt: g.lastAt }, now),
    status: g.status,
    assignedTo: g.assignedTo
      ? { id: g.assignedTo, name: names.get(g.assignedTo)?.name ?? null }
      : null,
    due: g.due,
    overdue: !!g.due && g.due < dayOf(now) && ACTIVE.has(g.status),
    proposalId: g.proposalId,
    pageId: g.pageId,
    dismissedReason: g.dismissedReason,
    mergedFrom: g.mergedFrom,
    reopened: g.reopened,
  };
}

/**
 * Settle a gap whose draft has been decided: published means closed, rejected means it needs a new
 * attempt. Written back so the next read is cheap.
 */
async function settle(b: Brain, gaps: Gap[], now: number, actor: string): Promise<Gap[]> {
  const next: Gap[] = [];
  for (const g of gaps) {
    if (g.status === "drafted" && g.proposalId) {
      const p = await b.stub.get(g.proposalId);
      if (p && (p.status === "approved" || p.status === "rejected")) {
        const done: Gap =
          p.status === "approved"
            ? { ...g, status: "closed", closedAt: p.updatedAt }
            : { ...g, status: "open", proposalId: null, pageId: null };
        await putGap(b.stub, done, actor, b.plane, now);
        next.push(done);
        continue;
      }
    }
    next.push(g);
  }
  return next;
}

function kpiOf(gaps: Gap[], now: number) {
  const recent = gaps.filter((g) => g.firstAt >= now - KPI_DAYS * DAY && g.status !== "merged");
  const count = (s: string) => recent.filter((g) => g.status === s).length;
  return {
    windowDays: KPI_DAYS,
    closureRate: closureRate(recent.map((g) => g.status)),
    open: count("open"),
    assigned: count("assigned"),
    drafted: count("drafted"),
    closed: count("closed"),
    dismissed: count("dismissed"),
    overdue: recent.filter((g) => !!g.due && g.due < dayOf(now) && ACTIVE.has(g.status)).length,
  };
}

const contributors = (b: Brain, c: C): Promise<Person[]> =>
  eligiblePeople(
    c,
    { nodeId: b.nodeId, stub: b.stub },
    { actions: ["contribute"], role: "contribute" },
    [],
  );

async function need(c: C, level: "contribute" | "steward"): Promise<Brain | Response> {
  const b = await needBrain(c, c.req.param("id") ?? "", "contribute");
  if (b instanceof Response) return b;
  if (b.personal) throw notFound();
  if (level === "steward" && !steward(b))
    return forbidden(c, "Only a steward of this brain can do this");
  return b;
}

export function gapRoutes(_deps: AppDeps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get("/brains/:id/gaps", async (c) => {
    const b = await need(c, "contribute");
    if (b instanceof Response) return b;
    const s = sess(c);
    const status = c.req.query("status") ?? "active";
    if (!["active", "closed", "dismissed", "all"].includes(status)) throw bad("invalid_status");
    const all = await settle(b, await listGaps(b.stub), s.ctx.now, s.principal.id);
    const people = steward(b) ? await contributors(b, c) : [];
    const names = new Map(people.map((p) => [p.id, p]));
    const shown = all
      .filter((g) =>
        status === "all"
          ? g.status !== "merged"
          : status === "active"
            ? ACTIVE.has(g.status)
            : g.status === status,
      )
      .map((g) => out(g, s.ctx.now, names))
      .sort(
        (a, z) => z.score - a.score || z.lastAt.localeCompare(a.lastAt) || a.id.localeCompare(z.id),
      );
    c.header("Cache-Control", "no-store");
    return c.json({
      brain: { id: b.param, name: b.label },
      canSteward: steward(b),
      gaps: shown,
      kpi: kpiOf(all, s.ctx.now),
      eligible: people.map((p) => ({ id: p.id, name: p.name })),
    });
  });

  r.post("/brains/:id/gaps/:gid/assign", async (c) => {
    const b = await need(c, "steward");
    if (b instanceof Response) return b;
    const body = await readObject(c);
    const s = sess(c);
    if (typeof body.to !== "string") throw bad("invalid_to");
    const due = body.due;
    if (
      typeof due !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(due) ||
      Number.isNaN(Date.parse(due))
    )
      throw bad("invalid_due");
    if (due < dayOf(s.ctx.now) || Date.parse(due) > s.ctx.now + DUE_MAX_DAYS * DAY)
      throw bad("invalid_due");
    const g = await getGap(b.stub, idOf(c));
    if (!g || g.status === "merged" || g.status === "dismissed") throw notFound();
    const people = await contributors(b, c);
    if (!people.some((p) => p.id === body.to))
      return forbidden(
        c,
        "That person cannot contribute to this brain, so the gap cannot go to them",
      );
    if (
      !(await audit(c, {
        action: "gap.assign",
        nodeId: b.nodeId,
        scopeId: b.scope,
        revision: null,
        reason: `to:${body.to},due:${due}`,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    const next: Gap = {
      ...g,
      assignedTo: body.to,
      assignedBy: s.principal.id,
      due,
      status: g.status === "drafted" || g.status === "closed" ? g.status : "assigned",
    };
    await putGap(b.stub, next, s.principal.id, b.plane, s.ctx.now);
    await notify(
      c,
      [body.to],
      "gap_assigned",
      `A knowledge gap in ${b.label} was assigned to you`,
      `gap:${b.param}`,
    );
    return c.json({ ok: true, gap: out(next, s.ctx.now, new Map(people.map((p) => [p.id, p]))) });
  });

  // Start a page from a gap: the title is pre-filled and the draft goes to review, never published.
  r.post("/brains/:id/gaps/:gid/start", async (c) => {
    const b = await need(c, "contribute");
    if (b instanceof Response) return b;
    const s = sess(c);
    const body = await readObject(c);
    const g = await getGap(b.stub, idOf(c));
    if (!g || g.status === "merged" || g.status === "dismissed") throw notFound();
    if (g.status === "drafted" && g.proposalId)
      return c.json({ error: "already_started", proposalId: g.proposalId, pageId: g.pageId }, 409);
    const title =
      typeof body.title === "string" && body.title.trim()
        ? body.title.trim().slice(0, 120)
        : titleOf(g.text);
    if (detectSensitivity({ title }).length) throw bad("invalid_title");
    const schema = await b.stub.wikiSchema();
    const usable = Object.keys(schema.types).filter(
      (k) => !GENERATED[k] && k !== "journal" && k !== "session_report",
    );
    const wanted =
      typeof body.type === "string" ? body.type : usable.includes("topic") ? "topic" : usable[0];
    if (!wanted || !usable.includes(wanted)) throw bad("invalid_type");
    const pageId = slug(title);
    if (!PAGE_ID.test(pageId)) throw bad("invalid_title");
    if (await b.stub.wikiPage(pageId))
      return c.json(
        { error: "page_exists", reason: "A page with this title already exists. Edit it instead." },
        409,
      );
    const raw = Number.parseInt(c.env.WIKI_WRITE_PER_MIN ?? "", 10);
    const refused = await rateLimit(c, "wiki_write", Number.isFinite(raw) && raw > 0 ? raw : 30);
    if (refused) return refused;
    if (
      !(await audit(c, {
        action: "gap.start",
        nodeId: b.nodeId,
        scopeId: b.scope,
        revision: null,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    const made = await b.stub.wikiPropose(
      {
        kind: "wiki_ingest",
        title: `New page: ${title}`,
        rationale: "started from a knowledge gap",
        origin: "human",
        pages: [
          {
            pageId,
            type: wanted,
            title,
            baseRevision: null,
            markdown: `# ${title}\n\nDraft started from a knowledge gap. Write the answer here and cite your sources.\n`,
          },
        ],
        facts: [],
        invalidate: [],
        confirm: [],
        archive: [],
        reingest: [],
        sources: [],
        findingKey: null,
      },
      s.principal.id,
      s.ctx.now,
      { plane: b.plane, readable: [] },
    );
    if (!made.ok)
      return c.json(
        { error: made.code, reason: made.message },
        made.code === "not_found" ? 404 : 409,
      );
    if (!made.created) return c.json({ error: "nothing_to_propose", reason: made.reason }, 422);
    await putGap(
      b.stub,
      { ...g, status: "drafted", proposalId: made.id, pageId },
      s.principal.id,
      b.plane,
      s.ctx.now,
    );
    return c.json({ ok: true, proposalId: made.id, pageId, title, status: "candidate" }, 201);
  });

  r.post("/brains/:id/gaps/:gid/merge", async (c) => {
    const b = await need(c, "steward");
    if (b instanceof Response) return b;
    const s = sess(c);
    const body = await readObject(c);
    if (typeof body.into !== "string") throw bad("invalid_into");
    if (body.into === idOf(c)) throw bad("invalid_into");
    const [from, into] = await Promise.all([getGap(b.stub, idOf(c)), getGap(b.stub, body.into)]);
    if (
      !from ||
      !into ||
      from.status === "merged" ||
      into.status === "merged" ||
      into.status === "dismissed"
    )
      throw notFound();
    if (
      !(await audit(c, {
        action: "gap.merge",
        nodeId: b.nodeId,
        scopeId: b.scope,
        revision: null,
        reason: `into:${into.id}`,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    const add = (a: Record<string, number>, z: Record<string, number>) => {
      const o = { ...a };
      for (const [k, v] of Object.entries(z)) o[k] = (o[k] ?? 0) + v;
      return o;
    };
    const merged: Gap = {
      ...into,
      count: into.count + from.count,
      askerHashes: [...new Set([...into.askerHashes, ...from.askerHashes])],
      byRole: add(into.byRole, from.byRole),
      bySource: add(into.bySource, from.bySource) as Gap["bySource"],
      days: add(into.days, from.days),
      firstAt: Math.min(into.firstAt, from.firstAt),
      lastAt: Math.max(into.lastAt, from.lastAt),
      mergedFrom: into.mergedFrom + 1 + from.mergedFrom,
    };
    await putGap(b.stub, merged, s.principal.id, b.plane, s.ctx.now);
    // The old record keeps no counts of its own, only where it went, so later asks follow it.
    await putGap(
      b.stub,
      { ...from, status: "merged", mergedInto: into.id, assignedTo: null, due: null },
      s.principal.id,
      b.plane,
      s.ctx.now,
    );
    return c.json({ ok: true, gap: out(merged, s.ctx.now, new Map()) });
  });

  r.post("/brains/:id/gaps/:gid/dismiss", async (c) => {
    const b = await need(c, "steward");
    if (b instanceof Response) return b;
    const s = sess(c);
    const body = await readObject(c);
    if (
      typeof body.reason !== "string" ||
      !(DISMISS_REASONS as readonly string[]).includes(body.reason)
    )
      throw bad("invalid_reason");
    let note: string | null = null;
    if (body.note !== undefined && body.note !== null) {
      if (typeof body.note !== "string" || body.note.length > 200) throw bad("invalid_note");
      note = body.note.trim() || null;
      if (note && detectSensitivity({ body: note }).length) throw bad("personal_data_in_note");
    }
    const g = await getGap(b.stub, idOf(c));
    if (!g || g.status === "merged") throw notFound();
    if (
      !(await audit(c, {
        action: "gap.dismiss",
        nodeId: b.nodeId,
        scopeId: b.scope,
        revision: null,
        reason: `reason:${body.reason}`,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    const next: Gap = {
      ...g,
      status: "dismissed",
      dismissedReason: body.reason as DismissReason,
      dismissedNote: note,
    };
    await putGap(b.stub, next, s.principal.id, b.plane, s.ctx.now);
    return c.json({ ok: true, gap: out(next, s.ctx.now, new Map()) });
  });

  // Home: the top gaps across the brains the caller stewards, and their closure rate.
  r.get("/gaps/top", async (c) => {
    const s = sess(c);
    const limit = Math.min(
      TOP_MAX,
      Math.max(1, Number.parseInt(c.req.query("limit") ?? "5", 10) || 5),
    );
    const human = await humanIdsOf(c.env, s);
    const rows: (ReturnType<typeof out> & { brainId: string; brainName: string })[] = [];
    const all: Gap[] = [];
    for (const p of admittedBrainParams(c)) {
      if (p.param === "me") continue;
      const b = await brainOf(c, p.param, human);
      if (!b || b.personal || !steward(b)) continue;
      const gaps = await settle(b, await listGaps(b.stub), s.ctx.now, s.principal.id);
      all.push(...gaps);
      for (const g of gaps)
        if (ACTIVE.has(g.status))
          rows.push({ ...out(g, s.ctx.now, new Map()), brainId: b.param, brainName: b.label });
    }
    rows.sort((a, z) => z.score - a.score || a.id.localeCompare(z.id));
    c.header("Cache-Control", "no-store");
    return c.json({
      gaps: rows.slice(0, limit),
      kpi: kpiOf(all, s.ctx.now),
      stewards: rows.length > 0 || all.length > 0,
    });
  });

  return r;
}
