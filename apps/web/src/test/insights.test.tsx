import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "../i18n/en";
import { fr } from "../i18n/fr";
import { v5En, v5Fr } from "../i18n/v5";
import { Beeswarm } from "../insights/Beeswarm";
import { CANVAS_ABOVE, DotConstellation } from "../insights/DotConstellation";
import { FitBars } from "../insights/FitBars";
import { Funnel } from "../insights/Funnel";
import { Glance } from "../insights/Glance";
import { InsightCard } from "../insights/InsightCard";
import { InsightsTab } from "../insights/InsightsTab";
import { KpiTile } from "../insights/KpiTile";
import { buildGrid, layoutConstellation, nearest, radiusOfScore, rng } from "../insights/layout";
import { QueryChips } from "../insights/QueryChips";
import { SegmentBar } from "../insights/SegmentBar";
import { Segmented } from "../insights/Segmented";
import type { Constellation, Dot, HealthPoint } from "../insights/types";
import { insightsOf, overviewOf } from "../mock/v5";
import { AppProvider } from "../state";

const persona = (p: string) => window.localStorage.setItem("secondary.persona", p);
beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

const mk = (n: number, sectors = ["bid", "method", "offer"]): Constellation => {
  const r = rng(11);
  const dots: Dot[] = Array.from({ length: n }, (_, i) => {
    const score = Math.round(40 + 60 * r() ** 1.4);
    return {
      pageId: `p${i}`,
      sector: sectors[i % sectors.length] as string,
      r: radiusOfScore(score),
      score,
      k: 1,
      inZone: score >= 85,
      title: `Page ${i}`,
      ...(i < 3 ? { highlight: true, label: `Named page ${i}` } : {}),
    };
  });
  return {
    mode: "relevance",
    q: "",
    seed: 5,
    terms: [],
    sectors: sectors.map((id) => ({
      id,
      label: id.toUpperCase(),
      count: Math.ceil(n / sectors.length),
    })),
    dots,
    rings: [50, 70, 85],
    legend: {
      inZone: dots.filter((d) => d.inZone).length,
      below: 0,
      perDot: 1,
      threshold: 85,
      total: n,
    },
  };
};

describe("i18n", () => {
  it("every v5 key exists in English and French and no string has an em dash", () => {
    expect(Object.keys(v5Fr).sort()).toEqual(Object.keys(v5En).sort());
    for (const k of Object.keys(v5En) as (keyof typeof v5En)[]) {
      expect(en[k], k).toBeTruthy();
      expect(fr[k], k).toBeTruthy();
      expect(en[k]).not.toContain("—");
      expect(fr[k]).not.toContain("—");
    }
  });
});

