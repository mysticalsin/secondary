// The five read-only tools of My Agent (AGENT_TOOLS in the contract). Each one runs with the CALLER's
// rights and nothing else: a brain is reachable only if `brainOf` opened it for this caller, a page only
// if the wiki's own readable check lets this caller see it, a line only if every source it cites is
// readable. A brain the caller cannot open answers `not_found`, the same as one that does not exist.
//
// What a tool returns is text pulled from pages, so it goes back to the model inside
// `<data brain=".." page="..">..</data>` with every `<` escaped (titles too): nothing in a page can
// close the block or open a tag. The model is told that block is data, never instructions.

import {
  AGENT_TOOLS,
  type AgentToolName,
} from "../../../../packages/contracts/src/agent-ui/index.ts";
import {
  ACTIVITY_DAYS,
  buildConstellation,
  buildFlow,
  DOT_CAP,
  type PageIn,
} from "../brains/insights.ts";
import { DAY } from "../brains/model.ts";
import type { Brain } from "../brains/open.ts";
import { SKIP_TYPES, seeBrains } from "../brains/shared.ts";
import { recordGaps } from "../gaps/index.ts";
import type { C } from "../ux/util.ts";
import { canGlobal, filterMarkdown, pageVisible, readableMany } from "../wiki/routes.ts";
import {
  citationsOf,
  matchOfTokens,
  summaryOf,
  titleOfSubject,
  tokensOf,
  withoutCitations,
} from "../wiki/text.ts";

/** Page text a tool hands back, in characters. */
export const READ_PAGE_CHARS = 3_000;
const MAX_SEARCH_HITS = 12;
const MAX_FACTS = 25;

export interface ToolResult {
  content: string;
  isError: boolean;
}

export interface ToolEnv {
  c: C;
  /** The brains this turn's tools may reach: opened for the caller, minus Personal and contract-refused accounts. */
  brains: readonly Brain[];
  /** The one brain the asker named (an action value or a brain name in their own words). A brain the model picks never counts (N-1). */
  askedBrain?: string;
}

/** Every `<` becomes `&lt;`, so text cannot close or open anything. */
export const esc = (s: string): string => s.replace(/</g, "&lt;");

const attr = (v: string): string => v.replace(/[^A-Za-z0-9_.:*-]/g, "");

/** One data block. Ids are checked words (never page text); the body is escaped. */
export const dataBlock = (brain: string, page: string | null, text: string): string =>
  `<data brain="${attr(brain)}"${page ? ` page="${attr(page)}"` : ""}>${esc(text)}</data>`;

const ok = (content: string): ToolResult => ({ content, isError: false });
const notFound = (): ToolResult => ok("not_found");
const bad = (why: string): ToolResult => ({ content: `invalid input: ${why}`, isError: true });

const pageIn = (p: {
  id: string;
  type: string;
  title: string;
  summary: string;
  markdown: string;
  createdAt: number;
  updatedAt: number;
}): PageIn => ({
  id: p.id,
  type: p.type,
  title: p.title,
  summary: p.summary,
  markdown: p.markdown,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
});

function brainIn(env: ToolEnv, id: string): Brain | null {
  return env.brains.find((b) => b.param === id) ?? null;
}

async function listBrains(env: ToolEnv): Promise<ToolResult> {
  const rows = env.brains.map((b) => ({ id: b.param, name: b.label, type: b.facts.type }));
  return ok(dataBlock("list", null, JSON.stringify({ brains: rows })));
}

async function search(env: ToolEnv, q: string, brain: string | undefined): Promise<ToolResult> {
  const tokens = tokensOf(q);
  if (!tokens.length) return bad("q has no searchable word");
  const targets = brain ? [brainIn(env, brain)] : [...env.brains];
  const scope = targets.filter((b): b is Brain => b !== null);
  if (brain && !scope.length) return notFound();
  const match = matchOfTokens(tokens);
  const found = (
    await Promise.all(
      scope.map(async (b) => (await b.stub.wikiSearch(match, 10)).map((h) => ({ b, ...h }))),
    )
  )
    .flat()
    .sort((a, z) => a.rank - z.rank || a.id.localeCompare(z.id))
    .slice(0, MAX_SEARCH_HITS * 2);
  const pages = await Promise.all(found.map((h) => h.b.stub.wikiPage(h.id)));
  const oks = await readableMany(
    env.c,
    found.map((h, i) => ({
      w: { view: h.b.view, personal: h.b.personal, stub: h.b.stub },
      ids: citationsOf(pages[i]?.markdown ?? ""),
    })),
  );
  const out: string[] = [];
  for (const [i, h] of found.entries()) {
    const page = pages[i];
    const readable = oks[i];
    if (!page || !readable || page.status !== "published") continue;
    if (!pageVisible(citationsOf(page.markdown), readable)) continue;
    // A hit stands on text this caller can read, not on a line that was dropped for them.
    const f = filterMarkdown(page.markdown, readable, canGlobal(h.b.view));
    const hay = `${page.title}\n${f.text}`.toLowerCase();
    if (!tokens.some((t) => hay.includes(t))) continue;
    out.push(dataBlock(h.b.param, page.id, page.title));
    if (out.length >= MAX_SEARCH_HITS) break;
  }
  if (!out.length)
    await recordGaps(env.c, {
      text: q,
      targets: scope,
      source: "agent",
      scoped: !!brain && brain === env.askedBrain,
    });
  return ok(out.length ? out.join("\n") : dataBlock("search", null, "no pages"));
}

