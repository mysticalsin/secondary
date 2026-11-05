// /v1/wiki/*: the Living Wiki API (docs/DESIGN-LIVING-WIKI.md). Mounted once in ../routes.ts.
//
// `:ws` is a policy node id (an account, circle, department, or `core` for Company Global), or `me`
// for the caller's own Personal Brain wiki. Rules for every route here: the workspace must be in the
// caller's admitted view at content level (404 otherwise, so absence and denial look the same); the
// wiki is read from that workspace only; and every citation is re-checked for the caller before it
// leaves (a source the caller cannot read is dropped, with the claims that rested only on it).

import {
  type AdmittedView,
  canDoInView,
  personalRootId,
  roleAllows,
  type ViewNode,
} from "@secondary/policy";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { viewOf } from "../auth.ts";
import { directPublish } from "../brains/open.ts";
import { fieldsFor } from "../brains/fields.ts";
import { checkSourceAccess } from "../connector.ts";
import { humanIdsOf } from "../human.ts";
import type { CandidateInput } from "../routes.ts";
import { personalScope, scopeOfNode } from "../scope.ts";
import { detectSensitivity } from "../sensitivity.ts";
import { tenantStub, workspaceStub } from "../stubs.ts";
import type { AppDeps, AppEnv, Session } from "../types.ts";
import {
  audit,
  bad,
  type C,
  forbidden,
  NODE_ID,
  notFound,
  failResponse as plainFail,
  readObject,
  sess,
  text,
} from "../ux/util.ts";
import type { UserValidated } from "../workspace.ts";
import { runWikiJobs, type WikiApi } from "./engine.ts";
import { wikiNotify } from "./hooks.ts";
import { mayDecide } from "./review.ts";
import { HISTORY_MAX } from "./store.ts";
import {
  citationsOf,
  claimLines,
  cleanText,
  GENERATED,
  generalise,
  linksOf,
  matchOfTokens,
  PAGE_ID,
  residualIdentifiers,
  slug,
  summaryOf,
  tokensOf,
} from "./text.ts";
import { isPersonalScope, nodeOfScope, type PageDraft, type Proposal } from "./types.ts";

const WIKI_NODE_KINDS = new Set(["account", "circle", "department", "core"]);
const MAX_MD = 20_000;
const MAX_FANOUT = 40;
export const RESTRICTED = "restricted source";
/** Hit pages one query reads (M-05): the connector is asked once for all of their sources. */
const MAX_HIT_PAGES = 20;

export interface PromoteHelpers {
  submitCandidate: (c: C, view: AdmittedView, i: CandidateInput) => Promise<Response>;
  parseUserValidated: (v: unknown, s: Session, expectedRevision: number) => UserValidated;
}

type Stub = ReturnType<typeof workspaceStub>;
type Need = "read" | "contribute" | "edit" | "decide";
interface Ws {
  param: string;
  view: AdmittedView;
  vn: ViewNode | null;
  nodeId: string;
  scope: string;
  label: string;
  plane: string;
  personal: boolean;
  stub: Stub;
  can: { contribute: boolean; edit: boolean; decide: boolean };
}

/** Data-level refusals: a person deciding their own proposal is a 403, like everywhere else. */
function failResponse(
  c: C,
  f: { code: string; message: string; currentRevision?: number },
): Response {
  if (f.code === "self_approval" || f.code === "not_author")
    return c.json({ error: f.code, reason: f.message }, 403);
  if (f.code === "revision_required") return c.json({ error: f.code, reason: f.message }, 400);
  if (f.code === "generated_page") return c.json({ error: f.code, reason: f.message }, 422);
  return plainFail(c, f);
}

export type Readable = Map<string, { title: string; kind: "item" | "source" }>;

/** Connector answers for one request, so a file cited by many pages is asked about once. */
const accessCache = new WeakMap<object, Map<string, boolean>>();

/**
 * Which of the cited sources this caller may read right now: the gate node must be at content level
 * in their view, and a connector file needs the connector's explicit yes (fail closed). Several groups
 * (workspaces) share one connector call. Ids beyond what a workspace answers for count as unreadable.
 */
export async function readableMany(
  c: C,
  groups: { w: { view: AdmittedView; personal: boolean; stub: Stub }; ids: string[] }[],
): Promise<Readable[]> {
  const s = sess(c);
  const cache = accessCache.get(c.req.raw) ?? new Map<string, boolean>();
  accessCache.set(c.req.raw, cache);
  const perGroup = await Promise.all(
    groups.map(async (g) => {
      const unique = [...new Set(g.ids)];
      if (!unique.length) return [];
      const refs = await g.w.stub.wikiSourceRefs(unique);
      return refs.filter(
        (x) => g.w.personal || g.w.view.nodes.get(x.gateNodeId)?.level === "content",
      );
    }),
  );
  const need = [
    ...new Set(
      perGroup
        .flat()
        .filter((x) => x.kind === "source" && !cache.has(x.id))
        .map((x) => x.id),
    ),
  ];
  if (need.length) {
    // With the connector switched off no synced file counts as readable (M-04).
    const yes = s.switches.connector
      ? await checkSourceAccess(
          c.env,
          s.tenantId,
          { id: s.principal.id, email: s.principal.email },
          need,
        )
      : new Set<string>();
    for (const id of need) cache.set(id, yes.has(id));
  }
  return perGroup.map((passed) => {
    const out: Readable = new Map();
    for (const x of passed)
      if (x.kind === "item" || cache.get(x.id) === true)
        out.set(x.id, { title: x.title, kind: x.kind });
    return out;
  });
}

