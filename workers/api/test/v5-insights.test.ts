// v5 Brain Insights API: shapes, masking, isolation. An unreadable brain contributes nothing to the
// overview, a masked page never appears by title, count or point, and Personal is the owner's alone.

import { beforeAll, describe, expect, it } from "vitest";
import { ALPHA, as, json, type Loose, plantLabel, seed, wsOf } from "./helpers.ts";
import { plantPage } from "./uxv2-helpers.ts";

const X = "c_delivery"; // the consultant reads it
const Y = "c_bid"; // the consultant does not; the Head of Bid does
const A = "v5i.consultant@example.invalid";
const B = "v5i.headbid@example.invalid";
const CEO = "v5i.ceo@example.invalid";

const SRC_X = `src:abcdef:${"v5ix".padEnd(24, "0")}`;
const src = (id: string, title: string, gate: string) => ({
  id,
  sourceId: "abcdef",
  gateNodeId: gate,
  plane: "TEAM_RESTRICTED",
  title,
  body: "x",
  webUrl: null,
  mime: "text/markdown",
  size: 1,
  eTag: "e1",
  syncedAt: Date.now(),
});

const get = (persona: string, email: string, path: string) => as(persona, path, { email });
const insights = (persona: string, email: string, id: string, q = "") =>
  get(persona, email, `/v1/brains/${id}/insights${q}`);

beforeAll(async () => {
  await seed();
  await plantPage(
    Y,
    {
      id: "v5y-pricing",
      type: "topic",
      title: "V5YCANARY Pricing",
      markdown: "# V5YCANARY Pricing\n\n## Summary\n- V5YFEE is the fixed fee for the bid\n",
    },
    "TEAM_RESTRICTED",
  );
  await plantPage(
    Y,
    {
      id: "v5y-method",
      type: "method",
      title: "V5YCANARY Method",
      markdown: "# V5YCANARY Method\n\n## Summary\n- Steps\n\n## Steps\n- One\n",
    },
    "TEAM_RESTRICTED",
  );
  await wsOf(ALPHA, X).wikiTouch(ALPHA, X, Date.now());
  await wsOf(ALPHA, X).sourceUpsert([src(SRC_X, "V5I hidden file.md", "c_bid:pricing-models")]);
  await plantLabel(ALPHA, X, "v5i-rec", "record", "TEAM_RESTRICTED", "V5I record");
  await plantPage(
    X,
    {
      id: "v5x-gates",
      type: "topic",
      title: "Gate review cadence",
      markdown:
        "# Gate review cadence\n\n## Summary\n- Gate review is weekly {src:v5i-rec}\n- The owner signs the checklist\n",
    },
    "TEAM_RESTRICTED",
  );
  await plantPage(
    X,
    {
      id: "v5x-checklist",
      type: "method",
      title: "Delivery checklist",
      markdown:
        "# Delivery checklist\n\n## Summary\n- Checklist for gates [[v5x-gates]]\n\n## Steps\n- Check scope\n",
    },
    "TEAM_RESTRICTED",
  );
  await plantPage(
    X,
    {
      id: "v5x-hidden",
      type: "topic",
      title: "V5XHIDDEN note",
      markdown: `# V5XHIDDEN note\n\n## Summary\n- Rests on a file {src:${SRC_X}}\n`,
    },
    "TEAM_RESTRICTED",
  );
  const px = await as("consultant", `/v1/wiki/${X}/propose`, {
    email: A,
    body: { title: "V5X proposal", markdown: "# V5X proposal\n\n## Summary\n- Change\n" },
  });
  expect(px.status, await px.clone().text()).toBe(201);
  const py = await as("head_bid", `/v1/wiki/${Y}/propose`, {
    email: B,
    body: {
      title: "V5YCANARY proposal",
      markdown: "# V5YCANARY proposal\n\n## Summary\n- Change\n",
    },
  });
  expect(py.status).toBe(201);
});

