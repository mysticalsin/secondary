// /v1/questions: the one inbox of things the brain needs a human for. It is a view over four sources,
// each filtered for this caller: ingest questions a routine's classifier raised (the owner's own),
// wiki proposals (contradictions with both statements side by side, lint findings, ingest and dreaming
// reviews), and contribution candidates waiting for review or release. Resolving a question runs the
// same rules as the underlying API: rights are checked again on the live record, the decider is never
// an author, a two-person release counts distinct people, and approving names the revision that was
// read (`revisionHash`). A question the caller cannot see answers 404, like a missing one.

import {
  type BrainRole,
  canDoInView,
  opensBrain,
  personalRootId,
  roleAllows,
} from "@secondary/policy";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { viewOf } from "../auth.ts";
import { needFlag } from "../brains/open.ts";
import { humanIdsOf } from "../human.ts";
import { ruleDecideGuard } from "../rules/gate.ts";
import { parseCandidateId, personalScope, scopeOfNode } from "../scope.ts";
import type { SensitivityFlag } from "../sensitivity.ts";
import type { AppEnv } from "../types.ts";
import { notifyApproved, notifyChangesRequested } from "../ux/notify.ts";
import { audit, bad, type C, forbidden, notFound, readObject, sess } from "../ux/util.ts";
import { numberChanges, parseSeen, seenProblem } from "../wiki/changes.ts";
import { mayDecide, proposalSources, wikiQueueRow } from "../wiki/review.ts";
import {
  hiddenLinkFilter,
  lineReadable,
  pageVisible,
  RESTRICTED,
  type Readable,
  readableMany,
  sourcesReadable,
} from "../wiki/routes.ts";
import { citationsOf, sha256Hex, titleOfSubject } from "../wiki/text.ts";
import { isWikiKind } from "../wiki/types.ts";
import type { ItemRecord } from "../workspace.ts";
import { ASK_KIND, writeIngest } from "./routines.ts";
import { admittedScopes, iso, safeJson, stubOf, WIKI_NODE_KINDS } from "./shared.ts";

export type QuestionKind = "ingest" | "contradiction" | "lint" | "review" | "release";
type Option = { action: string; label: string };
type Side = { text: string; validFrom?: string; sources: { id: string; title: string }[] };
export type Question = {
  id: string;
  kind: QuestionKind;
  title: string;
  workspaceId: string;
  createdAt: string;
  summary: string;
  options: Option[];
  detail: Record<string, unknown>;
};

const MAX_LIST = 200;
const BATCH_MAX = 50;
const KINDS = new Set(["ingest", "contradiction", "lint", "review", "release"]);
const NOTE_MAX = 2_000;
const QID = /^(?:cand:[a-z0-9][A-Za-z0-9_.:@-]*:[0-9a-f]{8}|ask:[0-9a-f]{16})$/;

const FLAG_REASON: Record<SensitivityFlag["type"], string> = {
  email: "Contains an email address",
  phone: "Contains a phone number",
  health: "Mentions health information",
  family: "Mentions family or private life",
  hr: "Mentions HR or pay matters",
};

const OPTIONS = {
  ingest: [
    { action: "ingest", label: "Ingest it" },
    { action: "skip", label: "Skip it" },
  ],
  contradiction: [
    { action: "prefer_incoming", label: "The newer statement is right" },
    { action: "keep_current", label: "The current statement is right" },
  ],
  wiki: [
    { action: "approve", label: "Approve" },
    { action: "reject", label: "Reject" },
  ],
  lint: [
    { action: "approve", label: "Apply the fix" },
    { action: "reject", label: "Dismiss" },
  ],
  review: [
    { action: "accept", label: "Accept" },
    { action: "request_changes", label: "Request changes" },
  ],
  release: [
    { action: "approve", label: "Approve release" },
    { action: "request_changes", label: "Request changes" },
  ],
} as const satisfies Record<string, readonly Option[]>;

const short = (s: string, n = 240): string => s.replace(/\s+/g, " ").trim().slice(0, n);

