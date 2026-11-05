// The weekly digest. Built from what this person may read right now: account status for opportunities
// and new leads, wiki commitments that fall due, and success stories that became ready. Every item
// that links to a page links to one this caller can open (the page is visible and every source it
// rests on is readable). Preview is a read. Draft stores an email draft in the person's own workspace
// and does nothing else: nothing is sent, ever, from here.

import { canDoInView } from "@secondary/policy";
import { Hono } from "hono";
import { viewOf } from "../auth.ts";
import { lpDigestItems } from "../lp/retention.ts";
import { personalScope } from "../scope.ts";
import type { AppEnv } from "../types.ts";
import { audit, type C, notFound, sess } from "../ux/util.ts";
import {
  admittedWikis,
  pageVisible,
  type Readable,
  readableMany,
  sourcesReadable,
} from "../wiki/routes.ts";
import { citationsOf, GENERATED, titleOfSubject } from "../wiki/text.ts";
import { recordUsage } from "./ledger.ts";
import { hex, safeJson, stubOf } from "./shared.ts";

export const DIGEST_KIND = "u2_digest";
const WEEK = 7 * 86_400_000;
const MAX_ITEMS = 10;
const DONE = new Set(["done", "closed", "complete", "completed", "decided"]);

type Item = { label: string; pageId?: string; workspaceId?: string; meta: string };
export type Digest = {
  weekOf: string;
  sections: { title: string; items: Item[] }[];
  stats: { opportunities: number; newLeads: number; commitmentsDue: number; wins: number };
};

/** The Monday of the week that contains `now`, as a date. */
export function mondayOf(now: number): string {
  const d = new Date(now);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back))
    .toISOString()
    .slice(0, 10);
}

export async function composeDigest(c: C): Promise<Digest> {
  const s = sess(c);
  const view = viewOf(s);
  const now = s.ctx.now;
  const horizon = new Date(now + WEEK).toISOString().slice(0, 10);
  const since = now - WEEK;
  // Company workspaces only: the Personal Brain is not part of a team digest.
  const targets = admittedWikis(c).filter((t) => !t.scope.startsWith("personal:"));
  const per = await Promise.all(
    targets.map(async (t) => {
      const stub = stubOf(c, t.scope);
      const [pages, facts] = await Promise.all([
        stub.wikiPages(),
        stub.wikiFacts({ validOnly: true, limit: 500 }),
      ]);
      return { t, stub, pages, facts };
    }),
  );
  const oks = await readableMany(
    c,
    per.map((p) => ({
      w: { view, personal: false, stub: p.stub },
      ids: [
        ...p.pages.flatMap((x) => citationsOf(x.markdown)),
        ...p.facts.flatMap((f) => f.sourceIds),
      ],
    })),
  );

  const opportunities: Item[] = [];
  const newLeads: Item[] = [];
  const commitments: Item[] = [];
  const wins: Item[] = [];
  const journals: Item[] = [];
  const weekStart = new Date(since).toISOString().slice(0, 10);

  for (const [i, p] of per.entries()) {
    const ok = oks[i] as Readable;
    const visible = new Set(
      p.pages.filter((pg) => pageVisible(citationsOf(pg.markdown), ok)).map((pg) => pg.id),
    );
    const link = (pageId: string): Pick<Item, "pageId" | "workspaceId"> =>
      visible.has(pageId) ? { pageId, workspaceId: p.t.param } : {};
    const vn = view.nodes.get(p.t.nodeId);

    // The daily journal of each brain (counts and links, built from its own log): this week's days.
    for (const pg of p.pages) {
      const day = /^journal-(\d{4}-\d{2}-\d{2})$/.exec(pg.id)?.[1];
      if (pg.type === "journal" && day && day >= weekStart && visible.has(pg.id))
        journals.push({
          label: `${p.t.label}, ${day}`,
          pageId: pg.id,
          workspaceId: p.t.param,
          meta: "Daily journal",
        });
    }

    // Account status. These facts are only in the view at content level, which the target guarantees.
    if (vn?.kind === "account") {
      const status = vn.facts.Status ?? "";
      const item: Item = {
        label: vn.label,
        ...link("overview"),
        meta: [status, vn.facts.Sector].filter(Boolean).join(" · "),
      };
      if (status === "Renewal" || vn.bid) opportunities.push(item);
      if (status === "Onboarding") newLeads.push(item);
    }

    // Commitments falling due within the week (or already late) and not closed.
    const closed = new Set(
      p.facts
        .filter((f) => f.predicate === "status" && DONE.has(f.object.toLowerCase()))
        .map((f) => f.subject),
    );
    for (const f of p.facts) {
      if (!f.subject.startsWith("commitment:") || f.predicate !== "due" || closed.has(f.subject))
        continue;
      if (f.object > horizon || !/^\d{4}-\d{2}-\d{2}$/.test(f.object)) continue;
      // Text derived from a source is shown only when every source it rests on is readable.
      if (!f.sourceIds.length || !sourcesReadable(f.sourceIds, ok)) continue;
      commitments.push({
        label: titleOfSubject(f.subject),
        ...link(GENERATED.commitments?.id ?? "commitments"),
        meta: `Due ${f.object} · ${p.t.label}`,
      });
    }

    // Success stories that turned ready this week, from the account's own records.
    if (vn?.kind === "account" && canDoInView(view, s.principal, vn.id, "view_content").allowed) {
      const rows = await p.stub.listByKind("record", 200);
      for (const r of rows) {
        if (!r.tags.includes("out") || r.status !== "ready" || r.updatedAt < since) continue;
        wins.push({
          label: r.label,
          meta: `Success story · ${p.t.label} · ${new Date(r.updatedAt).toISOString().slice(0, 10)}`,
        });
      }
    }
  }

  // Landing Page Studio: the caller's own published pages and their week.
  const pages: Item[] = (await lpDigestItems(c)).map((p) => ({ label: p.label, meta: p.meta }));

  const cap = (xs: Item[]) =>
    [...xs].sort((a, b) => a.label.localeCompare(b.label)).slice(0, MAX_ITEMS);
  const sections = [
    { title: "Opportunities", items: cap(opportunities) },
    { title: "New leads", items: cap(newLeads) },
    { title: "Commitments due", items: cap(commitments) },
    { title: "Wins", items: cap(wins) },
    // Only when there is a published page: a digest without one is the digest it always was.
    ...(pages.length ? [{ title: "Landing pages", items: pages }] : []),
    // Likewise the journal: only when a brain wrote one this week.
    ...(journals.length
      ? [
          {
            title: "Journal",
            items: [...journals].sort((a, b) => b.label.localeCompare(a.label)).slice(0, MAX_ITEMS),
          },
        ]
      : []),
  ];
  return {
    weekOf: mondayOf(now),
    sections,
    stats: {
      opportunities: opportunities.length,
      newLeads: newLeads.length,
      commitmentsDue: commitments.length,
      wins: wins.length,
    },
  };
}

