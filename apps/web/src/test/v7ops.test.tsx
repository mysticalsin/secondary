import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { en } from "../i18n/en";
import { fr } from "../i18n/fr";
import { v7opsEn, v7opsFr } from "../i18n/v7ops";
import { NOT_HANDLED } from "../mock/uxv2";
import { handleV7Ops } from "../mock/v7ops";
import { ActivityPanel, isSlashTarget } from "../ops/ActivityPanel";
import { Heatmap, HeatTwin } from "../ops/Heatmap";
import { defaultOf, parseTimes, retryPlan } from "../ops/retry";
import { brushKey, dotsOf, type Range, Timeline, TimelineTwin } from "../ops/Timeline";
import type { ActivityBucket, HealthResponse, OpsStatus } from "../ops/types";
import { AppProvider } from "../state";

const RETRY_ID = "evt_7a31c0d29b4e8f56";
const OK_ID = "evt_7a31c0d29b4e8f02";
const call = (
  m: "GET" | "POST" | "PUT",
  p: string,
  body: Record<string, unknown> = {},
  role = "platform_admin",
) => {
  const u = new URL(p, "http://x.invalid");
  return handleV7Ops(m, u.pathname, u.searchParams, body, role) as Record<string, any>;
};

beforeEach(() => window.localStorage.clear());

const mount = (ui: JSX.Element, persona = "head_bid") => {
  window.localStorage.setItem("secondary.persona", persona);
  return render(
    <MemoryRouter>
      <AppProvider>{ui}</AppProvider>
    </MemoryRouter>,
  );
};

const zero = (): Record<OpsStatus, number> => ({
  published: 0,
  needs_review: 0,
  blocked: 0,
  failed: 0,
  retrying: 0,
});
const mkBuckets = (n: number): ActivityBucket[] =>
  Array.from({ length: n }, (_, i) => ({
    start: new Date(Date.UTC(2026, 10, 6, 10, i)).toISOString(),
    end: new Date(Date.UTC(2026, 10, 6, 10, i + 1)).toISOString(),
    total: 3,
    counts: { ...zero(), published: 2, blocked: 1 },
  }));

describe("brush keys", () => {
  it("creates, moves, resizes and clears", () => {
    const no = { shift: false, alt: false };
    expect(brushKey("ArrowLeft", no, null, 60)).toEqual([55, 60]);
    expect(brushKey("ArrowRight", no, null, 60)).toEqual([0, 5]);
    expect(brushKey("ArrowLeft", no, [55, 60], 60)).toEqual([54, 59]);
    expect(brushKey("ArrowRight", no, [55, 60], 60)).toEqual([55, 60]);
    expect(brushKey("ArrowRight", { shift: true, alt: false }, [10, 15], 60)).toEqual([10, 16]);
    expect(brushKey("ArrowLeft", { shift: true, alt: false }, [10, 11], 60)).toEqual([10, 11]);
    expect(brushKey("ArrowLeft", { shift: false, alt: true }, [10, 15], 60)).toEqual([9, 15]);
    expect(brushKey("Escape", no, [1, 2], 60)).toBeNull();
    expect(brushKey("Escape", no, null, 60)).toBeUndefined();
    expect(brushKey("a", no, null, 60)).toBeUndefined();
  });

  it("drives the Timeline from the keyboard and Escape clears", async () => {
    const seen: (Range | null)[] = [];
    function Host() {
      const [r, setR] = useState<Range | null>(null);
      return (
        <Timeline
          buckets={mkBuckets(60)}
          perDot={1}
          win="60m"
          callout={{
            since: "2026-11-06T10:51:07.000Z",
            kind: "blocked",
            label: "client-name@3",
            count: 9,
          }}
          range={r}
          onRange={(x) => {
            seen.push(x);
            setR(x);
          }}
        />
      );
    }
    render(<Host />);
    expect(screen.getByRole("note")).toHaveTextContent("blocked since 10:51");
    expect(screen.getByRole("note")).toHaveTextContent("client-name rule");
    const brush = screen.getByRole("group", { name: "Time window brush" });
    brush.focus();
    fireEvent.keyDown(brush, { key: "ArrowLeft" });
    fireEvent.keyDown(brush, { key: "ArrowLeft", shiftKey: true });
    fireEvent.keyDown(brush, { key: "Escape" });
    expect(seen).toEqual([[55, 60], [55, 59], null]);
  });
});