/** A line stands only on sources the caller can read: every citation must be readable (M-01). */
export const lineReadable = (line: string, ok: Readable): boolean =>
  citationsOf(line).every((x) => ok.has(x));

/** A page shows when it cites nothing, or when at least one cited source is readable (H-02). */
export const pageVisible = (cites: string[], ok: Readable): boolean =>
  cites.length === 0 || cites.some((x) => ok.has(x));

/** Text derived from these sources shows only to someone who can read all of them (H-02). */
export const sourcesReadable = (ids: readonly string[] | undefined, ok: Readable): boolean =>
  (ids ?? []).every((x) => ok.has(x));

/** The workspaces the caller's wiki search reaches: admitted at content level, plus their own. */
export function admittedWikis(
  c: C,
): { param: string; nodeId: string; scope: string; label: string }[] {
  const s = sess(c);
  const view = viewOf(s);
  const out = [
    {
      param: "me",
      nodeId: personalRootId(s.principal.id),
      scope: personalScope(s.principal.id),
      label: "My Secondary",
    },
  ];
  for (const vn of view.nodes.values()) {
    if (!WIKI_NODE_KINDS.has(vn.kind) || vn.level !== "content") continue;
    const scope = scopeOfNode(vn);
    if (scope) out.push({ param: vn.id, nodeId: vn.id, scope, label: vn.label });
  }
  return out.slice(0, MAX_FANOUT);
}

/** The page text for this caller: a line is kept only when every source it cites is readable (M-01). */
export function filterMarkdown(
  md: string,
  ok: Readable,
  canGlobal: boolean,
): { text: string; dropped: number } {
  let dropped = 0;
  const out: string[] = [];
  for (const line of md.split("\n")) {
    if (!lineReadable(line, ok)) {
      dropped++;
      continue;
    }
    const t = canGlobal ? line : line.replace(/\[\[global:[A-Za-z0-9_-]+\]\]/g, "");
    out.push(t.replace(/[ \t]+$/g, ""));
  }
  return { text: out.join("\n"), dropped };
}

export const canGlobal = (view: AdmittedView): boolean =>
  view.nodes.get("core")?.level === "content";

const idOf = (v: string | undefined): string => {
  if (!v || !PAGE_ID.test(v)) throw notFound();
  return v;
};

