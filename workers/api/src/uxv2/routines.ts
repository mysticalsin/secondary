// Routines: a person's own ingestion jobs. A routine is owned by the person who made it and lives in
// their Personal Brain workspace (so erasure, export and snapshots already cover it). Each run reads
// candidates from the routine's source (only what the owner can read), classifies each one (ingest,
// skip or ask), and writes only into a scope the owner may contribute to, checked again at every run.
//
// What "ingest" writes: into the owner's Personal Brain, a note (which the wiki then ingests); into a
// shared scope, a contribution candidate that waits for review like any other (never a direct write).
// What "ask" writes: one question for the owner, with the text stored without personal passages.

import { canDoInView, isPersonalKind, opensBrain } from "@secondary/policy";
import { Hono } from "hono";
import { contractGate, gate } from "../ai/brief.ts";
import { doBudget, withUserCap } from "../ai/budget.ts";
import { excludePersonalSegments } from "../ai/segments.ts";
import { viewOf } from "../auth.ts";
import { checkSourceAccess } from "../connector.ts";
import { ruleGate } from "../rules/gate.ts";
import { candidateId, personalScope, scopeOfNode } from "../scope.ts";
import { detectSensitivity } from "../sensitivity.ts";
import { tenantStub } from "../stubs.ts";
import type { AppDeps, AppEnv } from "../types.ts";
import { notifyContributed } from "../ux/notify.ts";
import {
  audit,
  bad,
  type C,
  forbidden,
  MAX_BODY_TEXT,
  NODE_ID,
  notFound,
  readObject,
  sess,
  text,
} from "../ux/util.ts";
import { wikiNotify } from "../wiki/hooks.ts";
import { cleanText, matchOfTokens, sha256Hex, tokensOf } from "../wiki/text.ts";
import type { ItemRecord } from "../workspace.ts";
import { type Candidate, classify, refine, stricter, type Verdict } from "./classifier.ts";
import { metered, recordUsage } from "./ledger.ts";
import { hex, iso, resolveTarget, safeJson, stubOf, type Target } from "./shared.ts";

export const ROUTINE_KIND = "u2_routine";
export const STATE_KIND = "u2_rstate";
export const RUN_KIND = "u2_run";
export const ASK_KIND = "u2_ask";

const SOURCE_KINDS = ["sharepoint", "meetings", "notes", "manual"] as const;
const SCHEDULES = ["daily", "weekly", "manual"] as const;
const ROUTINE_ID = /^rt:[0-9a-f]{8}$/;
const MAX_ROUTINES = 20;
const MAX_ITEMS_PER_RUN = 20;
const MAX_RUNS_KEPT = 50;
const MAX_SEEN = 500;
const RUNS_PER_MIN = 10;

export type Routine = {
  id: string;
  name: string;
  source: { kind: (typeof SOURCE_KINDS)[number]; ref?: string };
  schedule: (typeof SCHEDULES)[number];
  targetScopeId: string;
  guardrails: { excludePersonal: true; excludeHR: true; excludeNewsletters: boolean };
  enabled: boolean;
};

export type RunItem = { title: string; verdict: Verdict; reason: string };
export type Run = {
  id: string;
  at: string;
  ingested: number;
  skipped: number;
  asked: number;
  tokens: number;
  items: RunItem[];
};

const mine = (c: C) => stubOf(c, personalScope(sess(c).principal.id));

function routineOf(r: ItemRecord): Routine | null {
  if (r.kind !== ROUTINE_KIND) return null;
  const b = safeJson(r.body);
  const src = (b.source ?? {}) as Record<string, unknown>;
  const g = (b.guardrails ?? {}) as Record<string, unknown>;
  if (
    !SOURCE_KINDS.includes(src.kind as never) ||
    !SCHEDULES.includes(b.schedule as never) ||
    typeof b.targetScopeId !== "string"
  )
    return null;
  return {
    id: r.id,
    name: r.label,
    source: {
      kind: src.kind as Routine["source"]["kind"],
      ...(typeof src.ref === "string" && src.ref ? { ref: src.ref } : {}),
    },
    schedule: b.schedule as Routine["schedule"],
    targetScopeId: b.targetScopeId,
    guardrails: {
      excludePersonal: true,
      excludeHR: true,
      excludeNewsletters: g.excludeNewsletters !== false,
    },
    enabled: b.enabled !== false,
  };
}