describe("timeline pieces", () => {
  it("never stacks more than 14 dots and keeps one for each status that occurred", () => {
    const d = dotsOf({ published: 400, needs_review: 2, blocked: 1, failed: 0, retrying: 0 }, 30);
    const sum = Object.values(d).reduce((a, b) => a + b, 0);
    expect(sum).toBeLessThanOrEqual(14);
    expect(d.needs_review).toBeGreaterThanOrEqual(1);
    expect(d.blocked).toBeGreaterThanOrEqual(1);
    expect(d.failed).toBe(0);
  });
  it("has a table twin with one row per bucket", () => {
    render(<TimelineTwin buckets={mkBuckets(5)} win="60m" />);
    const t = screen.getByRole("table", { name: "Events per time bucket, as a table" });
    expect(within(t).getAllByRole("row")).toHaveLength(6);
  });
  it("opens search on slash only outside text fields", () => {
    const body = document.createElement("div");
    const input = document.createElement("input");
    expect(
      isSlashTarget({ key: "/", ctrlKey: false, metaKey: false, altKey: false, target: body }),
    ).toBe(true);
    expect(
      isSlashTarget({ key: "/", ctrlKey: false, metaKey: false, altKey: false, target: input }),
    ).toBe(false);
    expect(
      isSlashTarget({ key: "/", ctrlKey: true, metaKey: false, altKey: false, target: body }),
    ).toBe(false);
    expect(
      isSlashTarget({ key: "a", ctrlKey: false, metaKey: false, altKey: false, target: body }),
    ).toBe(false);
  });
});

describe("activity panel", () => {
  it("filters, focuses search with slash, and offers retry only when retryable", async () => {
    const user = userEvent.setup();
    mount(<ActivityPanel mode="brain" brainId="c_bid" />);
    const first = await screen.findByText(RETRY_ID);
    expect(first).toBeInTheDocument();
    // Filter: Blocked leaves only blocked rows.
    await user.click(screen.getByRole("radio", { name: "Blocked" }));
    await waitFor(() => expect(screen.queryByText(RETRY_ID)).not.toBeInTheDocument());
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(within(r).getByText("Blocked")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "All" }));
    await screen.findByText(RETRY_ID);
    // "/" focuses search.
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));
    });
    expect(screen.getByRole("searchbox", { name: "Search events" })).toHaveFocus();
    // The recovered event is not retryable, the retrying connector sync is.
    await user.click(screen.getByText(OK_ID));
    await screen.findByText("Copy event id");
    expect(screen.queryByRole("button", { name: "Retry ingest" })).not.toBeInTheDocument();
    await user.click(screen.getByText(RETRY_ID));
    const retry = await screen.findByRole("button", { name: "Retry ingest" });
    await user.click(retry);
    expect(await screen.findByRole("button", { name: "Retry queued" })).toBeDisabled();
  });

  it("renders ids and codes only: metadata keys are the contract's, no content anywhere", async () => {
    const user = userEvent.setup();
    mount(<ActivityPanel mode="brain" brainId="c_bid" />);
    await user.click(await screen.findByText(OK_ID));
    const meta = await screen.findByRole("group", { name: "Metadata" });
    const keys = [...meta.querySelectorAll(".k")].map((k) => k.textContent?.replace(/"/g, ""));
    const allowed = [
      "receiptId",
      "action",
      "nodeId",
      "scopeId",
      "decision",
      "requestId",
      "clientId",
      "tool",
      "host",
      "ruleId",
      "ruleVersion",
      "sourceId",
      "jobId",
      "verdict",
    ];
    expect(keys.length).toBeGreaterThan(3);
    for (const k of keys) expect(allowed).toContain(k);
    const detail = call("GET", `/v1/brains/c_bid/activity/${OK_ID}`, {}, "head_bid");
    expect(JSON.stringify(detail)).not.toMatch(/title|markdown|body|content/i);
  });

  it("the agent variant never offers retry", async () => {
    const user = userEvent.setup();
    mount(<ActivityPanel mode="agent" host="claude_code" />, "ceo");
    const row = (
      await screen.findAllByRole("button", { expanded: false, name: /wiki\./ })
    )[0] as HTMLElement;
    await user.click(row);
    await screen.findByText("Copy event id");
    expect(screen.queryByRole("button", { name: "Retry ingest" })).not.toBeInTheDocument();
  });
});