/** Which question a wiki proposal is. A contradiction is a lint finding about two valid facts. */
function wikiKind(r: ItemRecord): "contradiction" | "lint" | "review" {
  if (r.kind !== "wiki_lint") return "review";
  const key = safeJson(r.body).findingKey;
  return typeof key === "string" && /^contra:\d+:\d+$/.test(key) ? "contradiction" : "lint";
}

const candidateHash = (r: ItemRecord): Promise<string> =>
  sha256Hex(`${r.id}\n${r.revision}\n${r.label}\n${r.body ?? ""}`).then((h) => h.slice(0, 32));

type WikiStub = ReturnType<typeof stubOf>;

async function contradictionSides(
  stub: WikiStub,
  r: ItemRecord,
  ok: Readable,
  whole: boolean,
): Promise<{ current: Side; incoming: Side; title: string } | null> {
  const key = String(safeJson(r.body).findingKey ?? "");
  const m = /^contra:(\d+):(\d+)$/.exec(key);
  const pv = await stub.wikiProposalView(r.id);
  const a = pv?.invalidate[0];
  if (!m || !a) return null;
  const facts = await stub.wikiFacts({ subject: a.subject, validOnly: false, limit: 200 });
  const b = facts.find((f) => f.id === Number(m[2]));
  const cur = facts.find((f) => f.id === a.factId);
  if (!b || !cur) return null;
  const side = (f: typeof cur): Side =>
    whole
      ? {
          text: `${f.predicate}: ${f.object}`,
          validFrom: f.validAt,
          sources: f.sourceIds
            .filter((i) => ok.has(i))
            .map((i) => ({ id: i, title: ok.get(i)?.title ?? i })),
        }
      : { text: RESTRICTED, sources: [] };
  return {
    current: side(cur),
    incoming: side(b),
    title: whole ? `Contradiction: ${titleOfSubject(cur.subject)} (${cur.predicate})` : RESTRICTED,
  };
}

