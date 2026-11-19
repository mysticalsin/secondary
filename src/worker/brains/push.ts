// Pushing into a brain with the caller's own rights (API-CONTRACT v4, MCP tools propose_page,
// propose_change, write_session_report). Each call needs the contribute right in that brain, opened
// through the caller's admitted view (404 for a brain they cannot read, the same as for one that does
// not exist), and lands as a pending proposal in that brain's review queue only. Never published
// directly, except a session report in the caller's own Personal Brain when that brain publishes
// directly (the brain's own publication mode).

import { Hono } from "hono";
import type { AppDeps, AppEnv } from "../types.ts";
import { audit, bad, type C, notFound, readObject, sess, text } from "../ux/util.ts";
import { pageVisible, readableMany } from "../wiki/routes.ts";
import { citationsOf, cleanText, GENERATED, PAGE_ID, slug } from "../wiki/text.ts";
import type { PageDraft, Proposal } from "../wiki/types.ts";
import { isCalendarDay, SESSION_REPORT_TYPE } from "./model.ts";
import { type Brain, needBrain } from "./open.ts";
import { rateLimit } from "./shared.ts";

const MAX_MD = 20_000;
const SESSION_FOLDER = ["Sources", "Session reports"] as const;

/** The person's display folder name, from their address: "jane.doe@x" is "Jane Doe". */
export const displayName = (email: string): string => {
  const local = email.split("@")[0] ?? "";
  const name = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return cleanText(name, 60) || "Unknown";
};

const rate = (c: C): Promise<Response | null> => {
  const raw = Number.parseInt(c.env.WIKI_WRITE_PER_MIN ?? "", 10);
  // The same budget as the wiki's own propose route, so a person has one write allowance.
  return rateLimit(c, "wiki_write", Number.isFinite(raw) && raw > 0 ? raw : 30);
};

/** Queue one page draft in the brain. A person cites only what they can read themselves (L-01). */
async function submit(
  c: C,
  b: Brain,
  draft: PageDraft,
  input: { title: string; rationale: string; publishDirect: boolean },
): Promise<Response> {
  const s = sess(c);
  const [ok] = await readableMany(c, [
    {
      w: { view: b.view, personal: b.personal, stub: b.stub },
      ids: citationsOf(draft.markdown),
    },
  ]);
  const res = await b.stub.wikiPropose(
    {
      kind: "wiki_ingest",
      title: input.title,
      rationale: input.rationale,
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
      plane: b.plane,
      readable: [...(ok?.keys() ?? [])],
      ...(input.publishDirect ? { publishDirect: true } : {}),
    },
  );
  if (!res.ok)
    return c.json({ error: res.code, reason: res.message }, res.code === "not_found" ? 404 : 409);
  if (!res.created) return c.json({ error: "nothing_to_propose", reason: res.reason }, 422);
  return c.json(
    {
      ok: true,
      brainId: b.param,
      pageId: draft.pageId,
      proposalId: res.id,
      status: res.autoAccepted ? "published" : "candidate",
    },
    201,
  );
}