describe("retry policy preview", () => {
  it("uses the same formula as the API", () => {
    expect(retryPlan(defaultOf("exponential")).map((s) => s.afterSeconds)).toEqual([
      5, 30, 180, 1080, 6480, 38880, 86400,
    ]);
    expect(
      retryPlan({ kind: "linear", everySeconds: 600, tries: 4 }).map((s) => s.atSeconds),
    ).toEqual([600, 1200, 1800]);
    expect(
      retryPlan({ kind: "fixed", times: [30, 300] }).map((s) => [s.try, s.afterSeconds]),
    ).toEqual([
      [2, 30],
      [3, 300],
    ]);
    expect(retryPlan({ kind: "none" })).toEqual([]);
    expect(parseTimes("30, 300 1800")).toEqual([30, 300, 1800]);
    expect(parseTimes("0")).toBeNull();
    expect(parseTimes("1.5")).toBeNull();
  });
  it("matches the mock's server plan", () => {
    const stats = call("GET", "/v1/sources/src_bidlib01/stats?window=24h");
    expect(stats.retry.plan).toEqual(retryPlan(defaultOf("exponential")));
    expect(stats.latency.n).toBe(320);
    expect(stats.latency.p50Ms).toBe(292);
    expect(stats.latency.timedOut).toBe(24);
    expect(stats.latency.hint).toEqual({ raiseTimeout: true, suggestedSeconds: 20 });
  });
});

const heat: HealthResponse["heatmap"] = {
  columnMs: 3_600_000,
  columns: ["2026-11-06T09:00:00.000Z", "2026-11-06T10:00:00.000Z", "2026-11-06T11:00:00.000Z"],
  rows: [
    {
      id: "c_bid",
      kind: "brain",
      label: "Bid & Pre-sales",
      total: 140,
      failed: 12,
      cells: [
        { attempts: 40, delivered: 40, failed: 0, failing: false, topReason: null, ruleRef: null },
        { attempts: 48, delivered: 48, failed: 0, failing: false, topReason: null, ruleRef: null },
        {
          attempts: 52,
          delivered: 40,
          failed: 12,
          failing: true,
          topReason: "blocked_by_rule",
          ruleRef: "client-name@3",
        },
      ],
    },
    {
      id: "src_x",
      kind: "source",
      label: "Bid library",
      total: 30,
      failed: 0,
      cells: [
        { attempts: 10, delivered: 10, failed: 0, failing: false, topReason: null, ruleRef: null },
        { attempts: 10, delivered: 10, failed: 0, failing: false, topReason: null, ruleRef: null },
        { attempts: 10, delivered: 10, failed: 0, failing: false, topReason: null, ruleRef: null },
      ],
    },
  ],
};

describe("heatmap", () => {
  it("starts on the failing hour, shows the tooltip and moves with arrows", () => {
    render(<Heatmap heat={heat} win="24h" />);
    const cells = screen.getAllByRole("gridcell");
    expect(cells).toHaveLength(6);
    const start = cells.find((c) => c.getAttribute("tabindex") === "0") as HTMLElement;
    expect(start.getAttribute("data-cell")).toBe("0-2");
    fireEvent.focus(start);
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Bid & Pre-sales · 11:00 · 12 blocked · client-name rule",
    );
    fireEvent.keyDown(start, { key: "ArrowLeft" });
    expect(screen.getByRole("tooltip")).toHaveTextContent("Bid & Pre-sales · 10:00 · 48 attempts");
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
    expect(screen.getByRole("tooltip")).toHaveTextContent("Bid library · 10:00");
    expect(cells[2]).toHaveAttribute("aria-label", expect.stringContaining("Failing hour"));
  });
  it("has a table twin", () => {
    render(<HeatTwin heat={heat} win="24h" />);
    const t = screen.getByRole("table", { name: "Attempts by brain or source, as a table" });
    expect(within(t).getByRole("rowheader", { name: "Bid & Pre-sales" })).toBeInTheDocument();
    expect(within(t).getByText("52 (12 failed)")).toBeInTheDocument();
  });
});