async function readPage(env: ToolEnv, brain: string, pageId: string): Promise<ToolResult> {
  const b = brainIn(env, brain);
  if (!b) return notFound();
  const page = await b.stub.wikiPage(pageId);
  if (page?.status !== "published") return notFound();
  // A hidden version is for editors only: the agent never reads one.
  if (page.hidden) return notFound();
  const cites = citationsOf(page.markdown);
  const [readable] = await readableMany(env.c, [
    { w: { view: b.view, personal: b.personal, stub: b.stub }, ids: cites },
  ]);
  if (!readable || !pageVisible(cites, readable)) return notFound();
  const text = withoutCitations(filterMarkdown(page.markdown, readable, canGlobal(b.view)).text);
  const body = text.length > READ_PAGE_CHARS ? `${text.slice(0, READ_PAGE_CHARS)}...` : text;
  return ok(
    dataBlock(
      b.param,
      page.id,
      JSON.stringify({ title: page.title, summary: summaryOf(text), body }),
    ),
  );
}

async function brainInsights(
  env: ToolEnv,
  brain: string,
  q: string | undefined,
): Promise<ToolResult> {
  const b = brainIn(env, brain);
  if (!b) return notFound();
  const [x] = await seeBrains(env.c, [b]);
  if (!x) return notFound();
  const now = env.c.get("session").ctx.now;
  const schema = await b.stub.wikiSchema();
  const pages = x.visible.filter((p) => !SKIP_TYPES.has(p.type)).map(pageIn);
  const con = buildConstellation({
    brainId: b.param,
    pages,
    labelOf: (t) => schema.types[t]?.label ?? t,
    mode: "relevance",
    q: q ?? "",
    now,
    freshnessDays: x.freshnessDays,
    cap: DOT_CAP,
  });
  const cited = x.visible.flatMap((p) => citationsOf(p.markdown));
  const raw = await b.stub.brainInsightRaw(now - 30 * DAY, now - (ACTIVITY_DAYS + 1) * DAY, cited);
  const ids = [
    ...cited,
    ...raw.proposals.flatMap((p) => p.titleSources),
    ...raw.ingested.map((i) => i.sourceId),
  ];
  const [okIds] = await readableMany(env.c, [
    { w: { view: b.view, personal: b.personal, stub: b.stub }, ids },
  ]);
  const flow = buildFlow({
    raw,
    readable: new Set(okIds?.keys() ?? []),
    window: "30d",
    promotes: b.facts.type === "team" || b.facts.type === "account",
    now,
  });
  const best = con.dots
    .filter((d) => d.pageId && d.title)
    .sort((a, z) => z.score - a.score || (a.pageId ?? "").localeCompare(z.pageId ?? ""))
    .slice(0, 5)
    .map((d) => ({ page: d.pageId, title: d.title }));
  return ok(
    dataBlock(
      b.param,
      null,
      JSON.stringify({
        brain: b.param,
        pages: x.visible.length,
        health: x.health.score,
        inZone: con.legend.inZone,
        publishRate: flow.publishRate,
        best,
      }),
    ),
  );
}

async function wikiFacts(env: ToolEnv, brain: string, pageId: string | undefined) {
  const b = brainIn(env, brain);
  if (!b) return notFound();
  let page: Awaited<ReturnType<Brain["stub"]["wikiPage"]>> | null = null;
  if (pageId) {
    page = await b.stub.wikiPage(pageId);
    if (page?.status !== "published") return notFound();
    const pc = citationsOf(page.markdown);
    const [pr] = await readableMany(env.c, [
      { w: { view: b.view, personal: b.personal, stub: b.stub }, ids: pc },
    ]);
    if (!pr || !pageVisible(pc, pr)) return notFound();
  }
  const facts = await b.stub.wikiFacts({ validOnly: true, limit: 500 });
  const [readable] = await readableMany(env.c, [
    {
      w: { view: b.view, personal: b.personal, stub: b.stub },
      ids: facts.flatMap((f) => f.sourceIds),
    },
  ]);
  const pageCites = new Set(page ? citationsOf(page.markdown) : []);
  const shown = facts
    .filter((f) => {
      // Like the facts route: a fact shows only to someone who can read every source it rests on.
      if (f.sourceIds.length && !f.sourceIds.every((s) => readable?.has(s))) return false;
      if (!page) return true;
      return (
        titleOfSubject(f.subject).toLowerCase() === page.title.toLowerCase() ||
        f.sourceIds.some((s) => pageCites.has(s))
      );
    })
    .slice(0, MAX_FACTS)
    .map((f) => ({
      subject: f.subject,
      predicate: f.predicate,
      object: f.object,
      confidence: f.confidence,
      verified: f.verifiedBy !== null,
    }));
  return ok(dataBlock(b.param, page?.id ?? null, JSON.stringify({ facts: shown })));
}

/** Run one tool. `input` is already checked against the contract's Zod schema. */
export async function runTool(
  env: ToolEnv,
  name: AgentToolName,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = AGENT_TOOLS[name].input.safeParse(input);
  if (!parsed.success) return bad("arguments do not match the tool");
  const v = parsed.data as Record<string, string | undefined>;
  switch (name) {
    case "list_brains":
      return listBrains(env);
    case "search":
      return search(env, v.q as string, v.brain);
    case "read_page":
      return readPage(env, v.brain as string, v.page as string);
    case "brain_insights":
      return brainInsights(env, v.brain as string, v.q);
    case "wiki_facts":
      return wikiFacts(env, v.brain as string, v.page);
  }
}