describe("InsightCard", () => {
  it("shows the chart, and the same data as a table with a toggle; the summary is always there", async () => {
    const user = userEvent.setup();
    render(
      <InsightCard
        icon={<i />}
        title="Brain map"
        summary="3 of 9 pages are in the zone."
        table={
          <table>
            <caption>twin</caption>
            <tbody>
              <tr>
                <td>row</td>
              </tr>
            </tbody>
          </table>
        }
      >
        <p>chart</p>
      </InsightCard>,
    );
    expect(screen.getByText("3 of 9 pages are in the zone.")).toHaveClass("sr-only");
    expect(screen.getByText("chart")).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "Show as table" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await user.click(toggle);
    expect(screen.queryByText("chart")).toBeNull();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("3 of 9 pages are in the zone.")).not.toHaveClass("sr-only");
    expect(screen.getByRole("button", { name: "Show as chart" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

describe("DotConstellation", () => {
  it("draws one circle per dot, names the highlighted pages, and moves between them with the arrow keys", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const data = mk(120);
    const { container } = render(
      <DotConstellation
        data={data}
        name="Bid"
        selected={null}
        onSelect={onSelect}
        summary="s"
        animate={false}
      />,
    );
    // One circle per dot (the named ones are dots too); ring, zone and badge circles have other fills.
    expect(
      container.querySelectorAll('circle[fill="#8b5cf6"], circle[fill="#7f7f8b"]'),
    ).toHaveLength(120);
    const nodes = screen.getAllByRole("button");
    expect(nodes).toHaveLength(3);
    expect(nodes[0]).toHaveAttribute("tabindex", "0");
    expect(nodes[1]).toHaveAttribute("tabindex", "-1");
    nodes[0]?.focus();
    await user.keyboard("{ArrowRight}");
    expect(nodes[1]).toHaveFocus();
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(nodes[2]).toHaveFocus();
    await user.keyboard("{Enter}");
    const which = /Named page (\d)/.exec(nodes[2]?.getAttribute("aria-label") ?? "")?.[1];
    expect(onSelect).toHaveBeenCalledWith(`p${which}`);
    expect(screen.getByRole("group", { name: "Map of the pages in Bid" })).toBeInTheDocument();
    expect(screen.getByText("1 dot = 1 page")).toBeInTheDocument();
  });

  it("switches the dot layer to a canvas above 2000 dots and keeps the names as real buttons", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const { container } = render(
      <DotConstellation
        data={mk(CANVAS_ABOVE + 1)}
        name="Big"
        selected={null}
        onSelect={() => {}}
        summary="s"
      />,
    );
    expect(container.querySelector("canvas")).not.toBeNull();
    expect(container.querySelectorAll("circle[fill='#7f7f8b']")).toHaveLength(0);
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("finds a dot under the pointer in well under a frame at 1500 dots", () => {
    const d = mk(1500);
    const g = layoutConstellation(
      d.dots,
      d.sectors.map((s) => s.id),
      d.rings,
      d.seed,
    );
    const grid = buildGrid(g.placed, 16, 720);
    const t0 = performance.now();
    let found = 0;
    for (let n = 0; n < 2000; n++)
      if (nearest(grid, g.placed, 100 + (n % 500), 80 + ((n * 7) % 380), 7) >= 0) found++;
    const per = (performance.now() - t0) / 2000;
    expect(found).toBeGreaterThan(0);
    expect(per).toBeLessThan(0.5);
  });
});

describe("QueryChips", () => {
  it("shows three chips with their page counts, folds the rest into +N, and asks again without a removed word", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <MemoryRouter>
        <QueryChips
          value="a b c d e"
          who="Alex Morgan"
          searchHref="/search?q=a"
          onSubmit={onSubmit}
          terms={[
            { term: "pricing", hits: 12 },
            { term: "method", hits: 40 },
            { term: "public", hits: 7 },
            { term: "sector", hits: 3 },
            { term: "bids", hits: 2 },
          ]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("+12")).toBeInTheDocument();
    expect(screen.getByText("+40")).toBeInTheDocument();
    expect(screen.queryByText("sector")).toBeNull();
    expect(screen.getByText("2 more")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Search all pages" })).toHaveAttribute(
      "href",
      "/search?q=a",
    );
    await user.click(screen.getByRole("button", { name: "Remove method" }));
    expect(onSubmit).toHaveBeenCalledWith("pricing public sector bids");
    const box = screen.getByRole("textbox", { name: "Ask what matters to you" });
    await user.clear(box);
    await user.type(box, "renewal playbook{Enter}");
    expect(onSubmit).toHaveBeenLastCalledWith("renewal playbook");
  });
});

describe("small charts", () => {
  it("FitBars shows Missing in words, not only in colour, and a value for the rest", () => {
    render(
      <FitBars
        title="Coverage"
        headline="1/2"
        rows={[
          { key: "a", label: "Offers", value: 9, target: 3, unit: "pages", state: "ok" },
          { key: "b", label: "Bids", value: 0, target: 3, unit: "pages", state: "missing" },
        ]}
      />,
    );
    expect(screen.getByText("9 pages")).toBeInTheDocument();
    expect(screen.getByText("Missing")).toBeInTheDocument();
    expect(screen.getByText("1/2")).toBeInTheDocument();
  });

  it("SegmentBar prints the share of each source, KpiTile its value, Segmented moves with the arrows", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <SegmentBar
        title="Pages by source"
        total={100}
        segments={[
          { key: "a", label: "SharePoint", value: 58, color: "#5b7cff" },
          { key: "b", label: "Meetings", value: 42, color: "#2dd4bf" },
        ]}
      />,
    );
    expect(screen.getByText("58%")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
    rerender(<KpiTile value="1.8 d" label="to review" />);
    expect(screen.getByText("1.8 d")).toBeInTheDocument();
    const onChange = vi.fn();
    rerender(
      <Segmented
        label="Score"
        value="a"
        onChange={onChange}
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ]}
      />,
    );
    screen.getByRole("radio", { name: "A" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("Beeswarm names the best page, with the threshold in words", () => {
    const pts: HealthPoint[] = Array.from({ length: 80 }, (_, i) => ({
      pageId: `p${i}`,
      title: `Page ${i}`,
      score: 40 + Math.floor(i * 0.7),
      scores: { freshness: 40 + Math.floor(i * 0.7), confidence: 50, evidence: 50 },
      source: "manual",
      k: 1,
    }));
    render(<Beeswarm points={pts} scoreKind="freshness" threshold={60} label="Scores" />);
    expect(screen.getByText("Review below 60%")).toBeInTheDocument();
    expect(screen.getByText("Page 79 95%")).toBeInTheDocument();
  });

  it("Funnel prints each stage and its count", () => {
    const { container } = render(
      <Funnel
        label="Flow"
        stages={[
          { key: "ingested", count: 120 },
          { key: "proposed", count: 112 },
          { key: "reviewed", count: 37 },
          { key: "published", count: 19 },
        ]}
      />,
    );
    const text = container.textContent ?? "";
    for (const s of ["Ingested", "Proposed", "Reviewed", "Published", "120", "37"])
      expect(text).toContain(s);
  });
});

describe("mock data follows the API contract", () => {
  const bid = {
    id: "c_bid",
    name: "Bid & Pre-sales",
    type: "team",
    template: "bid",
    collections: [],
  };
  it("buckets 1240 pages to at most 640 dots, with the legend saying how many pages a dot is", () => {
    const d = insightsOf(bid, new URLSearchParams("q=pricing method"));
    expect(d.constellation.legend.total).toBe(1240);
    expect(d.constellation.legend.perDot).toBe(2);
    expect(d.constellation.dots.reduce((n, x) => n + x.k, 0)).toBe(1240);
    expect(d.constellation.dots.length).toBeLessThanOrEqual(645);
    expect(d.constellation.dots.filter((x) => x.highlight)).toHaveLength(5);
    expect(d.constellation.terms.map((t) => t.term)).toEqual(["pricing", "method"]);
    expect(d.health.points).toHaveLength(620);
    expect(d.flow.stages.map((s) => s.key)).toContain("promoted");
  });
  it("is deterministic and the overview carries no titles", () => {
    expect(insightsOf(bid, new URLSearchParams()).constellation).toEqual(
      insightsOf(bid, new URLSearchParams()).constellation,
    );
    const o = overviewOf([bid]);
    expect(JSON.stringify(o)).not.toContain("Pricing");
    expect(o.brains[0]?.dots.length).toBeGreaterThan(50);
  });
});

describe("views against the mock", () => {
  const wrap = (ui: React.ReactNode) =>
    render(
      <MemoryRouter>
        <AppProvider>{ui}</AppProvider>
      </MemoryRouter>,
    );

  it("the Insights tab renders the four cards, switches score kind and mode, and opens a table twin", async () => {
    persona("head_bid");
    const user = userEvent.setup();
    wrap(<InsightsTab brainId="c_bid" />);
    const map = await screen.findByTestId("insight-constellation");
    expect(within(map).getByText("Brain map")).toBeInTheDocument();
    for (const id of ["insight-focus", "insight-health", "insight-flow"])
      expect(screen.getByTestId(id)).toBeInTheDocument();
    expect(screen.getByTestId("kpi-review")).toHaveTextContent("1.8 d");
    expect(screen.getByTestId("kpi-seen")).toHaveTextContent("100%");
    await user.click(
      within(screen.getByTestId("insight-health")).getByRole("radio", { name: "Evidence" }),
    );
    await waitFor(() =>
      expect(
        within(screen.getByTestId("insight-health")).getByRole("radio", { name: "Evidence" }),
      ).toHaveAttribute("aria-checked", "true"),
    );
    await user.click(
      within(screen.getByTestId("insight-flow")).getByRole("button", { name: "Show as table" }),
    );
    expect(within(screen.getByTestId("insight-flow")).getByRole("table")).toBeInTheDocument();
  });

  it("the Glance grid shows one tile per brain the persona can open, each a link to its Insights", async () => {
    persona("consultant");
    wrap(<Glance />);
    const tiles = await screen.findAllByRole("link");
    expect(tiles.length).toBeGreaterThanOrEqual(2);
    for (const t of tiles)
      expect(t.getAttribute("href")).toMatch(/^\/brains\/[^?]+\?tab=insights$/);
    expect(screen.queryByText(/Bid & Pre-sales/)).toBeNull();
  });
});