const bodyOf = (r: Omit<Routine, "id" | "name">): string =>
  JSON.stringify({
    source: r.source,
    schedule: r.schedule,
    targetScopeId: r.targetScopeId,
    guardrails: r.guardrails,
    enabled: r.enabled,
  });

async function loadRoutine(c: C): Promise<Routine> {
  const id = c.req.param("id") ?? "";
  if (!ROUTINE_ID.test(id)) throw notFound();
  const rec = await mine(c).get(id);
  const r = rec ? routineOf(rec) : null;
  if (!r) throw notFound();
  return r;
}

/** The target a routine may write to, or the refusal: absent for what the view does not reach. */
function targetFor(c: C, param: string): { t: Target } | { res: Response } {
  const t = resolveTarget(c, param, "contribute");
  if (t) return { t };
  const s = sess(c);
  const vn = NODE_ID.test(param) ? viewOf(s).nodes.get(param) : undefined;
  if (!vn || isPersonalKind(vn.kind)) return { res: c.json({ error: "not_found" }, 404) };
  const d = canDoInView(viewOf(s), s.principal, vn.id, "contribute");
  return {
    res: forbidden(c, d.allowed ? "A routine cannot write to this kind of scope" : d.reason),
  };
}

function readSource(c: C, v: unknown): Routine["source"] {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw bad("invalid_source");
  const o = v as Record<string, unknown>;
  if (!SOURCE_KINDS.includes(o.kind as never)) throw bad("invalid_source");
  const kind = o.kind as Routine["source"]["kind"];
  const ref = o.ref === undefined || o.ref === null || o.ref === "" ? undefined : o.ref;
  if (ref !== undefined && (typeof ref !== "string" || ref.length > 200))
    throw bad("invalid_source");
  if (kind === "notes" && ref !== undefined) throw bad("invalid_source");
  // A meetings routine reads one workspace, and only one the owner can read.
  if (kind === "meetings") {
    if (typeof ref !== "string" || !resolveTarget(c, ref, "read")) throw bad("invalid_source");
  }
  return { kind, ...(typeof ref === "string" ? { ref } : {}) };
}

function readGuardrails(v: unknown): Routine["guardrails"] {
  if (v === undefined) return { excludePersonal: true, excludeHR: true, excludeNewsletters: true };
  if (!v || typeof v !== "object" || Array.isArray(v)) throw bad("invalid_guardrails");
  const o = v as Record<string, unknown>;
  // Personal and HR content stay out of every routine: they cannot be switched off.
  if (o.excludePersonal !== undefined && o.excludePersonal !== true)
    throw bad("guardrail_required");
  if (o.excludeHR !== undefined && o.excludeHR !== true) throw bad("guardrail_required");
  if (o.excludeNewsletters !== undefined && typeof o.excludeNewsletters !== "boolean")
    throw bad("invalid_guardrails");
  return {
    excludePersonal: true,
    excludeHR: true,
    excludeNewsletters: o.excludeNewsletters !== false,
  };
}