describe("mock contract behaviour", () => {
  it("retry is idempotent, 409 when not retryable, and 403 without manage rights", () => {
    const list = call("GET", "/v1/brains/c_bid/activity?status=failed&window=24h", {}, "head_bid");
    const other = list.events.find(
      (e: { retryable: boolean; id: string }) => e.retryable && e.id !== RETRY_ID,
    );
    const url = `/v1/brains/c_bid/activity/${other.id}/retry`;
    const a = call("POST", url, {}, "head_bid");
    const b = call("POST", url, {}, "head_bid");
    expect(a.already).toBe(false);
    expect(b.already).toBe(true);
    expect(b.retryId).toBe(a.retryId);
    expect(() => call("POST", `/v1/brains/c_bid/activity/${OK_ID}/retry`, {}, "head_bid")).toThrow(
      /cannot be retried/,
    );
    expect(() => call("GET", "/v1/brains/c_bid/activity", {}, "ceo")).toThrow(/manages/);
  });
  it("answers the window, status, q and from/to parameters", () => {
    const all = call("GET", "/v1/brains/c_bid/activity?window=60m", {}, "head_bid");
    expect(all.buckets).toHaveLength(60);
    expect(all.totals.all).toBeGreaterThan(800);
    expect(all.callout.since).toBe("2026-11-06T10:51:07.000Z");
    expect(all.callout.label).toBe("client-name@3");
    const failed = call("GET", "/v1/brains/c_bid/activity?status=failed", {}, "head_bid");
    for (const e of failed.events) expect(["failed", "retrying"]).toContain(e.status);
    const q = call("GET", "/v1/brains/c_bid/activity?q=client-name@3", {}, "head_bid");
    for (const e of q.events) expect(e.ruleRef).toBe("client-name@3");
    const span = call(
      "GET",
      "/v1/brains/c_bid/activity?from=2026-11-06T11:00:00.000Z&to=2026-11-06T11:05:00.000Z",
      {},
      "head_bid",
    );
    expect(span.totals.matching).toBeLessThan(all.totals.all);
    expect(span.buckets).toHaveLength(60);
    expect(call("GET", "/v1/brains/c_bid/activity?window=7d", {}, "head_bid").buckets).toHaveLength(
      84,
    );
    expect(
      call("GET", "/v1/brains/c_bid/activity?window=24h", {}, "head_bid").buckets,
    ).toHaveLength(48);
  });
  it("stores source config, validates it, and rotates with two calls", () => {
    expect(call("GET", "/v1/sources").sources).toHaveLength(12);
    const put = call("PUT", "/v1/sources/src_bidlib01", {
      retry: { kind: "linear", everySeconds: 600, tries: 8 },
      timeoutSeconds: 20,
    });
    expect(put.retry.kind).toBe("linear");
    expect(put.timeoutSeconds).toBe(20);
    expect(() =>
      call("PUT", "/v1/sources/src_bidlib01", { retry: { kind: "exponential" } }),
    ).toThrow(/not valid/);
    expect(() => call("PUT", "/v1/sources/src_bidlib01", { chips: ["bad<chip>"] })).toThrow(
      /Chips/,
    );
    const one = call("POST", "/v1/sources/src_delivdr2/credential/rotate");
    expect(one.status).toBe("pending");
    expect(call("GET", "/v1/sources/src_delivdr2").credential.pending).not.toBeNull();
    const two = call("POST", "/v1/sources/src_delivdr2/credential/rotate");
    expect(two.status).toBe("rotated");
    expect(JSON.stringify([one, two])).not.toMatch(/secret value|password/i);
    expect(() => call("GET", "/v1/sources", {}, "ceo")).toThrow(/configure/);
    expect(
      handleV7Ops(
        "GET",
        "/v1/sources/src:sp_mock:0123",
        new URLSearchParams(),
        {},
        "platform_admin",
      ),
    ).toBe(NOT_HANDLED);
  });
  it("health: 8 rows by 24 columns with a failing hour, steward scope, 403 for others", () => {
    const h = call("GET", "/v1/health?window=24h");
    expect(h.scope).toBe("tenant");
    expect(h.heatmap.rows).toHaveLength(8);
    expect(h.heatmap.columns).toHaveLength(24);
    const bid = h.heatmap.rows.find((r: { id: string }) => r.id === "c_bid");
    const last = bid.cells[23];
    expect(last).toMatchObject({
      failed: 12,
      failing: true,
      topReason: "blocked_by_rule",
      ruleRef: "client-name@3",
    });
    expect(h.success.attempts).toBe(
      h.outcomes.firstTry + h.outcomes.recovered + h.outcomes.failing,
    );
    expect(h.success.rate).toBeLessThan(h.slo);
    expect(call("GET", "/v1/health?window=1h").heatmap.columns).toHaveLength(12);
    expect(call("GET", "/v1/health?window=7d").heatmap.columns).toHaveLength(28);
    expect(call("GET", "/v1/health?window=24h", {}, "head_bid").scope).toBe("stewards");
    expect(() => call("GET", "/v1/health?window=24h", {}, "consultant")).toThrow();
    expect(handleV7Ops("GET", "/v1/health", new URLSearchParams(), {}, "ceo")).toBe(NOT_HANDLED);
  });
});

describe("strings", () => {
  it("has French for every English key", () => {
    for (const k of Object.keys(v7opsEn)) {
      expect((v7opsFr as Record<string, string>)[k]).toBeTruthy();
      expect(k in en).toBe(true);
      expect(k in fr).toBe(true);
    }
  });
  it("uses no em dashes", () => {
    for (const v of [...Object.values(v7opsEn), ...Object.values(v7opsFr)])
      expect(v).not.toContain("—");
  });
});
