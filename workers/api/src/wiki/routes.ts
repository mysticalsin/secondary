// /v1/wiki/*: the Living Wiki API (docs/DESIGN-LIVING-WIKI.md). Mounted once in ../routes.ts.
//
// `:ws` is a policy node id (an account, circle, department, or `core` for Company Global), or `me`
// for the caller's own Personal Brain wiki. Rules for every route here: the workspace must be in the
// caller's admitted view at content level (404 otherwise, so absence and denial look the same); the
// wiki is read from that workspace only; and every citation is re-checked for the caller before it
// leaves (a source the caller cannot read is dropped, with the claims that rested only on it).

import { type AdmittedView, canDoInView, personalRootId, type ViewNode } from "@secondary/policy";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { viewOf } from "../auth.ts";
import { checkSourceAccess } from "../connector.ts";
import type { CandidateInput } from "../routes.ts";
import { personalScope, scopeOfNode } from "../scope.ts";
import { workspaceStub } from "../stubs.ts";
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
import {
  citationsOf,
  claimLines,
  cleanText,
  GENERATED,
  generalise,
  linksOf,
  matchOfTokens,
  PAGE_ID,
  slug,
  summaryOf,
  tokensOf,
} from "./text.ts";
import { isPersonalScope, nodeOfScope, type PageDraft, type Proposal } from "./types.ts";