/** The run's candidates, from the routine's source and only what this person may read. */
async function collect(
  c: C,
  routine: Routine,
  manual: unknown,
): Promise<{ items: (Candidate & { account?: string })[] } | { error: string }> {
  const s = sess(c);
  const view = viewOf(s);
  const accountOf = (nodeId: string): string | undefined => {
    const n = view.nodes.get(nodeId);
    return n?.kind === "account" ? n.id : n?.account;
  };
  switch (routine.source.kind) {
    case "manual": {
      if (!Array.isArray(manual) || manual.length > MAX_ITEMS_PER_RUN) throw bad("invalid_items");
      const out: Candidate[] = [];
      for (const x of manual) {
        const o = (x ?? {}) as Record<string, unknown>;
        const title = text(o.title, 1, 200, "invalid_items");
        const body = text(o.text, 1, MAX_BODY_TEXT, "invalid_items");
        out.push({
          key: `man:${(await sha256Hex(`${title}\n${body}`)).slice(0, 16)}`,
          title,
          text: body,
        });
      }
      return { items: out };
    }
    case "notes": {
      const rows = await mine(c).listByKind("personalitem", 100);
      return {
        items: rows
          .filter((r) => r.tags.includes("note") && !r.tags.includes("routine") && r.body)
          .slice(0, MAX_ITEMS_PER_RUN)
          .map((r) => ({ key: r.id, title: r.label, text: r.body ?? "" })),
      };
    }
    case "meetings": {
      const t = routine.source.ref ? resolveTarget(c, routine.source.ref, "read") : null;
      if (!t) return { error: "source_unavailable" };
      const rows = await stubOf(c, t.scope).listByKind("meeting_record", MAX_ITEMS_PER_RUN);
      const account = accountOf(t.nodeId);
      return {
        items: rows.map((r) => {
          const m = safeJson(r.body);
          const list = (k: string, label: string) =>
            (Array.isArray(m[k]) ? (m[k] as { title?: unknown }[]) : []).map(
              (x) => `${label}: ${String(x.title ?? "")}`,
            );
          return {
            key: r.id,
            title: r.label,
            text: [
              r.label,
              ...list("decisions", "Decision"),
              ...list("commitments", "Commitment"),
              ...list("risks", "Risk"),
              typeof m.notes === "string" ? m.notes : "",
            ]
              .filter(Boolean)
              .join("\n"),
            ...(account ? { account } : {}),
          };
        }),
      };
    }
    default: {
      // sharepoint: files the connector synced, found by the routine's search words, each one
      // readable by this person at content level and confirmed by the connector.
      if (!s.switches.connector) return { error: "switched_off" };
      const tokens = tokensOf(routine.source.ref ?? "");
      if (!tokens.length) return { items: [] };
      const match = matchOfTokens(tokens);
      const scopes = [
        ...new Set(
          [...view.nodes.values()].flatMap((n) =>
            opensBrain(n) && !isPersonalKind(n.kind) ? [scopeOfNode(n)] : [],
          ),
        ),
      ].filter((x): x is string => x !== null);
      const hits = (
        await Promise.all(
          scopes.map(async (scope) =>
            (await stubOf(c, scope).sourceSearch(match, 10)).map((h) => ({ ...h, scope })),
          ),
        )
      )
        .flat()
        .filter((h) => view.nodes.get(h.gateNodeId)?.level === "content")
        .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id))
        .slice(0, MAX_ITEMS_PER_RUN);
      const ok = await checkSourceAccess(
        c.env,
        s.tenantId,
        { id: s.principal.id, email: s.principal.email },
        hits.map((h) => h.id),
      );
      const items: (Candidate & { account?: string })[] = [];
      for (const h of hits) {
        if (!ok.has(h.id)) continue;
        const row = await stubOf(c, h.scope).sourceGet(h.id);
        if (!row?.body) continue;
        const account = accountOf(h.gateNodeId);
        items.push({
          key: h.id,
          title: row.title,
          text: row.body.slice(0, MAX_BODY_TEXT),
          ...(account ? { account } : {}),
        });
      }
      return { items };
    }
  }
}

/** A title that carries personal wording is withheld from the run log. */
const logTitle = (title: string): string => {
  const t = cleanText(title, 120);
  return !t || excludePersonalSegments(t).excluded.length ? "(title withheld)" : t;
};

/** The words a rule's refusal gives a routine run (its message, never the content). */
async function ruleReason(r: Response): Promise<string> {
  const b = (await r
    .clone()
    .json()
    .catch(() => ({}))) as { message?: string; error?: string };
  return b.message ?? `A brain rule stopped this (${b.error ?? "held"})`;
}

export type IngestResult = { ok: true; id: string } | { ok: false; reason: string };

/**
 * The one place a routine writes. The caller checked nothing: every right is checked here, on the live
 * view, so a question answered a week later is held to today's rights.
 */