/** Every question the caller may see, newest first. */
export async function questionsOf(c: C): Promise<Question[]> {
  const s = sess(c);
  const view = viewOf(s);
  const me = s.principal;
  const scopes = admittedScopes(view);
  const lists = await Promise.all(scopes.map((sc) => stubOf(c, sc).pending(100)));
  // A stored brain role only narrows (H-2): a person demoted in a brain no longer decides its items here.
  const human = await humanIdsOf(c.env, s);
  const roles = new Map<string, Promise<BrainRole | null>>();
  const roleIn = (sc: string): Promise<BrainRole | null> => {
    let p = roles.get(sc);
    if (!p) {
      p = sc.startsWith("personal:") ? Promise.resolve(null) : stubOf(c, sc).brainRoleOf(human);
      roles.set(sc, p);
    }
    return p;
  };

  // A wiki proposal shows its text only to someone who can read every source it rests on (H-02).
  const groups = lists.flatMap((list, i) => {
    const items = list.filter((r) => isWikiKind(r.kind));
    return items.length
      ? [
          {
            items,
            scope: scopes[i] as string,
            personal: (scopes[i] as string).startsWith("personal:"),
          },
        ]
      : [];
  });
  const oks = await readableMany(
    c,
    groups.map((g) => ({
      w: { view, personal: g.personal, stub: stubOf(c, g.scope) },
      ids: g.items.flatMap(proposalSources),
    })),
  );

  const out: Question[] = [];
  for (const [gi, g] of groups.entries()) {
    const ok = oks[gi] as Readable;
    const stub = stubOf(c, g.scope);
    if (!roleAllows(await roleIn(g.scope), "review")) continue;
    for (const r of g.items) {
      const whole = sourcesReadable(proposalSources(r), ok);
      const row = wikiQueueRow(view, me, r, whole);
      if (!row) continue;
      const pv = await stub.wikiProposalView(r.id);
      if (!pv) continue;
      const kind = wikiKind(r);
      const base = {
        id: r.id,
        workspaceId: g.personal ? "me" : (r.targetNode ?? ""),
        createdAt: iso(r.createdAt),
      };
      const numbered = numberChanges(pv.pages.map((p) => p.diff));
      const common = {
        revisionHash: pv.revisionHash,
        approvals: r.approvals,
        required: r.required,
        authorId: r.authorId,
        // For the Review desk: what kind of text this is. Page types and the filing reason are not
        // personal text, and the reason is left out when a source is restricted.
        pageTypes: pv.pages.map((p) => p.type),
        rationale: whole ? short(pv.rationale, 80) : "",
      };
      if (kind === "contradiction") {
        const sides = await contradictionSides(stub, r, ok, whole);
        if (!sides) continue;
        out.push({
          ...base,
          kind,
          title: sides.title,
          summary: whole ? short(pv.detail || pv.rationale) : RESTRICTED,
          options: [...OPTIONS.contradiction],
          detail: { current: sides.current, incoming: sides.incoming, ...common },
        });
        continue;
      }
      const unlink = await hiddenLinkFilter(
        c,
        { view, personal: g.personal, stub },
        pv.pages.flatMap((p) => p.diff.map((d) => d.text)),
      );
      out.push({
        ...base,
        kind,
        title: row.title,
        summary: whole ? short(pv.detail || pv.rationale) : RESTRICTED,
        options: [...(kind === "lint" ? OPTIONS.lint : OPTIONS.wiki)],
        detail: {
          ...common,
          changes: row.diff.map((d) => d.text).slice(0, 20),
          // The page diff, every change numbered, so the reviewer can mark each one as seen.
          changeCount: numbered.count,
          pages: pv.pages.map((p, pi) => ({
            pageId: p.pageId,
            title: pageVisible(citationsOf(p.after), ok) ? p.title : RESTRICTED,
            diff: p.diff.map((d, li) => {
              const change = numbered.index[pi]?.[li] ?? null;
              return {
                type: d.type,
                text: unlink(lineReadable(d.text, ok) ? d.text : `- ${RESTRICTED}`),
                ...(change === null ? {} : { change }),
              };
            }),
          })),
        },
      });
    }
  }

  // Contribution candidates: the same rule as the review queue (never your own, rights on the live record).
  for (const [li, list] of lists.entries()) {
    const role = await roleIn(scopes[li] as string);
    for (const r of list) {
      if (r.kind !== "candidate" || r.authorId === me.id) continue;
      const node = r.targetNode ?? r.id;
      const target = view.nodes.get(node);
      if (!target) continue;
      const rec = { authorId: r.authorId, status: r.status, revision: r.revision };
      const approve = canDoInView(view, me, node, "approve_release", view.ctx, rec);
      const review = canDoInView(view, me, node, "review", view.ctx, rec);
      const mayApprove = approve.allowed && roleAllows(role, "approve_release");
      const mayReview = review.allowed && roleAllows(role, "review");
      if (!mayApprove && !mayReview) continue;
      const kind: QuestionKind = mayApprove ? "release" : "review";
      out.push({
        id: r.id,
        kind,
        title: r.label,
        workspaceId: node,
        createdAt: iso(r.createdAt),
        summary: short(r.body ?? r.label),
        options: [...OPTIONS[kind]],
        detail: {
          revisionHash: await candidateHash(r),
          approvals: r.approvals,
          required: r.required,
          release: r.releaseTarget,
          text: (r.body ?? "").slice(0, 2_000),
          flags: r.sensitivityFlags.map((f) => ({
            kind: f.type,
            span: f.excerpt,
            reason: FLAG_REASON[f.type],
          })),
        },
      });
    }
  }

  // The owner's own ingest questions.
  for (const a of await stubOf(c, personalScope(me.id)).listByKind(ASK_KIND, 100)) {
    const b = safeJson(a.body);
    if (b.closed === true) continue;
    out.push({
      id: a.id,
      kind: "ingest",
      title: a.label,
      workspaceId: typeof b.targetScopeId === "string" ? b.targetScopeId : "me",
      createdAt: iso(a.createdAt),
      summary: short(String(b.reason ?? "")),
      options: [...OPTIONS.ingest],
      detail: {
        routine: String(b.routineName ?? ""),
        reason: String(b.reason ?? ""),
        excerpt: String(b.text ?? "").slice(0, 400),
        excluded: (b.excluded ?? {}) as Record<string, number>,
      },
    });
  }
  return out
    .sort((x, y) => y.createdAt.localeCompare(x.createdAt) || x.id.localeCompare(y.id))
    .slice(0, MAX_LIST);
}