const WIKI_NODE_KINDS = new Set(["account", "circle", "department", "core"]);
const MAX_MD = 20_000;
const MAX_FANOUT = 40;
const RESTRICTED = "[restricted source]";

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
  if (f.code === "self_approval" || f.code === "not_author") return forbidden(c, f.message);
  return plainFail(c, f);
}

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
    await w.stub.wikiTouch(s.tenantId, w.scope, s.ctx.now);
    return w;
  }

  /** The workspaces the caller's wiki search reaches: admitted at content level, plus their own. */
  function admittedWikis(c: C): { param: string; nodeId: string; scope: string; label: string }[] {
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

  // ---- citations, re-checked for this caller ----

  type Readable = Map<string, { title: string; kind: "item" | "source" }>;

  async function readableSources(
    c: C,
    w: { view: AdmittedView; personal: boolean; stub: Stub },
    ids: string[],
  ): Promise<Readable> {
    const s = sess(c);
    const out: Readable = new Map();
    const unique = [...new Set(ids)];
    if (!unique.length) return out;
    const refs = await w.stub.wikiSourceRefs(unique);
    const passed = refs.filter(
      (x) => w.personal || w.view.nodes.get(x.gateNodeId)?.level === "content",
    );
    const files = passed.filter((x) => x.kind === "source");
    const confirmed = files.length
      ? await checkSourceAccess(
          c.env,
          s.tenantId,
          { id: s.principal.id, email: s.principal.email },
          files.map((x) => x.id),
        )
      : new Set<string>();
    for (const x of passed)
      if (x.kind === "item" || confirmed.has(x.id)) out.set(x.id, { title: x.title, kind: x.kind });
    return out;
  }

  /** The page text for this caller: unreadable citations are dropped, and so is a claim left with none. */
  function filterMarkdown(
    md: string,
    ok: Readable,
    canGlobal: boolean,
  ): { text: string; dropped: number } {
    let dropped = 0;
    const out: string[] = [];
    for (const line of md.split("\n")) {
      const cites = citationsOf(line);
      if (cites.length && !cites.some((x) => ok.has(x))) {
        dropped++;
        continue;
      }
      let t = line.replace(/\{src:([^}]+)\}/g, (m, id: string) => (ok.has(id) ? m : ""));
      if (!canGlobal) t = t.replace(/\[\[global:[A-Za-z0-9_-]+\]\]/g, "");
      out.push(t.replace(/[ \t]+$/g, ""));
    }
    return { text: out.join("\n"), dropped };
  }

  const canGlobal = (view: AdmittedView): boolean => view.nodes.get("core")?.level === "content";
  const citeMap = (ok: Readable, ids: string[]) =>
    Object.fromEntries(ids.filter((i) => ok.has(i)).map((i) => [i, ok.get(i)]));

  /** One line for a reviewer or a diff: the same rule, but the line stays so the diff keeps its shape. */
  const maskLine = (line: string, ok: Readable): string => {
    const cites = citationsOf(line);
    return cites.length && !cites.some((x) => ok.has(x))
      ? `- ${RESTRICTED}`
      : line.replace(/\{src:([^}]+)\}/g, (m, id: string) => (ok.has(id) ? m : ""));
  };

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
    const shown = pages.map((p) => {
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
    const ids = citationsOf(page.markdown);
    const ok = await readableSources(c, w, ids);
    const f = filterMarkdown(page.markdown, ok, canGlobal(w.view));
    const all = await w.stub.wikiIndex();
    const known = new Map(all.map((p) => [p.id, p.title]));
    const links = linksOf(f.text).flatMap((l) =>
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
      markdown: f.text,
      summary: summaryOf(f.text),
      citations: citeMap(ok, ids),
      restricted: f.dropped,
      links,
      uncited: claimLines(f.text).filter((x) => citationsOf(x.text).length === 0).length,
      updatedAt: new Date(page.updatedAt).toISOString(),
    });
  });

  r.get("/wiki/:ws/pages/:pid/history", async (c) => {
    const w = await open(c, c.req.param("ws"), "read");
    if (w instanceof Response) return w;
    const rows = await w.stub.wikiPageHistory(idOf(c.req.param("pid")));
    if (!rows.length) throw notFound();
    const ids = rows.flatMap((x) => x.diff.flatMap((d) => citationsOf(d.text)));
    const ok = await readableSources(c, w, ids);
    return c.json(
      rows.map((x) => ({
        revision: x.revision,
        title: x.title,
        actor: x.actor,
        at: new Date(x.at).toISOString(),
        proposalId: x.proposalId,
        diff: x.diff.map((d) => ({ type: d.type, text: maskLine(d.text, ok) })),
      })),
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
      const keep = f.sourceIds.filter((i) => ok.has(i));
      if (f.sourceIds.length && !keep.length) return [];
      return [
        {
          id: f.id,
          subject: f.subject,
          predicate: f.predicate,
          object: f.object,
          validAt: f.validAt,
          invalidAt: f.invalidAt,
          recordedAt: f.recordedAt,
          sources: keep.map((i) => ({ id: i, title: ok.get(i)?.title ?? i })),
          confidence: f.confidence,
          origin: f.origin,
          verifiedBy: f.verifiedBy,
          unverified: f.verifiedBy === null,
        },
      ];
    });
    return c.json(shown);
  });

  r.get("/wiki/:ws/log", async (c) => {
    const w = await open(c, c.req.param("ws"), "read");
    if (w instanceof Response) return w;
    return c.json(
      (await w.stub.wikiLog(100)).map((e) => ({
        ...e,
        detail: JSON.parse(e.detail) as unknown,
        at: new Date(e.at).toISOString(),
      })),
    );
  });

  // Search and ask: index first (page titles and summaries), then the pages, then the citations, all for this caller.
  async function searchIn(
    c: C,
    ws: { param: string; nodeId: string; scope: string; label: string },
    view: AdmittedView,
    tokens: string[],
    limit: number,
  ) {
    const s = sess(c);
    const personal = isPersonalScope(ws.scope);
    const stub = workspaceStub(c.env, s.tenantId, ws.scope);
    const hits = await stub.wikiSearch(matchOfTokens(tokens), limit);
    if (!hits.length) return [];
    const g = canGlobal(view);
    const w = { view, personal, stub };
    const out = [];
    for (const h of hits) {
      const page = await stub.wikiPage(h.id);
      if (!page) continue;
      const ok = await readableSources(c, w, citationsOf(page.markdown));
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
        ws: ws.param,
        label: ws.label,
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
    return out;
  }

  async function query(c: C, mode: "search" | "ask") {
    const q = c.req.query("q") ?? "";
    const tokens = tokensOf(q);
    if (!tokens.length || q.length > 300) throw bad("invalid_query");
    const param = c.req.param("ws") ?? "";
    const view = viewOf(sess(c));
    let targets: { param: string; nodeId: string; scope: string; label: string }[];
    if (param === "all") targets = admittedWikis(c);
    else {
      const w = await open(c, param, "read");
      if (w instanceof Response) return w;
      targets = [{ param: w.param, nodeId: w.nodeId, scope: w.scope, label: w.label }];
    }
    const lists = await Promise.all(targets.map((t) => searchIn(c, t, view, tokens, 10)));
    const results = lists
      .flat()
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

  const proposalView = async (c: C, w: Ws, id: string) => {
    const v = await w.stub.wikiProposalView(id);
    if (!v) throw notFound();
    const ids = [
      ...v.pages.flatMap((p) => [
        ...citationsOf(p.after),
        ...(p.before ? citationsOf(p.before) : []),
      ]),
      ...v.facts.flatMap((f) => f.sourceIds),
      ...v.sources.map((x) => x.id),
    ];
    const ok = await readableSources(c, w, ids);
    return {
      ...v,
      createdAt: new Date(v.createdAt).toISOString(),
      pages: v.pages.map((p) => ({
        ...p,
        before:
          p.before === null
            ? null
            : p.before
                .split("\n")
                .map((l) => maskLine(l, ok))
                .join("\n"),
        after: p.after
          .split("\n")
          .map((l) => maskLine(l, ok))
          .join("\n"),
        diff: p.diff.map((d) => ({ type: d.type, text: maskLine(d.text, ok) })),
      })),
      facts: v.facts.map((f) => ({
        ...f,
        object: f.sourceIds.length && !f.sourceIds.some((i) => ok.has(i)) ? RESTRICTED : f.object,
        sources: f.sourceIds
          .filter((i) => ok.has(i))
          .map((i) => ({ id: i, title: ok.get(i)?.title ?? i })),
      })),
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
    return c.json(
      (await w.stub.wikiProposals(status)).map((p) => ({
        ...p,
        createdAt: new Date(p.createdAt).toISOString(),
      })),
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
      !(await audit(c, {
        action: `wiki.${b.decision}`,
        nodeId: id,
        scopeId: w.scope,
        revision: null,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    const res = await w.stub.wikiDecide(id, b.decision, s.principal.id, s.ctx.now);
    if (!res.ok) return failResponse(c, res);
    return c.json({ ok: true, status: res.status, applied: res.applied });
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
    if (!(await audit(c, { action: "wiki.edit", nodeId: id, scopeId: w.scope, revision: null })))
      return c.json({ error: "audit_unavailable" }, 503);
    const res = await w.stub.wikiEditProposal(id, s.principal.id, pageId, md, s.ctx.now);
    if (!res.ok) return failResponse(c, res);
    return c.json({ ok: true });
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
      { plane: w.plane },
    );
    if (!res.ok) return failResponse(c, res);
    if (!res.created) return c.json({ error: "nothing_to_propose", reason: res.reason }, 422);
    return c.json({ ok: true, proposalId: res.id, status: "candidate" }, 201);
  });

  // A meeting record: structured decisions, commitments and risks. It is a raw source, and it queues an ingest.
  r.post("/wiki/:ws/meetings", async (c) => {
    const w = await open(c, c.req.param("ws"), "edit");
    if (w instanceof Response) return w;
    const s = sess(c);
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
    if (!(await w.stub.wikiVerifyFact(fid, s.principal.id, s.ctx.now))) throw notFound();
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
    const hay = `${title}\n${body}`.toLowerCase();
    if (
      title.length < 3 ||
      !body.trim() ||
      ids.some((x) => x.length >= 3 && hay.includes(x.toLowerCase()))
    )
      return c.json(
        {
          error: "deidentification_failed",
          reason: "The text could not be made free of account identifiers",
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