export async function writeIngest(
  c: C,
  routineId: string,
  targetParam: string,
  title: string,
  body: string,
): Promise<IngestResult> {
  const s = sess(c);
  const view = viewOf(s);
  const t = resolveTarget(c, targetParam, "contribute");
  if (!t) return { ok: false, reason: "You may not contribute to this scope" };
  const cleanTitle = cleanText(title, 200) || "Untitled";
  const text = body.slice(0, MAX_BODY_TEXT);
  if (t.personal) {
    if (
      !(await audit(c, {
        action: "routine.ingest",
        nodeId: null,
        scopeId: t.scope,
        revision: 1,
      }))
    )
      return { ok: false, reason: "The audit record could not be written" };
    const made = await stubOf(c, t.scope).create(
      {
        id: `pi:${hex(8)}`,
        label: cleanTitle,
        kind: "personalitem",
        plane: "PERSONAL_HOSTED",
        origin: "personal",
        status: "draft",
        authorId: s.principal.id,
        body: text,
        tags: ["note", "routine"],
      },
      s.ctx.now,
    );
    if ("ok" in made) return { ok: false, reason: made.message };
    await wikiNotify(c.env, s.tenantId, t.scope, [made.id], s.ctx.now);
    return { ok: true, id: made.id };
  }
  if (!s.switches.contribute) return { ok: false, reason: "Contributions are switched off" };
  // R-111 once more on exactly what will be stored. A flag here means the text was not cleaned.
  if (detectSensitivity({ title: cleanTitle, body: text }).length)
    return { ok: false, reason: "Sensitive content remains in the text" };
  const vn = view.nodes.get(t.nodeId);
  if (!vn) return { ok: false, reason: "The scope is not in your view" };
  // Brain rules (v7): a routine writes to a shared brain like any contribution, so the rules apply.
  const g = await ruleGate(c, {
    action: vn.kind === "core" ? "promote_to_global" : "propose_page",
    brain: { nodeId: t.nodeId, personal: false, vn },
    text: `${cleanTitle}\n${text}`,
    cites: 0,
    pages: 1,
    mode: "stamp",
  });
  if (g.response) return { ok: false, reason: await ruleReason(g.response) };
  if (
    !(await audit(c, {
      action: "routine.ingest",
      nodeId: t.nodeId,
      scopeId: t.scope,
      revision: 1,
      ...g.rx,
    }))
  )
    return { ok: false, reason: "The audit record could not be written" };
  const made = await stubOf(c, t.scope).create(
    {
      id: candidateId(t.nodeId, hex(4)),
      label: cleanTitle,
      kind: "candidate",
      plane: vn.plane,
      origin: "candidate",
      status: "candidate",
      authorId: s.principal.id,
      body: text,
      targetNode: t.nodeId,
      releaseTarget: vn.kind === "core" ? "global" : "scope",
      userValidated: null,
      sensitivityFlags: [],
      tags: ["routine", routineId],
    },
    s.ctx.now,
  );
  if ("ok" in made) return { ok: false, reason: made.message };
  await g.stamp(stubOf(c, t.scope), made.id);
  await notifyContributed(c, t.nodeId, made.id, s.principal.id);
  return { ok: true, id: made.id };
}