export function wikiRoutes(deps: AppDeps, helpers: PromoteHelpers): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  // ---- opening a workspace ----

  /** Resolve `:ws` for the caller. A Response is a refusal to return as is. */
  async function open(c: C, param: string, need: Need): Promise<Ws | Response> {
    const s = sess(c);
    const view = viewOf(s);
    let w: Ws;
    if (param === "me") {
      const scope = personalScope(s.principal.id);
      w = {
        param,
        view,
        vn: null,
        nodeId: personalRootId(s.principal.id),
        scope,
        label: "My Secondary",
        plane: "PERSONAL_HOSTED",
        personal: true,
        stub: workspaceStub(c.env, s.tenantId, scope),
        can: { contribute: true, edit: true, decide: true },
      };
    } else {
      if (!NODE_ID.test(param)) throw notFound();
      const vn = view.nodes.get(param);
      if (!vn || !WIKI_NODE_KINDS.has(vn.kind) || vn.level !== "content") throw notFound();
      const scope = scopeOfNode(vn);
      if (!scope) throw notFound();
      w = {
        param,
        view,
        vn,
        nodeId: vn.id,
        scope,
        label: vn.label,
        plane: vn.plane,
        personal: false,
        stub: workspaceStub(c.env, s.tenantId, scope),
        can: {
          contribute: canDoInView(view, s.principal, vn.id, "contribute").allowed,
          edit: canDoInView(view, s.principal, vn.id, "edit").allowed,
          decide: mayDecide(view, s.principal, vn.id).allowed,
        },
      };
    }
    if (need !== "read" && !w.can[need]) {
      const reason =
        need === "decide"
          ? mayDecide(view, s.principal, w.nodeId).reason
          : canDoInView(view, s.principal, w.nodeId, need === "edit" ? "edit" : "contribute")
              .reason;
      return forbidden(c, reason);
    }
    // A stored brain role only narrows what the policy allows (API-CONTRACT "v3 brains").
    if (need !== "read" && !w.personal) {
      const role = await w.stub.brainRoleOf(await humanIdsOf(c.env, s));
      const action = need === "decide" ? "review" : need === "edit" ? "edit" : "contribute";
      if (!roleAllows(role, action))
        return forbidden(c, "Your role in this brain does not allow this");
    }
    await w.stub.wikiTouch(s.tenantId, w.scope, s.ctx.now);
    return w;
  }

  // ---- citations, re-checked for this caller ----

  const readableSources = async (
    c: C,
    w: { view: AdmittedView; personal: boolean; stub: Stub },
    ids: string[],
  ): Promise<Readable> => (await readableMany(c, [{ w, ids }]))[0] as Readable;

  const citeMap = (ok: Readable, ids: string[]) =>
    Object.fromEntries(ids.filter((i) => ok.has(i)).map((i) => [i, ok.get(i)]));

  /** One line for a reviewer or a diff: the same rule, but the line stays so the diff keeps its shape. */
  const maskLine = (line: string, ok: Readable): string =>
    lineReadable(line, ok) ? line : `- ${RESTRICTED}`;
  const maskText = (text: string, ok: Readable): string =>
    text
      .split("\n")
      .map((l) => maskLine(l, ok))
      .join("\n");

  /** Pages whose every source is out of this caller's reach are not shown at all (H-02). */
  async function hiddenPages(
    c: C,
    w: { view: AdmittedView; personal: boolean; stub: Stub },
    ids?: string[],
  ): Promise<Set<string>> {
    const rows = await w.stub.wikiPageCitations(ids);
    const ok = await readableSources(
      c,
      w,
      rows.flatMap((r) => r.cites),
    );
    return new Set(rows.filter((r) => !pageVisible(r.cites, ok)).map((r) => r.id));
  }

  /** The wiki's own per-person limits (M-05). A Response is the refusal. */
  async function limited(c: C, kind: "search" | "write"): Promise<Response | null> {
    const s = sess(c);
    const raw = Number.parseInt(
      (kind === "search" ? c.env.WIKI_SEARCH_PER_MIN : c.env.WIKI_WRITE_PER_MIN) ?? "",
      10,
    );
    const limit = Number.isFinite(raw) && raw > 0 ? raw : 30;
    const res = await tenantStub(c.env, s.tenantId).hit(
      `wiki_${kind}:${s.principal.id}`,
      s.ctx.now,
      limit,
    );
    if (!res.limited) return null;
    c.header("Retry-After", String(res.retryAfter));
    return c.json({ error: "rate_limited" }, 429);
  }

  // ---- reads ----

  r.get("/wiki/health", async (c) => {
    const s = sess(c);
    const rows = await Promise.all(
      admittedWikis(c).map(async (x) => {
        const h = await workspaceStub(c.env, s.tenantId, x.scope).wikiHealth(s.ctx.now);
        return h ? { ws: x.param, nodeId: x.nodeId, label: x.label, ...h } : null;
      }),
    );
    return c.json(rows.filter((x) => x !== null));
  });

  r.get("/wiki/:ws/index", async (c) => {
    const w = await open(c, c.req.param("ws"), "read");
    if (w instanceof Response) return w;
    const s = sess(c);
    const index = await w.stub.wikiIndex();
    const pages = await w.stub.wikiPages();
    const ids = pages.flatMap((p) => citationsOf(p.markdown));
    const ok = await readableSources(c, w, ids);
    const g = canGlobal(w.view);
    const shown = pages
      .filter((p) => pageVisible(citationsOf(p.markdown), ok))
      .map((p) => {
        const f = filterMarkdown(p.markdown, ok, g);
        return {
          id: p.id,
          title: p.title,
          type: p.type,
          summary: summaryOf(f.text),
          revision: p.revision,
          updatedAt: new Date(p.updatedAt).toISOString(),
          restricted: f.dropped,
        };
      });
    const order = new Map(index.map((p, i) => [p.id, i]));
    shown.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    const meta = await w.stub.wikiMeta();
    return c.json({
      ws: w.param,
      nodeId: w.nodeId,
      label: w.label,
      personal: w.personal,
      pages: shown,
      schema: await w.stub.wikiSchema(),
      health: await w.stub.wikiHealth(s.ctx.now),
      settings: {
        autoAccept: meta?.autoAccept ?? false,
        freshnessDays: meta?.freshnessDays ?? 180,
      },
      can: {
        ...w.can,
        promote:
          !w.personal &&
          w.vn?.kind === "account" &&
          canDoInView(w.view, s.principal, "core", "contribute").allowed,
      },
    });
  });

  r.get("/wiki/:ws/pages/:pid", async (c) => {
    const w = await open(c, c.req.param("ws"), "read");
    if (w instanceof Response) return w;
    const rev = c.req.query("rev");
    const revision = rev === undefined ? undefined : Number(rev);
    if (revision !== undefined && (!Number.isInteger(revision) || revision < 1))
      throw bad("invalid_revision");
    const page = await w.stub.wikiPage(idOf(c.req.param("pid")), revision);
    if (!page || (page.status !== "published" && revision === undefined)) throw notFound();
    // A hidden version is for editors only (API-CONTRACT "Hidden versions").
    if (page.hidden && !w.can.edit) throw notFound();
    const ids = citationsOf(page.markdown);
    const ok = await readableSources(c, w, ids);
    // A page with no readable source is not here for this caller.
    if (!pageVisible(ids, ok)) throw notFound();
    const f = filterMarkdown(page.markdown, ok, canGlobal(w.view));
    const all = await w.stub.wikiIndex();
    const hidden = await hiddenPages(c, w, linksOf(f.text));
    const known = new Map(all.filter((p) => !hidden.has(p.id)).map((p) => [p.id, p.title]));
    const linkText = f.text.replace(/\[\[([A-Za-z0-9:_-]{1,70})\]\]/g, (m, id: string) =>
      hidden.has(id) ? "" : m,
    );
    const links = linksOf(linkText).flatMap((l) =>
      l.startsWith("global:")
        ? [{ id: l, title: l.slice(7), local: false }]
        : known.has(l)
          ? [{ id: l, title: known.get(l) as string, local: true }]
          : [{ id: l, title: l, local: true, broken: true }],
    );
    return c.json({
      id: page.id,
      type: page.type,
      title: page.title,
      revision: page.revision,
      current: page.current,
      markdown: linkText,
      summary: summaryOf(linkText),
      origin: page.origin,
      citations: citeMap(ok, ids),
      restricted: f.dropped,
      links,
      uncited: claimLines(linkText).filter((x) => citationsOf(x.text).length === 0).length,
      updatedAt: new Date(page.updatedAt).toISOString(),
      fields: await fieldsFor(c, w, page),
    });
  });

  r.get("/wiki/:ws/pages/:pid/history", async (c) => {
    const w = await open(c, c.req.param("ws"), "read");
    if (w instanceof Response) return w;
    const pid = idOf(c.req.param("pid"));
    const lim = c.req.query("limit");
    const before = c.req.query("before");
    const limit = lim === undefined ? undefined : Number(lim);
    const cursor = before === undefined ? undefined : Number(before);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > HISTORY_MAX))
      throw bad("invalid_limit");
    if (cursor !== undefined && (!Number.isInteger(cursor) || cursor < 1))
      throw bad("invalid_before");
    const cur = await w.stub.wikiPage(pid);
    const { revisions, next } = await w.stub.wikiPageHistory(pid, {
      ...(limit !== undefined ? { limit } : {}),
      ...(cursor !== undefined ? { before: cursor } : {}),
    });
    if (!cur || !revisions.length) throw notFound();
    const texts = revisions.map((x) =>
      x.diff
        .filter((d) => d.type !== "del")
        .map((d) => d.text)
        .join("\n"),
    );
    const ids = [
      ...revisions.flatMap((x) => x.diff.flatMap((d) => citationsOf(d.text))),
      ...citationsOf(cur.markdown),
    ];
    const ok = await readableSources(c, w, ids);
    if (!pageVisible(citationsOf(cur.markdown), ok)) throw notFound();
    if (next !== null) c.header("X-Next-Before", String(next));
    // Hidden versions are for editors only. For anyone else a hidden revision shows no text, and the
    // revision after it shows no removed line (those lines are the hidden text).
    const editor = w.can.edit;
    return c.json(
      revisions.map((x, i) =>
        x.hidden && !editor
          ? { revision: x.revision, hidden: true, at: new Date(x.at).toISOString(), diff: [] }
          : {
              revision: x.revision,
              // A title is a claim of what the revision cites.
              title: pageVisible(citationsOf(texts[i] as string), ok) ? x.title : RESTRICTED,
              actor: x.actor,
              at: new Date(x.at).toISOString(),
              proposalId: x.proposalId,
              hidden: x.hidden,
              diff: x.diff.flatMap((d) =>
                x.prevHidden && !editor && d.type === "del"
                  ? []
                  : [{ type: d.type, text: maskLine(d.text, ok) }],
              ),
            },
      ),
    );
  });

  r.get("/wiki/:ws/facts", async (c) => {
    const w = await open(c, c.req.param("ws"), "read");
    if (w instanceof Response) return w;
    const subject = c.req.query("subject");
    const facts = await w.stub.wikiFacts({
      ...(subject ? { subject: cleanText(subject, 200) } : {}),
      validOnly: c.req.query("all") !== "1",
      limit: 500,
    });
    const ok = await readableSources(
      c,
      w,
      facts.flatMap((f) => f.sourceIds),
    );
    const shown = facts.flatMap((f) => {
      if (f.sourceIds.length && !sourcesReadable(f.sourceIds, ok)) return [];
      return [
        {
          id: f.id,
          subject: f.subject,
          predicate: f.predicate,
          object: f.object,
          validAt: f.validAt,
          invalidAt: f.invalidAt,
          recordedAt: f.recordedAt,
          sources: f.sourceIds.map((i) => ({ id: i, title: ok.get(i)?.title ?? i })),
          confidence: f.confidence,
          origin: f.origin,
          verifiedBy: f.verifiedBy,
          unverified: f.verifiedBy === null,
        },
      ];
    });
    return c.json(shown);
  });

  // The log stores ids. A proposal's title is looked up here, for this caller, and shown only when
  // every source it was drawn from is readable; page ids of hidden pages are left out.
  r.get("/wiki/:ws/log", async (c) => {
    const w = await open(c, c.req.param("ws"), "read");
    if (w instanceof Response) return w;
    const entries = (await w.stub.wikiLog(100)).map((e) => ({
      ...e,
      detail: JSON.parse(e.detail) as Record<string, unknown>,
    }));
    const proposalIds = [
      ...new Set(
        entries.flatMap((e) => (typeof e.detail.id === "string" ? [e.detail.id as string] : [])),
      ),
    ];
    const titles = new Map(
      (await w.stub.wikiProposalTitles(proposalIds)).map((t) => [t.id, t] as const),
    );
    const pageIds = [
      ...new Set(
        entries.flatMap((e) =>
          Array.isArray(e.detail.pages)
            ? (e.detail.pages as unknown[]).filter((x): x is string => typeof x === "string")
            : typeof e.detail.pageId === "string"
              ? [e.detail.pageId as string]
              : [],
        ),
      ),
    ];
    const hidden = await hiddenPages(c, w, pageIds);
    const ok = await readableSources(c, w, [
      ...[...titles.values()].flatMap((t) => t.titleSources),
      ...entries.flatMap((e) =>
        Array.isArray(e.detail.sourceIds) ? (e.detail.sourceIds as string[]) : [],
      ),
    ]);
    return c.json(
      entries.map((e) => {
        const d: Record<string, unknown> = { ...e.detail };
        // Older entries stored the title itself: it is never trusted, it is looked up again.
        delete d.title;
        const t = typeof d.id === "string" ? titles.get(d.id) : undefined;
        if (t && e.kind.endsWith(".proposed"))
          d.title = sourcesReadable(t.titleSources, ok) ? t.title : RESTRICTED;
        if (Array.isArray(d.sourceIds))
          d.sourceIds = (d.sourceIds as string[]).filter((i) => ok.has(i));
        if (Array.isArray(d.pages)) d.pages = (d.pages as string[]).filter((x) => !hidden.has(x));
        if (typeof d.pageId === "string" && hidden.has(d.pageId)) d.pageId = RESTRICTED;
        return { ...e, detail: d, at: new Date(e.at).toISOString() };
      }),
    );
  });

  // Search and ask: index first (page titles and summaries), then the pages, then the citations, all for
  // this caller. One query reads at most MAX_HIT_PAGES pages and asks the connector once (M-05).
  type Target = { param: string; nodeId: string; scope: string; label: string };
  async function query(c: C, mode: "search" | "ask") {
    const q = c.req.query("q") ?? "";
    const tokens = tokensOf(q);
    if (!tokens.length || q.length > 300) throw bad("invalid_query");
    const param = c.req.param("ws") ?? "";
    const view = viewOf(sess(c));
    let targets: Target[];
    if (param === "all") targets = admittedWikis(c);
    else {
      const w = await open(c, param, "read");
      if (w instanceof Response) return w;
      targets = [{ param: w.param, nodeId: w.nodeId, scope: w.scope, label: w.label }];
    }
    const refused = await limited(c, "search");
    if (refused) return refused;
    const s = sess(c);
    const match = matchOfTokens(tokens);
    const found = (
      await Promise.all(
        targets.map(async (ws) => {
          const stub = workspaceStub(c.env, s.tenantId, ws.scope);
          const hits = await stub.wikiSearch(match, 10);
          return hits.map((h) => ({ ws, stub, personal: isPersonalScope(ws.scope), ...h }));
        }),
      )
    )
      .flat()
      .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id))
      .slice(0, MAX_HIT_PAGES);
    const pages = await Promise.all(found.map((h) => h.stub.wikiPage(h.id)));
    const oks = await readableMany(
      c,
      found.map((h, i) => ({
        w: { view, personal: h.personal, stub: h.stub },
        ids: citationsOf(pages[i]?.markdown ?? ""),
      })),
    );
    const g = canGlobal(view);
    const out = [];
    for (const [i, h] of found.entries()) {
      const page = pages[i];
      const ok = oks[i] as Readable;
      if (!page || !pageVisible(citationsOf(page.markdown), ok)) continue;
      const f = filterMarkdown(page.markdown, ok, g);
      const hay = `${page.title}\n${f.text}`.toLowerCase();
      // A hit must stand on text this caller can read, not on a claim that was dropped.
      if (!tokens.some((t) => hay.includes(t))) continue;
      const lines = claimLines(f.text)
        .map((l) => ({
          ...l,
          score: tokens.filter((t) => l.text.toLowerCase().includes(t)).length,
        }))
        .filter((l) => l.score > 0)
        .sort((a, b) => b.score - a.score || a.line - b.line);
      out.push({
        ws: h.ws.param,
        label: h.ws.label,
        pageId: page.id,
        title: page.title,
        type: page.type,
        summary: summaryOf(f.text),
        rank: h.rank,
        lines: lines.slice(0, 5).map((l) => ({
          text: l.text.replace(/\{src:[^}]+\}/g, "").trim(),
          citations: citationsOf(l.text).map((i) => ({ id: i, title: ok.get(i)?.title ?? i })),
        })),
        restricted: f.dropped,
      });
    }
    const results = out
      .sort((a, b) => a.rank - b.rank || a.pageId.localeCompare(b.pageId))
      .slice(0, 15);
    if (mode === "search") return c.json({ results: results.map(({ rank: _r, ...x }) => x) });
    const lines = results.flatMap((x) =>
      x.lines.map((l) => ({ ...l, ws: x.ws, pageId: x.pageId, page: x.title })),
    );
    const supported = lines.filter((l) => l.citations.length > 0).slice(0, 6);
    return c.json({
      unknown: supported.length === 0,
      answer: supported.length ? supported : null,
      reason: supported.length
        ? null
        : "The wiki holds nothing, that you may read, that supports an answer.",
      pages: results.map((x) => ({ ws: x.ws, id: x.pageId, title: x.title })),
    });
  }

  r.get("/wiki/:ws/search", (c) => query(c, "search"));
  r.get("/wiki/:ws/ask", (c) => query(c, "ask"));

  // ---- proposals (the wiki review) ----

  /** Everything derived from a source this caller cannot read is replaced by "restricted source". */
  const proposalView = async (c: C, w: Ws, id: string) => {
    const v = await w.stub.wikiProposalView(id);
    if (!v) throw notFound();
    const ids = [
      ...v.titleSources,
      ...v.pages.flatMap((p) => [
        ...citationsOf(p.after),
        ...(p.before ? citationsOf(p.before) : []),
      ]),
      ...v.facts.flatMap((f) => f.sourceIds),
      ...v.invalidate.flatMap((i) => i.sourceIds),
      ...v.sources.map((x) => x.id),
    ];
    const ok = await readableSources(c, w, ids);
    const whole = sourcesReadable(v.titleSources, ok);
    const hide = (text: string): string => (whole ? text : RESTRICTED);
    const { titleSources: _t, ...rest } = v;
    return {
      ...rest,
      title: hide(v.title),
      rationale: hide(v.rationale),
      detail: v.detail ? hide(v.detail) : "",
      createdAt: new Date(v.createdAt).toISOString(),
      pages: v.pages.map((p) => ({
        ...p,
        title: pageVisible(citationsOf(p.after), ok) ? p.title : RESTRICTED,
        before: p.before === null ? null : maskText(p.before, ok),
        after: maskText(p.after, ok),
        diff: p.diff.map((d) => ({ type: d.type, text: maskLine(d.text, ok) })),
      })),
      facts: v.facts.map((f) => {
        const readable = !f.sourceIds.length || sourcesReadable(f.sourceIds, ok);
        // The excerpt is the source's own words: it follows the same rule as the fact text (L-07).
        const { excerpt, ...bare } = f;
        return {
          ...bare,
          ...(readable && excerpt ? { excerpt } : {}),
          subject: readable ? f.subject : RESTRICTED,
          object: readable ? f.object : RESTRICTED,
          sources: f.sourceIds
            .filter((i) => ok.has(i))
            .map((i) => ({ id: i, title: ok.get(i)?.title ?? i })),
        };
      }),
      invalidate: v.invalidate.map(({ sourceIds, ...i }) =>
        !sourceIds.length || sourcesReadable(sourceIds, ok)
          ? i
          : { ...i, subject: RESTRICTED, object: RESTRICTED },
      ),
      sources: v.sources
        .filter((x) => ok.has(x.id))
        .map((x) => ({ ...x, title: ok.get(x.id)?.title ?? x.id })),
    };
  };

  r.get("/wiki/:ws/proposals", async (c) => {
    const w = await open(c, c.req.param("ws"), "decide");
    if (w instanceof Response) return w;
    const status = c.req.query("status") ?? "candidate";
    if (!["candidate", "approved", "rejected"].includes(status)) throw bad("invalid_status");
    const list = await w.stub.wikiProposals(status);
    const ok = await readableSources(
      c,
      w,
      list.flatMap((p) => p.titleSources),
    );
    return c.json(
      list.map(({ titleSources, ...p }) => {
        const whole = sourcesReadable(titleSources, ok);
        return {
          ...p,
          title: whole ? p.title : RESTRICTED,
          detail: whole ? p.detail : RESTRICTED,
          createdAt: new Date(p.createdAt).toISOString(),
        };
      }),
    );
  });

  r.get("/wiki/:ws/proposals/:id", async (c) => {
    const w = await open(c, c.req.param("ws"), "decide");
    if (w instanceof Response) return w;
    const id = c.req.param("id");
    if (!NODE_ID.test(id)) throw notFound();
    return c.json(await proposalView(c, w, id));
  });

  r.post("/wiki/:ws/proposals/:id/decide", async (c) => {
    const w = await open(c, c.req.param("ws"), "decide");
    if (w instanceof Response) return w;
    const s = sess(c);
    const id = c.req.param("id");
    if (!NODE_ID.test(id)) throw notFound();
    const b = await readObject(c);
    if (b.decision !== "approve" && b.decision !== "reject") throw bad("invalid_decision");
    if (
      b.revisionHash !== undefined &&
      (typeof b.revisionHash !== "string" || b.revisionHash.length > 128)
    )
      throw bad("invalid_revision_hash");
    if (
      !(await audit(c, {
        action: `wiki.${b.decision}`,
        nodeId: id,
        scopeId: w.scope,
        revision: null,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    const res = await w.stub.wikiDecide(id, b.decision, s.principal.id, s.ctx.now, {
      ...(typeof b.revisionHash === "string" ? { revisionHash: b.revisionHash } : {}),
      sameHuman: await humanIdsOf(c.env, s),
    });
    if (!res.ok) return failResponse(c, res);
    return c.json({
      ok: true,
      status: res.status,
      applied: res.applied,
      approvals: res.approvals,
      required: res.required,
    });
  });

  r.post("/wiki/:ws/proposals/:id/edit", async (c) => {
    const w = await open(c, c.req.param("ws"), "decide");
    if (w instanceof Response) return w;
    const s = sess(c);
    const id = c.req.param("id");
    if (!NODE_ID.test(id)) throw notFound();
    const b = await readObject(c);
    const pageId = idOf(typeof b.pageId === "string" ? b.pageId : undefined);
    const md = text(b.markdown, 1, MAX_MD, "invalid_markdown");
    const refused = await limited(c, "write");
    if (refused) return refused;
    if (!(await audit(c, { action: "wiki.edit", nodeId: id, scopeId: w.scope, revision: null })))
      return c.json({ error: "audit_unavailable" }, 503);
    // The editor may cite only what they can read themselves.
    const mine = await readableSources(c, w, citationsOf(md));
    const res = await w.stub.wikiEditProposal(id, s.principal.id, pageId, md, s.ctx.now, [
      ...mine.keys(),
    ]);
    if (!res.ok) return failResponse(c, res);
    return c.json({ ok: true, revision: res.revision });
  });

  // A person (or an assistant through MCP) proposes a page. It waits in the review queue like any other.
  r.post("/wiki/:ws/propose", async (c) => {
    const w = await open(c, c.req.param("ws"), "contribute");
    if (w instanceof Response) return w;
    const s = sess(c);
    const b = await readObject(c);
    const title = cleanText(text(b.title, 1, 120, "invalid_title"), 120);
    const md = text(b.markdown, 1, MAX_MD, "invalid_markdown");
    const schema = await w.stub.wikiSchema();
    const type = typeof b.type === "string" ? b.type : "topic";
    if (!schema.types[type] || GENERATED[type]) throw bad("invalid_type");
    const pageId = typeof b.pageId === "string" ? idOf(b.pageId) : slug(title);
    if (!PAGE_ID.test(pageId)) throw bad("invalid_title");
    const cur = await w.stub.wikiPage(pageId);
    const draft: PageDraft = {
      pageId,
      type: cur?.type ?? type,
      title,
      baseRevision: cur?.revision ?? null,
      markdown: md,
    };
    const refused = await limited(c, "write");
    if (refused) return refused;
    // A person cites only what they can read themselves (L-01).
    const mine = await readableSources(c, w, citationsOf(md));
    if (
      !(await audit(c, {
        action: "wiki.propose",
        nodeId: w.nodeId,
        scopeId: w.scope,
        revision: null,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    const res = await w.stub.wikiPropose(
      {
        kind: "wiki_ingest",
        title: `${cur ? "Edit" : "New page"}: ${title}`,
        rationale: "proposed by a person",
        origin: "human",
        pages: [draft],
        facts: [],
        invalidate: [],
        confirm: [],
        archive: [],
        reingest: [],
        sources: [],
        findingKey: null,
      } satisfies Omit<Proposal, "v" | "pages"> & { pages: PageDraft[] },
      s.principal.id,
      s.ctx.now,
      {
        plane: w.plane,
        readable: [...mine.keys()],
        ...((await directPublish(c, w)) ? { publishDirect: true } : {}),
      },
    );
    if (!res.ok) return failResponse(c, res);
    if (!res.created) return c.json({ error: "nothing_to_propose", reason: res.reason }, 422);
    return c.json(
      { ok: true, proposalId: res.id, status: res.autoAccepted ? "published" : "candidate" },
      201,
    );
  });

  // A meeting record: structured decisions, commitments and risks. It is a raw source, and it queues an ingest.
  r.post("/wiki/:ws/meetings", async (c) => {
    const w = await open(c, c.req.param("ws"), "edit");
    if (w instanceof Response) return w;
    const s = sess(c);
    const refused = await limited(c, "write");
    if (refused) return refused;
    const b = await readObject(c);
    const title = text(b.title, 1, 200, "invalid_title");
    const date =
      typeof b.date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(b.date) &&
      !Number.isNaN(Date.parse(b.date))
        ? b.date
        : null;
    if (b.date !== undefined && b.date !== null && !date) throw bad("invalid_date");
    const list = (v: unknown, keys: string[]): Record<string, string>[] => {
      if (v === undefined) return [];
      if (!Array.isArray(v) || v.length > 30) throw bad("invalid_list");
      return v.map((x) => {
        if (!x || typeof x !== "object") throw bad("invalid_list");
        const o: Record<string, string> = {
          title: text((x as Record<string, unknown>).title, 3, 160, "invalid_list"),
        };
        for (const k of keys) {
          const val = (x as Record<string, unknown>)[k];
          if (val !== undefined && val !== null && val !== "")
            o[k] = text(val, 1, 120, "invalid_list");
        }
        return o;
      });
    };
    const notes = b.notes === undefined ? "" : text(b.notes, 0, 4_000, "invalid_notes");
    const body = JSON.stringify({
      title,
      ...(date ? { date } : {}),
      decisions: list(b.decisions, ["status", "owner"]),
      commitments: list(b.commitments, ["owner", "due", "status"]),
      risks: list(b.risks, ["severity", "status"]),
      ...(notes ? { notes } : {}),
    });
    if (
      !(await audit(c, { action: "wiki.meeting", nodeId: w.nodeId, scopeId: w.scope, revision: 1 }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    const made = await w.stub.create(
      {
        id: `mtg:${w.nodeId}:${crypto.randomUUID().slice(0, 8)}`.toLowerCase(),
        label: title,
        kind: "meeting_record",
        plane: w.plane,
        origin: "record",
        status: "recorded",
        authorId: s.principal.id,
        body,
        tags: ["meeting"],
      },
      s.ctx.now,
    );
    if ("ok" in made) return failResponse(c, made);
    await wikiNotify(c.env, s.tenantId, w.scope, [made.id], s.ctx.now);
    return c.json({ id: made.id, title, queued: true }, 201);
  });

  // Run what is due now: ingest jobs, and lint or dreaming on demand. Under the workspace's own identity.
  r.post("/wiki/:ws/run", async (c) => {
    const w = await open(c, c.req.param("ws"), "decide");
    if (w instanceof Response) return w;
    const s = sess(c);
    let b: Record<string, unknown> = {};
    const raw = await c.req.text();
    if (raw.trim()) {
      try {
        const v: unknown = JSON.parse(raw);
        if (v && typeof v === "object" && !Array.isArray(v)) b = v as Record<string, unknown>;
      } catch {
        throw bad("invalid_json");
      }
    }
    const refused = await limited(c, "write");
    if (refused) return refused;
    const asked = Array.isArray(b.jobs)
      ? b.jobs.filter((j): j is "lint" | "dream" => j === "lint" || j === "dream")
      : [];
    if (
      !(await audit(c, { action: "wiki.run", nodeId: w.nodeId, scopeId: w.scope, revision: null }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    for (const j of asked) await w.stub.wikiEnqueue(j, {}, s.ctx.now, s.ctx.now);
    const results = await runWikiJobs(w.stub as unknown as WikiApi, {
      env: c.env,
      now: s.ctx.now,
      dueAt: Number.MAX_SAFE_INTEGER,
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
      ...(deps.sleep ? { sleep: deps.sleep } : {}),
    });
    return c.json({ ok: true, results });
  });

  r.post("/wiki/:ws/facts/:fid/verify", async (c) => {
    const w = await open(c, c.req.param("ws"), "decide");
    if (w instanceof Response) return w;
    const fid = Number(c.req.param("fid"));
    if (!Number.isInteger(fid) || fid < 1) throw notFound();
    const s = sess(c);
    if (
      !(await audit(c, {
        action: "wiki.verify",
        nodeId: w.nodeId,
        scopeId: w.scope,
        revision: null,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    const res = await w.stub.wikiVerifyFact(fid, s.principal.id, s.ctx.now);
    if (!res.ok) return failResponse(c, res);
    return c.json({ ok: true });
  });

  r.put("/wiki/:ws/settings", async (c) => {
    const w = await open(c, c.req.param("ws"), "decide");
    if (w instanceof Response) return w;
    const b = await readObject(c);
    const patch: { autoAccept?: boolean; freshnessDays?: number } = {};
    if (b.autoAccept !== undefined) {
      // Auto-accept is the owner's choice for their own wiki. A shared wiki always goes through review.
      if (typeof b.autoAccept !== "boolean" || !w.personal) throw bad("invalid_setting");
      patch.autoAccept = b.autoAccept;
    }
    if (b.freshnessDays !== undefined) {
      if (typeof b.freshnessDays !== "number" || !Number.isInteger(b.freshnessDays))
        throw bad("invalid_setting");
      patch.freshnessDays = b.freshnessDays;
    }
    if (
      !(await audit(c, {
        action: "wiki.settings",
        nodeId: w.nodeId,
        scopeId: w.scope,
        revision: null,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    await w.stub.wikiSetSettings(patch);
    const meta = await w.stub.wikiMeta();
    return c.json({
      autoAccept: meta?.autoAccept ?? false,
      freshnessDays: meta?.freshnessDays ?? 180,
    });
  });

  // ---- Promote to Global ----

  r.post("/wiki/:ws/pages/:pid/promote", async (c) => {
    const w = await open(c, c.req.param("ws"), "read");
    if (w instanceof Response) return w;
    if (w.personal || w.vn?.kind !== "account")
      return c.json(
        { error: "not_an_account_wiki", reason: "Only a page of an account wiki can be promoted" },
        422,
      );
    const s = sess(c);
    const page = await w.stub.wikiPage(idOf(c.req.param("pid")));
    if (page?.status !== "published" || page.type === "overview") throw notFound();
    const b = await readObject(c);
    const ids = [w.vn.id, w.vn.label, w.scope, ...(w.vn.account ? [w.vn.account] : [])];
    const title = generalise(
      typeof b.title === "string" && b.title.trim() ? b.title : page.title,
      ids,
    )
      .replace(/\s+/g, " ")
      .slice(0, 200);
    // Only what this caller may read: a claim resting on sources they cannot open never reaches Global.
    const readable = await readableSources(c, w, citationsOf(page.markdown));
    const body = generalise(filterMarkdown(page.markdown, readable, false).text, ids).slice(
      0,
      8_000,
    );
    // Nothing that names the client may survive, and the server's own scan must find no contact
    // detail. A promoter cannot acknowledge a contact flag away: the copy is refused instead (M-04).
    const residual = residualIdentifiers(`${title}\n${body}`, ids);
    const contact = detectSensitivity({ title, body }).some(
      (f) => f.type === "email" || f.type === "phone",
    );
    if (title.length < 3 || !body.trim() || residual.length || contact)
      return c.json(
        {
          error: "deidentification_failed",
          reason: "The text could not be made free of account identifiers",
          residual: [...residual, ...(contact ? ["contact detail"] : [])],
        },
        422,
      );
    let userValidated: UserValidated;
    try {
      userValidated = helpers.parseUserValidated(b.user_validated, s, 1);
    } catch (e) {
      if (e instanceof HTTPException && e.status === 422)
        return c.json({ error: "user_validation_required", preview: { title, body } }, 422);
      throw e;
    }
    const acknowledged = Array.isArray(b.acknowledged_flags)
      ? b.acknowledged_flags.filter((x): x is string => typeof x === "string").slice(0, 100)
      : [];
    const res = await helpers.submitCandidate(c, w.view, {
      targetNodeId: "core",
      title,
      body,
      userValidated,
      acknowledged,
      releaseTarget: "global",
    });
    if (res.status === 201) {
      const made = (await res.clone().json()) as { candidateId: string };
      const g = workspaceStub(c.env, s.tenantId, "global");
      await g.wikiTouch(s.tenantId, "global", s.ctx.now);
      await g.wikiRegisterPromotion(made.candidateId, title, s.ctx.now);
      await w.stub.wikiLogAppend(
        s.principal.id,
        "promotion.requested",
        { pageId: page.id },
        s.ctx.now,
      );
    }
    return res;
  });

  return r;
}

export { nodeOfScope };