export function pushRoutes(_deps: AppDeps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  // A new page.
  r.post("/brains/:id/push/page", async (c) => {
    const b = await needBrain(c, c.req.param("id"), "contribute");
    if (b instanceof Response) return b;
    const body = await readObject(c);
    const title = cleanText(text(body.title, 1, 120, "invalid_title"), 120);
    const md = text(body.markdown, 1, MAX_MD, "invalid_markdown");
    const type = typeof body.type === "string" ? body.type : "topic";
    const schema = await b.stub.wikiSchema();
    if (!schema.types[type] || GENERATED[type]) throw bad("invalid_type");
    const pageId = slug(title);
    if (!PAGE_ID.test(pageId)) throw bad("invalid_title");
    const cur = await b.stub.wikiPage(pageId);
    const refused = await rate(c);
    if (refused) return refused;
    if (
      !(await audit(c, {
        action: "brain.push_page",
        nodeId: b.nodeId,
        scopeId: b.scope,
        revision: null,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    return submit(
      c,
      b,
      { pageId, type: cur?.type ?? type, title, baseRevision: cur?.revision ?? null, markdown: md },
      {
        title: `${cur ? "Edit" : "New page"}: ${title}`,
        rationale: "proposed by an agent",
        publishDirect: false,
      },
    );
  });

  // A new version of a page that exists and that the caller can read.
  r.post("/brains/:id/push/change", async (c) => {
    const b = await needBrain(c, c.req.param("id"), "contribute");
    if (b instanceof Response) return b;
    const body = await readObject(c);
    const pageId =
      typeof body.pageId === "string" && PAGE_ID.test(body.pageId) ? body.pageId : null;
    if (!pageId) throw notFound();
    const md = text(body.markdown, 1, MAX_MD, "invalid_markdown");
    const rationale =
      body.rationale === undefined
        ? "proposed by an agent"
        : cleanText(text(body.rationale, 0, 500, "invalid_rationale"), 500) ||
          "proposed by an agent";
    const cur = await b.stub.wikiPage(pageId);
    if (!cur || cur.status !== "published" || GENERATED[cur.type]) throw notFound();
    // A page with no readable source is not there for this caller (H-02).
    const [seen] = await readableMany(c, [
      {
        w: { view: b.view, personal: b.personal, stub: b.stub },
        ids: citationsOf(cur.markdown),
      },
    ]);
    if (!seen || !pageVisible(citationsOf(cur.markdown), seen)) throw notFound();
    const refused = await rate(c);
    if (refused) return refused;
    if (
      !(await audit(c, {
        action: "brain.push_change",
        nodeId: b.nodeId,
        scopeId: b.scope,
        revision: cur.revision,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    return submit(
      c,
      b,
      {
        pageId,
        type: cur.type,
        title: cur.title,
        baseRevision: cur.revision,
        markdown: md,
      },
      { title: `Edit: ${cur.title}`, rationale, publishDirect: false },
    );
  });

  // A session report: Sources > Session reports > <person>, one page per report.
  r.post("/brains/:id/push/session-report", async (c) => {
    const b = await needBrain(c, c.req.param("id"), "contribute");
    if (b instanceof Response) return b;
    const s = sess(c);
    const body = await readObject(c);
    const md = text(body.markdown, 1, MAX_MD, "invalid_markdown");
    const date =
      body.date === undefined
        ? new Date(s.ctx.now).toISOString().slice(0, 10)
        : text(body.date, 10, 10, "invalid_date");
    if (!isCalendarDay(date)) throw bad("invalid_date");
    const person = displayName(s.principal.email);
    const folder = [...SESSION_FOLDER, person];
    const title = `Session report ${person} ${date}`;
    // One page per report. A short random tail keeps two reports of the same day (one may still be
    // waiting for review, so its id is not taken yet) from ever sharing a page.
    const tail = [...crypto.getRandomValues(new Uint8Array(2))]
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
    const pageId = `session-report-${slug(person)}-${date}-${tail}`;
    if ((await b.stub.wikiPage(pageId)) !== null) throw bad("try_again", 409);
    const refused = await rate(c);
    if (refused) return refused;
    if (
      !(await audit(c, {
        action: "brain.push_session_report",
        nodeId: b.nodeId,
        scopeId: b.scope,
        revision: null,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    // Shared brains always review. A Personal Brain follows its own publication mode.
    const publishDirect = b.personal && (await b.stub.brainConfig()).publication === "direct";
    const res = await submit(
      c,
      b,
      {
        pageId,
        type: SESSION_REPORT_TYPE,
        title,
        baseRevision: null,
        markdown: `# ${title}\n\nFolder: ${folder.join(" / ")}\n\n${md}\n`,
      },
      { title: `New page: ${title}`, rationale: "session report from an agent", publishDirect },
    );
    if (res.status !== 201) return res;
    return c.json({ ...((await res.json()) as Record<string, unknown>), folder }, 201);
  });

  return r;
}