describe("GET /v1/brains/:id/insights", () => {
  it("answers the contract shape for a reader, no-store, with no page bodies", async () => {
    const res = await insights("consultant", A, X);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await json<Loose>(res);
    expect(Object.keys(body).sort()).toEqual(
      [
        "activity",
        "brainId",
        "constellation",
        "flow",
        "focus",
        "generatedAt",
        "health",
        "name",
        "timeline",
        "window",
      ].sort(),
    );
    const c = body.constellation;
    expect(c.rings).toEqual([50, 70, 85]);
    expect(c.mode).toBe("relevance");
    expect(c.legend.total).toBe(c.dots.reduce((n: number, d: Loose) => n + d.k, 0));
    expect(c.legend.inZone + c.legend.below).toBe(c.legend.total);
    expect(c.legend.perDot).toBe(1);
    for (const d of c.dots) {
      expect(d.r).toBeGreaterThanOrEqual(0);
      expect(d.r).toBeLessThanOrEqual(1);
      expect(c.sectors.map((s: Loose) => s.id)).toContain(d.sector);
    }
    expect(body.health.threshold).toBe(60);
    expect(body.health.total).toBe(c.legend.total);
    expect(body.health.points.length).toBe(body.health.total);
    expect(body.focus.kind).toBe("brain");
    expect(body.flow.stages.map((s: Loose) => s.key)).toEqual([
      "ingested",
      "proposed",
      "reviewed",
      "published",
      "promoted",
    ]);
    // No body text anywhere: only titles of readable pages.
    const text = JSON.stringify(body);
    expect(text).not.toContain("Gate review is weekly");
    expect(text).toContain("Gate review cadence");
  });

  it("is deterministic: same input, same bytes and same layout seed", async () => {
    const one = await (await insights("consultant", A, X, "?mode=freshness")).text();
    const two = await (await insights("consultant", A, X, "?mode=freshness")).text();
    expect(one.replace(/"generatedAt":"[^"]+"/, "")).toBe(two.replace(/"generatedAt":"[^"]+"/, ""));
  });

  it("a page resting on a file outside the view is not counted, named, plotted or scored", async () => {
    const body = await json<Loose>(await insights("consultant", A, X));
    const text = JSON.stringify(body);
    expect(text).not.toContain("V5XHIDDEN");
    expect(text).not.toContain("v5x-hidden");
    expect(text).not.toContain("hidden file");
    expect(body.constellation.legend.total).toBe(2);
    expect(body.health.total).toBe(2);
    expect(body.focus.coverage.find((r: Loose) => r.key === "topic").value).toBe(1);
  });

  it("modes and the query move pages: a matching page sits nearer the centre", async () => {
    const rel = await json<Loose>(await insights("consultant", A, X, "?q=gate%20review"));
    const hit = rel.constellation.dots.find((d: Loose) => d.pageId === "v5x-gates");
    const miss = rel.constellation.dots.find((d: Loose) => d.pageId === "v5x-checklist");
    expect(hit.score).toBeGreaterThan(miss.score);
    expect(hit.r).toBeLessThan(miss.r);
    expect(rel.constellation.terms).toEqual([
      { term: "gate", hits: 2 },
      { term: "review", hits: 1 },
    ]);
    expect(hit.title).toBe("Gate review cadence");
    expect(hit.highlight).toBe(true);
    expect(hit.label).toBe("Gate review cadence");
    const fresh = await json<Loose>(await insights("consultant", A, X, "?mode=freshness"));
    expect(fresh.constellation.mode).toBe("freshness");
    // Just written: fresh pages are in the zone.
    expect(fresh.constellation.legend.inZone).toBe(2);
  });

  it("scoreKind changes the health score and keeps all three on each point", async () => {
    const ev = await json<Loose>(await insights("consultant", A, X, "?scoreKind=evidence"));
    expect(ev.health.scoreKind).toBe("evidence");
    const gates = ev.health.points.find((p: Loose) => p.pageId === "v5x-gates");
    expect(gates.score).toBe(gates.scores.evidence);
    expect(gates.scores.evidence).toBe(50); // one of two content lines is cited
    expect(Object.keys(gates.scores).sort()).toEqual(["confidence", "evidence", "freshness"]);
    expect(ev.health.sources.reduce((n: number, s: Loose) => n + s.count, 0)).toBe(ev.health.total);
  });

  it("the flow counts only proposals of this brain: the Y proposal is not in X's flow", async () => {
    const x = await json<Loose>(await insights("consultant", A, X));
    const proposed = x.flow.stages.find((s: Loose) => s.key === "proposed").count;
    expect(proposed).toBeGreaterThanOrEqual(1);
    const y = await json<Loose>(await insights("head_bid", B, Y));
    expect(y.flow.stages.find((s: Loose) => s.key === "proposed").count).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(x)).not.toContain("V5YCANARY");
  });

  it("a page focus returns that page's coverage; an unreadable or unknown page is a 404", async () => {
    const ok = await json<Loose>(await insights("consultant", A, X, "?focus=v5x-checklist"));
    expect(ok.focus).toMatchObject({ kind: "page", pageId: "v5x-checklist", type: "method" });
    expect(ok.focus.coverage.map((r: Loose) => r.label)).toEqual(["Summary", "Steps"]);
    expect(ok.focus.coverage.every((r: Loose) => r.state !== "missing")).toBe(true);
    for (const id of ["v5x-hidden", "v5y-pricing", "nope"]) {
      const res = await insights("consultant", A, X, `?focus=${id}`);
      expect(res.status, id).toBe(404);
    }
  });

  it("rejects bad parameters", async () => {
    for (const q of ["?mode=x", "?scoreKind=x", "?window=1y", "?focus=A B"]) {
      expect((await insights("consultant", A, X, q)).status, q).toBe(400);
    }
  });

  it("a brain the caller cannot open answers exactly like one that does not exist", async () => {
    const real = await insights("consultant", A, Y);
    const none = await insights("consultant", A, "c_nonexistent");
    expect(real.status).toBe(404);
    expect(await real.text()).toBe(await none.text());
  });

  it("another person's Personal Brain is not reachable, the caller's own is", async () => {
    const other = await json<Loose>(await as("head_bid", "/v1/me", { email: B }));
    const res = await insights("consultant", A, `pb:${other.principal.id}`);
    expect(res.status).toBe(404);
    const mine = await insights("consultant", A, "me");
    expect(mine.status).toBe(200);
    expect((await json<Loose>(mine)).brainId).toBe("me");
  });
});