export function routineRoutes(deps: AppDeps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get("/routines", async (c) => {
    const rows = await mine(c).listByKind(ROUTINE_KIND, 100);
    return c.json(
      rows
        .flatMap((x) => routineOf(x) ?? [])
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
    );
  });

  r.post("/routines", async (c) => {
    const s = sess(c);
    const b = await readObject(c);
    const name = text(b.name, 1, 80, "invalid_name");
    const source = readSource(c, b.source);
    const schedule = b.schedule === undefined ? "manual" : b.schedule;
    if (!SCHEDULES.includes(schedule as never)) throw bad("invalid_schedule");
    if (typeof b.targetScopeId !== "string") throw bad("invalid_target");
    const guardrails = readGuardrails(b.guardrails);
    if (b.enabled !== undefined && typeof b.enabled !== "boolean") throw bad("invalid_enabled");
    const tgt = targetFor(c, b.targetScopeId);
    if ("res" in tgt) {
      await audit(c, {
        action: "routine.create",
        nodeId: null,
        scopeId: null,
        revision: null,
        decision: "deny",
        reason: "target not contributable",
      });
      return tgt.res;
    }
    if (source.kind === "notes" && tgt.t.personal) throw bad("notes_need_shared_target");
    if ((await mine(c).listByKind(ROUTINE_KIND, MAX_ROUTINES + 1)).length >= MAX_ROUTINES)
      return c.json({ error: "routine_limit", reason: `At most ${MAX_ROUTINES} routines` }, 409);
    const id = `rt:${hex(4)}`;
    if (
      !(await audit(c, {
        action: "routine.create",
        nodeId: null,
        scopeId: tgt.t.scope,
        revision: 1,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    const routine: Routine = {
      id,
      name,
      source,
      schedule: schedule as Routine["schedule"],
      targetScopeId: tgt.t.param,
      guardrails,
      enabled: b.enabled !== false,
    };
    await mine(c).scratch(
      {
        id,
        label: name,
        kind: ROUTINE_KIND,
        plane: "PERSONAL_HOSTED",
        origin: "personal",
        status: "draft",
        authorId: s.principal.id,
        body: bodyOf(routine),
      },
      s.ctx.now,
    );
    return c.json(routine, 201);
  });

  r.get("/routines/:id", async (c) => c.json(await loadRoutine(c)));

  r.put("/routines/:id", async (c) => {
    const s = sess(c);
    const cur = await loadRoutine(c);
    const b = await readObject(c);
    const name = b.name === undefined ? cur.name : text(b.name, 1, 80, "invalid_name");
    const source = b.source === undefined ? cur.source : readSource(c, b.source);
    const schedule = b.schedule === undefined ? cur.schedule : b.schedule;
    if (!SCHEDULES.includes(schedule as never)) throw bad("invalid_schedule");
    if (b.targetScopeId !== undefined && typeof b.targetScopeId !== "string")
      throw bad("invalid_target");
    const guardrails = b.guardrails === undefined ? cur.guardrails : readGuardrails(b.guardrails);
    if (b.enabled !== undefined && typeof b.enabled !== "boolean") throw bad("invalid_enabled");
    // The target is checked again whenever it is named, and the stored one is checked at every run.
    const tgt = targetFor(c, (b.targetScopeId as string | undefined) ?? cur.targetScopeId);
    if ("res" in tgt) {
      await audit(c, {
        action: "routine.update",
        nodeId: null,
        scopeId: null,
        revision: null,
        decision: "deny",
        reason: "target not contributable",
      });
      return tgt.res;
    }
    if (source.kind === "notes" && tgt.t.personal) throw bad("notes_need_shared_target");
    if (
      !(await audit(c, {
        action: "routine.update",
        nodeId: null,
        scopeId: tgt.t.scope,
        revision: null,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    const next: Routine = {
      id: cur.id,
      name,
      source,
      schedule: schedule as Routine["schedule"],
      targetScopeId: tgt.t.param,
      guardrails,
      enabled: b.enabled === undefined ? cur.enabled : b.enabled === true,
    };
    await mine(c).scratch(
      {
        id: cur.id,
        label: name,
        kind: ROUTINE_KIND,
        plane: "PERSONAL_HOSTED",
        origin: "personal",
        status: "draft",
        authorId: s.principal.id,
        body: bodyOf(next),
      },
      s.ctx.now,
    );
    return c.json(next);
  });

  r.delete("/routines/:id", async (c) => {
    const cur = await loadRoutine(c);
    if (
      !(await audit(c, { action: "routine.delete", nodeId: null, scopeId: null, revision: null }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    const ws = mine(c);
    await ws.remove(cur.id);
    await ws.remove(`rs:${cur.id}`);
    for (const run of await ws.listByKind(RUN_KIND, 200))
      if (run.id.startsWith(`rr:${cur.id}:`)) await ws.remove(run.id);
    return c.json({ ok: true });
  });

  r.get("/routines/:id/runs", async (c) => {
    const cur = await loadRoutine(c);
    const rows = await mine(c).listByKind(RUN_KIND, 200);
    return c.json(
      rows
        .filter((x) => x.id.startsWith(`rr:${cur.id}:`))
        .map((x) => safeJson(x.body) as unknown as Run)
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, MAX_RUNS_KEPT),
    );
  });

  r.post("/routines/:id/run", async (c) => {
    const s = sess(c);
    const cur = await loadRoutine(c);
    const raw = await c.req.text();
    let body: Record<string, unknown> = {};
    if (raw.trim()) {
      try {
        const v: unknown = JSON.parse(raw);
        if (v && typeof v === "object" && !Array.isArray(v)) body = v as Record<string, unknown>;
        else throw bad("invalid_json");
      } catch {
        throw bad("invalid_json");
      }
    }
    if (!cur.enabled) return c.json({ error: "routine_disabled" }, 409);
    const limited = await tenantStub(c.env, s.tenantId).hit(
      `uxv2_run:${s.principal.id}`,
      s.ctx.now,
      RUNS_PER_MIN,
    );
    if (limited.limited) {
      c.header("Retry-After", String(limited.retryAfter));
      return c.json({ error: "rate_limited" }, 429);
    }
    // The owner's rights today, not the ones the routine was made with. Nothing is read or written otherwise.
    const tgt = targetFor(c, cur.targetScopeId);
    if ("res" in tgt) {
      await audit(c, {
        action: "routine.run",
        nodeId: null,
        scopeId: null,
        revision: null,
        decision: "deny",
        reason: "target not contributable",
      });
      return tgt.res;
    }
    if (!tgt.t.personal && !s.switches.contribute)
      return c.json({ error: "switched_off", switch: "contribute" }, 503);
    if (
      !(await audit(c, {
        action: "routine.run",
        nodeId: null,
        scopeId: tgt.t.scope,
        revision: null,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);

    const view = viewOf(s);
    const got = await collect(c, cur, body.items);
    if ("error" in got) return c.json({ error: got.error }, 409);
    const ws = mine(c);
    const seenRec = await ws.get(`rs:${cur.id}`);
    const seen: Record<string, string> = safeJson(seenRec?.body ?? null) as Record<string, string>;

    const g = gate(c.env, s.switches.ai);
    const budget = g.ok
      ? metered(
          withUserCap(
            doBudget(c.env, s.tenantId, s.ctx.now),
            doBudget(c.env, s.tenantId, s.ctx.now, `u-${s.principal.id}`),
            g.userDailyBudget,
          ),
        )
      : null;

    const items: RunItem[] = [];
    let ingested = 0;
    let skipped = 0;
    let asked = 0;
    for (const cand of got.items.slice(0, MAX_ITEMS_PER_RUN)) {
      const fp = (await sha256Hex(`${cand.title}\n${cand.text}`)).slice(0, 16);
      if (seen[cand.key] === fp) continue;
      const res = classify(cand, cur.guardrails);
      let { verdict, reason } = res;
      // The model may only tighten a verdict, never loosen one, and never sees a Personal Brain note.
      // The account's contract decides for its material; anything but "allowed" keeps it away.
      const personalSource = cur.source.kind === "notes";
      if (
        g.ok &&
        budget &&
        verdict === "ingest" &&
        !personalSource &&
        !contractGate(view, cand.account)
      ) {
        const second = await refine({
          ai: g,
          budget: budget.store,
          title: cand.title,
          kept: res.kept,
          ...(deps.fetch ? { fetch: deps.fetch } : {}),
          ...(deps.sleep ? { sleep: deps.sleep } : {}),
        });
        if (second?.verdict) {
          const v = stricter(verdict, second.verdict);
          if (v !== verdict) {
            verdict = v;
            reason = `AI: ${second.reason}`;
          }
        }
      }
      if (verdict === "ingest") {
        const w = await writeIngest(c, cur.id, cur.targetScopeId, cand.title, res.kept);
        if (w.ok) ingested++;
        else {
          verdict = "ask";
          reason = w.reason;
        }
      }
      if (verdict === "ask") {
        asked++;
        const id = `ask:${hex(8)}`;
        await ws.create(
          {
            id,
            label: cleanText(cand.title, 200) || "Untitled",
            kind: ASK_KIND,
            plane: "PERSONAL_HOSTED",
            origin: "personal",
            status: "open",
            authorId: s.principal.id,
            // Personal passages are removed and contact details masked before anything is stored.
            body: JSON.stringify({
              routineId: cur.id,
              routineName: cur.name,
              targetScopeId: cur.targetScopeId,
              reason,
              text: res.kept.slice(0, MAX_BODY_TEXT),
              excluded: res.excluded,
            }),
          },
          s.ctx.now,
        );
      } else if (verdict === "skip") skipped++;
      seen[cand.key] = fp;
      items.push({ title: logTitle(cand.title), verdict, reason });
    }
    // Only the newest MAX_SEEN fingerprints are kept, oldest dropped first.
    const keys = Object.keys(seen);
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_SEEN))) delete seen[k];
    await ws.scratch(
      {
        id: `rs:${cur.id}`,
        label: `rs:${cur.id}`,
        kind: STATE_KIND,
        plane: "PERSONAL_HOSTED",
        origin: "personal",
        status: "draft",
        authorId: s.principal.id,
        body: JSON.stringify(seen),
      },
      s.ctx.now,
    );
    const run: Run = {
      id: `run:${hex(6)}`,
      at: iso(s.ctx.now),
      ingested,
      skipped,
      asked,
      tokens: budget?.spent() ?? 0,
      items,
    };
    await ws.scratch(
      {
        id: `rr:${cur.id}:${s.ctx.now}-${hex(2)}`,
        label: run.id,
        kind: RUN_KIND,
        plane: "PERSONAL_HOSTED",
        origin: "personal",
        status: "draft",
        authorId: s.principal.id,
        body: JSON.stringify(run),
      },
      s.ctx.now,
    );
    const runs = (await ws.listByKind(RUN_KIND, 300)).filter((x) =>
      x.id.startsWith(`rr:${cur.id}:`),
    );
    for (const old of runs.slice(MAX_RUNS_KEPT)) await ws.remove(old.id);
    await recordUsage(c.env, s.tenantId, s.principal.id, s.ctx.now, {
      capability: "routine",
      tokens: run.tokens,
      runs: 1,
    });
    return c.json(run, 200);
  });

  return r;
}