/** The email body. Links point at pages the digest already proved readable. */
export function renderDigest(d: Digest): string {
  const lines = [`Weekly digest, week of ${d.weekOf}`, ""];
  for (const sec of d.sections) {
    lines.push(`## ${sec.title}`);
    if (!sec.items.length) lines.push("- Nothing this week");
    for (const it of sec.items)
      lines.push(
        `- ${it.pageId && it.workspaceId ? `[${it.label}](/brain/${it.workspaceId}/${it.pageId})` : it.label}: ${it.meta}`,
      );
    lines.push("");
  }
  return lines.join("\n").trim();
}

/**
 * Stores the email draft in the person's own workspace. A draft only: this code has no way to send it.
 * Shared by the on-demand route and the weekly job (digest-job.ts).
 */
export async function saveDraft(c: C, id: string, d: Digest): Promise<void> {
  const s = sess(c);
  await stubOf(c, personalScope(s.principal.id)).create(
    {
      id,
      label: `Weekly digest ${d.weekOf}`,
      kind: DIGEST_KIND,
      plane: "PERSONAL_HOSTED",
      origin: "personal",
      status: "draft",
      authorId: s.principal.id,
      body: JSON.stringify({
        to: s.principal.email,
        subject: `Weekly digest, week of ${d.weekOf}`,
        markdown: renderDigest(d),
        weekOf: d.weekOf,
        state: "draft",
      }),
    },
    s.ctx.now,
  );
  await recordUsage(c.env, s.tenantId, s.principal.id, s.ctx.now, {
    capability: "digest",
    runs: 1,
  });
}

export function digestRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get("/digest/preview", async (c) => c.json(await composeDigest(c)));

  r.post("/digest/draft", async (c) => {
    const d = await composeDigest(c);
    if (!(await audit(c, { action: "digest.draft", nodeId: null, scopeId: null, revision: null })))
      return c.json({ error: "audit_unavailable" }, 503);
    const id = `dg:${hex(8)}`;
    await saveDraft(c, id, d);
    return c.json({ draftId: id }, 201);
  });

  r.get("/digest/drafts/:id", async (c) => {
    const s = sess(c);
    const id = c.req.param("id") ?? "";
    if (!/^dg:[0-9a-f]{16}$/.test(id)) throw notFound();
    const rec = await stubOf(c, personalScope(s.principal.id)).get(id);
    if (!rec || rec.kind !== DIGEST_KIND) throw notFound();
    return c.json({ id, ...safeJson(rec.body) });
  });

  return r;
}