describe("GET /v1/brains/overview", () => {
  const overview = async (persona: string, email: string) =>
    (await json<Loose>(await get(persona, email, "/v1/brains/overview"))).brains as Loose[];

  it("lists only the brains the caller can open, one tile each, Personal first", async () => {
    const tiles = await overview("consultant", A);
    expect(tiles.map((t) => t.id)).toEqual(["me", X, "core"]);
    const tile = tiles.find((t) => t.id === X) as Loose;
    expect(tile.pages).toBeGreaterThanOrEqual(2);
    expect(tile.sparkline).toHaveLength(12);
    expect(tile.zone.total).toBe(2);
    expect(tile.dots).toHaveLength(2);
  });

  it("an unreadable brain contributes nothing: no tile, no count, no title", async () => {
    const res = await get("consultant", A, "/v1/brains/overview");
    const text = await res.text();
    expect(text).not.toContain(`"${Y}"`);
    expect(text).not.toContain("V5YCANARY");
    expect(text).not.toContain("V5XHIDDEN");
    const bid = await overview("head_bid", B);
    expect(bid.map((t) => t.id)).toContain(Y);
    expect((bid.find((t) => t.id === Y) as Loose).pages).toBeGreaterThanOrEqual(2);
    // The same request for the consultant carries the pages of X only.
    expect(
      (await overview("consultant", A)).reduce(
        (n, t) => n + (t.id === "core" ? 0 : t.zone.total),
        0,
      ),
    ).toBe(2);
  });

  it("the Personal Brain tile is the caller's own; tiles never carry titles", async () => {
    const tiles = await overview("head_bid", B);
    expect(tiles[0]?.id).toBe("me");
    const text = JSON.stringify(tiles);
    expect(text).not.toContain("Gate review");
    for (const t of tiles)
      expect(Object.keys(t).sort()).toEqual(
        [
          "dots",
          "health",
          "id",
          "lastActivityAt",
          "name",
          "pages",
          "seed",
          "sectors",
          "sparkline",
          "template",
          "type",
          "zone",
        ].sort(),
      );
  });

  it("a persona with no governance brains sees only their own Personal tile", async () => {
    const tiles = await overview("auditor", "v5i.auditor@example.invalid");
    expect(tiles.map((t) => t.id)).toEqual(["me"]);
    const ceo = await overview("ceo", CEO);
    expect(ceo.filter((t) => t.id === "me")).toHaveLength(1);
  });
});