function mapFail(c: C, f: { code: string; message: string; currentRevision?: number }): Response {
  if (f.code === "self_approval" || f.code === "not_author")
    return c.json({ error: f.code, reason: f.message }, 403);
  if (f.code === "revision_required") return c.json({ error: f.code, reason: f.message }, 400);
  if (f.code === "not_found") return c.json({ error: "not_found" }, 404);
  if (f.code === "conflict")
    return c.json(
      { error: "revision_conflict", currentRevision: f.currentRevision, reason: f.message },
      409,
    );
  return c.json({ error: f.code, reason: f.message }, 409);
}

const deny = async (c: C, action: string, id: string, scope: string | null, reason: string) => {
  await audit(c, { action, nodeId: id, scopeId: scope, revision: null, decision: "deny", reason });
  return forbidden(c, reason);
};

/** Resolve one question: the single-item rules, shared by POST /questions/:id and the batch. */
export async function resolveQuestion(
  c: C,
  id: string,
  b: Record<string, unknown>,
): Promise<Response> {
  const s = sess(c);
  if (!QID.test(id)) throw notFound();
  if (typeof b.action !== "string" || b.action.length > 40) throw bad("invalid_action");
  const action = b.action;
  if (
    b.revisionHash !== undefined &&
    (typeof b.revisionHash !== "string" || b.revisionHash.length > 128)
  )
    throw bad("invalid_revision_hash");
  if (b.note !== undefined && (typeof b.note !== "string" || b.note.length > NOTE_MAX))
    throw bad("invalid_note");
  const revisionHash = b.revisionHash as string | undefined;
  const seen = parseSeen(b.seenChanges);
  if (seen === null) throw bad("invalid_seen_changes");
  const note = typeof b.note === "string" ? b.note.trim() : "";
  const view = viewOf(s);

  // ---- an ingest question: the owner's own, answered with the owner's rights today ----
  if (id.startsWith("ask:")) {
    const ws = stubOf(c, personalScope(s.principal.id));
    const rec = await ws.get(id);
    if (!rec || rec.kind !== ASK_KIND || safeJson(rec.body).closed === true) throw notFound();
    if (action !== "ingest" && action !== "skip")
      return deny(c, "question.ingest", id, null, "Action not available");
    const ask = safeJson(rec.body);
    // A closed question keeps no text: what it held is either ingested or dropped.
    const closed = { ...ask, text: "", closed: true, outcome: action };
    if (action === "ingest") {
      const res = await writeIngest(
        c,
        String(ask.routineId ?? ""),
        String(ask.targetScopeId ?? ""),
        rec.label,
        String(ask.text ?? ""),
      );
      if (!res.ok) return deny(c, "question.ingest", id, null, res.reason);
    }
    await ws.scratch(
      {
        id,
        label: rec.label,
        kind: ASK_KIND,
        plane: "PERSONAL_HOSTED",
        origin: "personal",
        status: "open",
        authorId: s.principal.id,
        body: JSON.stringify(closed),
      },
      s.ctx.now,
    );
    return c.json({ ok: true });
  }

  // ---- a wiki proposal or a candidate: find its workspace through the caller's own view ----
  const mineRoot = personalRootId(s.principal.id);
  let scope: string;
  let node: string;
  if (id.startsWith(`cand:${mineRoot}:`)) {
    scope = personalScope(s.principal.id);
    node = mineRoot;
  } else {
    const parsed = parseCandidateId(id);
    const vn = parsed ? view.nodes.get(parsed.targetNodeId) : undefined;
    const sc = vn ? scopeOfNode(vn) : null;
    if (!parsed || !vn || !sc || !opensBrain(vn)) throw notFound();
    scope = sc;
    node = vn.id;
  }
  const stub = stubOf(c, scope);
  const item = await stub.get(id);
  if (!item) throw notFound();
  const sameHuman = await humanIdsOf(c.env, s);

  if (isWikiKind(item.kind)) {
    const personal = node === mineRoot;
    if (!personal && !WIKI_NODE_KINDS.has(view.nodes.get(node)?.kind ?? "")) throw notFound();
    const right = mayDecide(view, s.principal, node);
    if (!right.allowed) return deny(c, `wiki.${action}`, id, scope, right.reason);
    // The stored brain role only narrows (H-2): a demoted steward cannot decide here either.
    if (!personal && !roleAllows(await stub.brainRoleOf(sameHuman), "review"))
      return deny(
        c,
        `wiki.${action}`,
        id,
        scope,
        "Your role in this brain does not include review",
      );
    const kind = wikiKind(item);
    const allowed =
      kind === "contradiction" ? ["prefer_incoming", "keep_current"] : ["approve", "reject"];
    if (!allowed.includes(action))
      return deny(c, `wiki.${action}`, id, scope, "Action not available");
    const approving =
      action === "approve" || action === "prefer_incoming" || action === "keep_current";
    if (approving && !revisionHash)
      return c.json(
        { error: "revision_required", reason: "Name the revision you read: send revisionHash" },
        400,
      );
    const decideOpts = {
      ...(revisionHash ? { revisionHash } : {}),
      sameHuman,
    };
    if (approving && item.status === "candidate") {
      // Every change must have been seen, on the current revision (API-CONTRACT v4).
      const now = await stub.wikiProposalView(id);
      if (!now) throw notFound();
      const problem = seenProblem(now, seen);
      if (problem) {
        await audit(c, {
          action: `wiki.${action}`,
          nodeId: id,
          scopeId: scope,
          revision: null,
          decision: "deny",
          reason: "changes_not_seen",
        });
        return c.json({ error: "changes_not_seen", ...problem }, 409);
      }
    }

    if (action === "keep_current") {
      // Keeping the current statement means ending the incoming one, as a proposal of its own that
      // follows the same rules (two people where the wiki needs two). The original finding is dismissed.
      const pv = await stub.wikiProposalView(id);
      if (!pv) throw notFound();
      if (pv.revisionHash !== revisionHash)
        return mapFail(c, {
          code: "conflict",
          message: "The proposal changed since you read it. Reload and read it again",
          currentRevision: pv.revision,
        });
      const m = /^contra:(\d+):(\d+)$/.exec(String(safeJson(item.body).findingKey ?? ""));
      const a = pv.invalidate[0];
      if (!m || !a) throw notFound();
      const facts = await stub.wikiFacts({ subject: a.subject, validOnly: false, limit: 200 });
      const cur = facts.find((f) => f.id === a.factId);
      const inc = facts.find((f) => f.id === Number(m[2]));
      if (!cur || !inc || cur.invalidAt !== null || inc.invalidAt !== null)
        return c.json(
          { error: "not_pending", reason: "The contradiction was already settled" },
          409,
        );
      // Brain rules (v7): keeping a statement releases a change, so a rule can block it or ask more of it.
      const kg = await ruleDecideGuard(
        c,
        {
          stub,
          nodeId: node,
          personal,
          vn: personal ? null : (view.nodes.get(node) ?? null),
          view,
        },
        id,
      );
      if (kg.response) return kg.response;
      if (
        !(await audit(c, {
          action: "wiki.keep_current",
          nodeId: id,
          scopeId: scope,
          revision: null,
          ...kg.rx,
        }))
      )
        return c.json({ error: "audit_unavailable" }, 503);
      const made = await stub.wikiPropose(
        {
          kind: "wiki_lint",
          title: `Keep: ${titleOfSubject(cur.subject)} (${cur.predicate})`,
          rationale: "The current statement was confirmed over the incoming one",
          origin: "human",
          pages: [],
          facts: [],
          invalidate: [{ factId: inc.id, at: inc.validAt }],
          confirm: [cur.id],
          archive: [],
          reingest: [],
          sources: [],
          findingKey: `keep:${cur.id}:${inc.id}`,
          detail: `Keeps "${cur.object}" and ends "${inc.object}". Both stay in the history.`,
          titleSources: [...new Set([...cur.sourceIds, ...inc.sourceIds])],
        },
        "system:questions",
        s.ctx.now,
        { plane: item.plane },
      );
      if (!made.ok) return mapFail(c, made);
      if (!made.created)
        return c.json(
          { error: "not_pending", reason: "The contradiction was already settled" },
          409,
        );
      if (kg.stamp) await stub.brainRuleStamp(made.id, kg.stamp);
      const rejected = await stub.wikiDecide(id, "reject", s.principal.id, s.ctx.now, {
        sameHuman,
      });
      if (!rejected.ok) return mapFail(c, rejected);
      const nv = await stub.wikiProposalView(made.id);
      const res = await stub.wikiDecide(made.id, "approve", s.principal.id, s.ctx.now, {
        ...(nv ? { revisionHash: nv.revisionHash } : {}),
        sameHuman,
      });
      if (!res.ok) return mapFail(c, res);
      return c.json({
        ok: true,
        status: res.status,
        approvals: res.approvals,
        required: res.required,
      });
    }

    const decision = approving ? "approve" : "reject";
    // Brain rules (v7): a rule can block this publish, ask for more approvals or limit who approves.
    const dg = approving
      ? await ruleDecideGuard(
          c,
          {
            stub,
            nodeId: node,
            personal,
            vn: personal ? null : (view.nodes.get(node) ?? null),
            view,
          },
          id,
        )
      : null;
    if (dg?.response) return dg.response;
    if (
      !(await audit(c, {
        action: `wiki.${decision}`,
        nodeId: id,
        scopeId: scope,
        revision: null,
        ...(dg?.rx ?? {}),
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    const res = await stub.wikiDecide(id, decision, s.principal.id, s.ctx.now, decideOpts);
    if (!res.ok) return mapFail(c, res);
    return c.json({
      ok: true,
      status: res.status,
      approvals: res.approvals,
      required: res.required,
    });
  }

  // ---- a contribution candidate ----
  if (item.kind !== "candidate" || node === mineRoot) throw notFound();
  const rec = { authorId: item.authorId, status: item.status, revision: item.revision };
  const wantsRelease = action === "approve";
  if (!["accept", "request_changes", "approve"].includes(action))
    return deny(c, action, id, scope, "Action not available");
  const d = canDoInView(
    view,
    s.principal,
    node,
    wantsRelease ? "approve_release" : "review",
    view.ctx,
    rec,
  );
  if (!d.allowed) return deny(c, wantsRelease ? "approve_release" : "review", id, scope, d.reason);
  if (!roleAllows(await stub.brainRoleOf(sameHuman), wantsRelease ? "approve_release" : "review"))
    return deny(
      c,
      wantsRelease ? "approve_release" : "review",
      id,
      scope,
      "Your role in this brain does not include this decision",
    );
  if (!revisionHash)
    return c.json(
      { error: "revision_required", reason: "Name the revision you read: send revisionHash" },
      400,
    );
  if (revisionHash !== (await candidateHash(item)))
    return mapFail(c, {
      code: "conflict",
      message: "The item changed since you read it. Reload and read it again",
      currentRevision: item.revision,
    });
  const dg = wantsRelease
    ? await ruleDecideGuard(
        c,
        { stub, nodeId: node, personal: false, vn: view.nodes.get(node) ?? null, view },
        id,
      )
    : null;
  if (dg?.response) return dg.response;
  if (
    !(await audit(c, {
      action: wantsRelease ? "approve_release" : "review",
      nodeId: id,
      scopeId: scope,
      revision: item.revision,
      reason: d.reason,
      ...(dg?.rx ?? {}),
    }))
  )
    return c.json({ error: "audit_unavailable" }, 503);
  if (wantsRelease) {
    const res = await stub.approve(id, item.revision, s.principal.id, s.ctx.now, sameHuman);
    if (!res.ok) return mapFail(c, res);
    await notifyApproved(c, node, id, item.authorId, res.released);
    if (note) await stub.comment(id, s.principal.id, note, s.ctx.now);
    return c.json({
      ok: true,
      released: res.released,
      approvals: res.approvals,
      required: res.required,
    });
  }
  const verdict = action === "accept" ? "accept" : "changes_requested";
  const res = await stub.review(id, item.revision, s.principal.id, verdict, s.ctx.now, sameHuman);
  if (!res.ok) return mapFail(c, res);
  if (note) await stub.comment(id, s.principal.id, note, s.ctx.now);
  if (verdict === "changes_requested") await notifyChangesRequested(c, node, id, item.authorId);
  return c.json({ ok: true });
}

export function questionRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get("/questions", async (c) => {
    const all = await questionsOf(c);
    const q = (c.req.query("q") ?? "").trim().toLowerCase().slice(0, 100);
    const brain = c.req.query("brain");
    const kind = c.req.query("kind");
    const age = c.req.query("age");
    if (kind !== undefined && !KINDS.has(kind)) throw bad("invalid_kind");
    if (age !== undefined && !["1d", "7d", "30d", "older"].includes(age)) throw bad("invalid_age");
    if (brain !== undefined && brain.length > 128) throw bad("invalid_brain");
    const now = sess(c).ctx.now;
    const days = age === undefined ? null : age === "older" ? 30 : Number.parseInt(age, 10);
    return c.json(
      all.filter((x) => {
        if (q && !`${x.title} ${x.summary}`.toLowerCase().includes(q)) return false;
        if (brain !== undefined && x.workspaceId !== brain) return false;
        if (kind !== undefined && x.kind !== kind) return false;
        if (days !== null) {
          const old = now - Date.parse(x.createdAt) > days * 86_400_000;
          if (age === "older" ? !old : old) return false;
        }
        return true;
      }),
    );
  });

  // Batch triage: every item runs the single-item rules (rights on the live record, never your own,
  // revisionHash for an approval, two-person counted per item). One refusal never stops the rest.
  r.post("/questions/batch", async (c) => {
    const f = await needFlag(c, "batch_review");
    if (f) return f;
    const body = await readObject(c);
    const items = body.items;
    if (!Array.isArray(items) || items.length < 1 || items.length > BATCH_MAX)
      throw bad("invalid_items");
    const ids = new Set<string>();
    const results: { id: string; ok: boolean; status: number; error?: string; reason?: string }[] =
      [];
    for (const raw of items) {
      const it = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
      const id = typeof it?.id === "string" ? it.id : "";
      if (!it || !QID.test(id) || ids.has(id)) throw bad("invalid_items");
      ids.add(id);
      try {
        const res = await resolveQuestion(c, id, {
          action: it.action,
          ...(it.revisionHash !== undefined ? { revisionHash: it.revisionHash } : {}),
          ...(it.seenChanges !== undefined ? { seenChanges: it.seenChanges } : {}),
          ...(it.note !== undefined ? { note: it.note } : {}),
        });
        const out = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
        results.push({
          id,
          ok: res.status < 300,
          status: res.status,
          ...(res.status >= 300
            ? { error: out.error ?? "refused", ...(out.reason ? { reason: out.reason } : {}) }
            : {}),
        });
      } catch (e) {
        if (!(e instanceof HTTPException)) throw e;
        results.push({ id, ok: false, status: e.status, error: e.message || "refused" });
      }
    }
    const ok = results.filter((x) => x.ok).length;
    return c.json({ results, ok, failed: results.length - ok });
  });

  r.post("/questions/:id", async (c) =>
    resolveQuestion(c, c.req.param("id") ?? "", await readObject(c)),
  );

  return r;
}
