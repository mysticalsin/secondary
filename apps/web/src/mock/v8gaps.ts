// Dev mock for the v8 Knowledge gap endpoints (docs/API-CONTRACT.md "v8 Knowledge gaps"). Synthetic
// data only. It follows the API's rules in spirit: contribute to open the tab, steward for assign,
// merge and dismiss, eligible contributors only, a due date within 180 days, no personal details in a
// note, a started page is a draft in review. One in-memory store for the page load.
import { ApiError } from "../api";
import type { DismissReason, Gap, GapKpi, GapList, GapStatus, TopGaps } from "../views/gaps/types";
import { DISMISS_REASONS } from "../views/gaps/types";
import { NOT_HANDLED } from "./uxv2";

const DAY = 86_400_000;
const day = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10);
const at = (daysAgo: number, hours = 0) =>
  new Date(Date.now() - daysAgo * DAY - hours * 3_600_000).toISOString();

interface Rec {
  id: string;
  brain: string;
  text: string;
  /** Asks per day, 14 entries, today last. */
  asks: number[];
  askers: number;
  byRole: Record<string, number>;
  bySource: { ask: number; agent: number; search: number };
  firstDaysAgo: number;
  lastHoursAgo: number;
  status: GapStatus;
  assignedTo: { id: string; name: string } | null;
  dueIn: number | null;
  proposalId: string | null;
  pageId: string | null;
  dismissedReason: DismissReason | null;
  mergedFrom: number;
  reopened: number;
}

const rec = (r: Partial<Rec> & Pick<Rec, "id" | "brain" | "text" | "asks">): Rec => ({
  askers: 1,
  byRole: {},
  bySource: { ask: r.asks.reduce((a, b) => a + b, 0), agent: 0, search: 0 },
  firstDaysAgo: 10,
  lastHoursAgo: 5,
  status: "open",
  assignedTo: null,
  dueIn: null,
  proposalId: null,
  pageId: null,
  dismissedReason: null,
  mergedFrom: 0,
  reopened: 0,
  ...r,
});

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

const STORE: Rec[] = [
  rec({
    id: "gap:a1",
    brain: "c_bid",
    text: "How do we price a frame agreement",
    asks: [0, 0, 1, 0, 2, 1, 0, 3, 2, 1, 4, 3, 2, 5],
    askers: 7,
    byRole: { head_bid: 6, consultant: 9, ceo: 4 },
    bySource: { ask: 15, agent: 7, search: 2 },
    lastHoursAgo: 2,
    mergedFrom: 2,
  }),
  rec({
    id: "gap:a2",
    brain: "c_bid",
    text: "What is the go/no-go threshold for public sector tenders",
    asks: [0, 1, 0, 0, 0, 1, 1, 0, 2, 0, 1, 0, 2, 1],
    askers: 4,
    bySource: { ask: 6, agent: 2, search: 1 },
    status: "assigned",
    assignedTo: { id: "u_head_bid", name: "Head Of Bid" },
    dueIn: 5,
    lastHoursAgo: 9,
  }),
  rec({
    id: "gap:a3",
    brain: "c_bid",
    text: "Who signs off a bid above 500k",
    asks: [1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
    askers: 3,
    bySource: { ask: 2, agent: 0, search: 1 },
    status: "assigned",
    assignedTo: { id: "u_ceo", name: "Ceo" },
    dueIn: -3,
    firstDaysAgo: 20,
    lastHoursAgo: 120,
  }),
  rec({
    id: "gap:a4",
    brain: "c_bid",
    text: "Templates for the reference section",
    asks: [0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0],
    askers: 2,
    bySource: { ask: 0, agent: 0, search: 3 },
    status: "drafted",
    proposalId: "cand:c_bid:00aa11bb",
    pageId: "templates-for-the-reference-section",
    lastHoursAgo: 40,
  }),
  rec({
    id: "gap:a5",
    brain: "c_bid",
    text: "Bid retrospective checklist",
    asks: [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    askers: 1,
    bySource: { ask: 1, agent: 0, search: 0 },
    status: "closed",
    reopened: 1,
    firstDaysAgo: 40,
    lastHoursAgo: 240,
  }),
  rec({
    id: "gap:a6",
    brain: "c_bid",
    text: "Mantu logo usage in tenders",
    asks: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0],
    askers: 1,
    bySource: { ask: 0, agent: 1, search: 0 },
    status: "dismissed",
    dismissedReason: "out_of_scope",
    lastHoursAgo: 72,
  }),
  rec({
    id: "gap:b1",
    brain: "a_acme",
    text: "When does the Acme renewal start",
    asks: [0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 2, 0, 1, 1],
    askers: 3,
    bySource: { ask: 4, agent: 1, search: 0 },
    lastHoursAgo: 6,
  }),
  rec({
    id: "gap:b2",
    brain: "a_acme",
    text: "Which security annex applies to Acme",
    asks: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0],
    askers: 2,
    bySource: { ask: 1, agent: 0, search: 1 },
    lastHoursAgo: 30,
  }),
  rec({
    id: "gap:b3",
    brain: "a_acme",
    text: "Escalation contacts for the analytics retainer",
    asks: [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    askers: 1,
    bySource: { ask: 0, agent: 0, search: 1 },
    status: "closed",
    firstDaysAgo: 30,
    lastHoursAgo: 300,
  }),
  rec({
    id: "gap:b4",
    brain: "a_acme",
    text: "Acme invoicing cycle",
    asks: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1],
    askers: 2,
    bySource: { ask: 1, agent: 1, search: 0 },
    status: "closed",
    firstDaysAgo: 12,
    lastHoursAgo: 20,
  }),
];

const ELIGIBLE = [
  { id: "u_head_bid", name: "Head Of Bid" },
  { id: "u_ceo", name: "Ceo" },
  { id: "u_acme_lead", name: "Acme Lead" },
];

type Level = "steward" | "contribute";
/** Who may open the tab: mirrors the live API for the seeded personas. */
function levelOf(role: string, brain: string): Level {
  const steward =
    (role === "head_bid" && brain === "c_bid") ||
    (role === "acme_lead" && (brain === "a_acme" || brain === "c_sales"));
  if (steward) return "steward";
  if (role === "ceo" || role === "head_bid") return "contribute";
  if (role === "reviewer" && brain === "c_bid")
    throw new ApiError(403, "You cannot contribute to this brain");
  throw new ApiError(404, "Not found");
}

const out = (r: Rec): Gap => ({
  id: r.id,
  text: r.text,
  count: sum(r.asks),
  askers: r.askers,
  byRole: r.byRole,
  bySource: r.bySource,
  days: r.asks.map((count, i) => ({ date: day(13 - i), count })),
  firstAt: at(r.firstDaysAgo),
  lastAt: at(0, r.lastHoursAgo),
  score: Math.round((sum(r.asks) + r.askers) * 0.5 ** (r.lastHoursAgo / 24 / 14) * 100) / 100,
  status: r.status,
  assignedTo: r.assignedTo,
  due: r.dueIn === null ? null : day(-r.dueIn),
  overdue: r.status === "assigned" && r.dueIn !== null && r.dueIn < 0,
  proposalId: r.proposalId,
  pageId: r.pageId,
  dismissedReason: r.dismissedReason,
  mergedFrom: r.mergedFrom,
  reopened: r.reopened,
});

function kpi(rows: Rec[]): GapKpi {
  const n = (s: GapStatus) => rows.filter((r) => r.status === s).length;
  const live = n("open") + n("assigned") + n("drafted") + n("closed");
  return {
    windowDays: 90,
    closureRate: live ? Math.round((n("closed") / live) * 100) : null,
    open: n("open"),
    assigned: n("assigned"),
    drafted: n("drafted"),
    closed: n("closed"),
    dismissed: n("dismissed"),
    overdue: rows.filter((r) => r.status === "assigned" && r.dueIn !== null && r.dueIn < 0).length,
  };
}

const ACTIVE = new Set<GapStatus>(["open", "assigned", "drafted"]);
const PD = /[\w.+-]+@[\w-]+\.[a-z]{2,}|\+?\d[\d\s().-]{7,}/i;
const rank = (a: Gap, z: Gap) => z.score - a.score || z.lastAt.localeCompare(a.lastAt);

function mine(brain: string, id: string): Rec {
  const r = STORE.find((x) => x.brain === brain && x.id === id);
  if (!r || r.status === ("merged" as GapStatus)) throw new ApiError(404, "Not found");
  return r;
}

const need = (level: Level, role: string, brain: string): void => {
  if (level === "steward" && levelOf(role, brain) !== "steward")
    throw new ApiError(403, "Only a steward of this brain can do this");
};

export function handleV8Gaps(
  method: "GET" | "POST" | "PUT" | "DELETE",
  p: string,
  params: URLSearchParams,
  body: Record<string, unknown>,
  role: string,
): unknown {
  if (method === "GET" && p === "/v1/gaps/top") {
    const limit = Math.min(20, Math.max(1, Number(params.get("limit")) || 5));
    const brains = ["c_bid", "a_acme", "c_sales"].filter((b) => {
      try {
        return levelOf(role, b) === "steward";
      } catch {
        return false;
      }
    });
    const rows = STORE.filter((r) => brains.includes(r.brain));
    const gaps = rows
      .filter((r) => ACTIVE.has(r.status))
      .map((r) => ({
        ...out(r),
        brainId: r.brain,
        brainName: r.brain === "c_bid" ? "Bid & Pre-sales" : "Acme",
      }))
      .sort(rank)
      .slice(0, limit);
    return { gaps, kpi: kpi(rows), stewards: rows.length > 0 } satisfies TopGaps;
  }

  const m = /^\/v1\/brains\/([^/]+)\/gaps(?:\/([^/]+)\/(assign|start|merge|dismiss))?$/.exec(p);
  if (!m) return NOT_HANDLED;
  const brain = decodeURIComponent(m[1] as string);
  if (brain === "me") throw new ApiError(404, "Not found");
  const level = levelOf(role, brain);
  const rows = STORE.filter((r) => r.brain === brain);

  if (method === "GET" && !m[2]) {
    const status = params.get("status") ?? "active";
    if (!["active", "closed", "dismissed", "all"].includes(status))
      throw new ApiError(400, "invalid status");
    const gaps = rows
      .filter((r) =>
        status === "all" ? true : status === "active" ? ACTIVE.has(r.status) : r.status === status,
      )
      .map(out)
      .sort(rank);
    return {
      brain: { id: brain, name: brain === "c_bid" ? "Bid & Pre-sales" : brain },
      canSteward: level === "steward",
      gaps,
      kpi: kpi(rows),
      eligible: level === "steward" ? ELIGIBLE : [],
    } satisfies GapList;
  }

  if (method !== "POST" || !m[2] || !m[3]) return NOT_HANDLED;
  const gid = decodeURIComponent(m[2]);
  const action = m[3];

  if (action === "start") {
    const r = mine(brain, gid);
    if (r.status === "dismissed") throw new ApiError(404, "Not found");
    if (r.status === "drafted" && r.proposalId)
      throw new ApiError(409, "already started", {
        error: "already_started",
        proposalId: r.proposalId,
      });
    const title =
      typeof body.title === "string" && body.title.trim()
        ? body.title.trim()
        : r.text.charAt(0).toUpperCase() + r.text.slice(1);
    if (PD.test(title)) throw new ApiError(400, "invalid title", { error: "invalid_title" });
    if (/^bid playbook$/i.test(title))
      throw new ApiError(409, "page exists", { error: "page_exists" });
    r.status = "drafted";
    r.proposalId = `cand:${brain}:${Math.abs((title.length * 2654435761) % 0xffffffff)
      .toString(16)
      .padStart(8, "0")}`;
    r.pageId = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    return { ok: true, proposalId: r.proposalId, pageId: r.pageId, title, status: "candidate" };
  }

  need("steward", role, brain);
  const r = mine(brain, gid);

  if (action === "assign") {
    const to = body.to;
    const due = body.due;
    const who = ELIGIBLE.find((e) => e.id === to);
    if (!who) throw new ApiError(403, "That person cannot contribute to this brain");
    if (
      typeof due !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(due) ||
      due < day(0) ||
      due > day(-180)
    )
      throw new ApiError(400, "invalid due", { error: "invalid_due" });
    r.assignedTo = who;
    r.dueIn = Math.round((Date.parse(due) - Date.parse(day(0))) / DAY);
    if (r.status === "open") r.status = "assigned";
    return { ok: true, gap: out(r) };
  }

  if (action === "merge") {
    const into = STORE.find((x) => x.brain === brain && x.id === body.into);
    if (!into || into === r || into.status === "dismissed") throw new ApiError(400, "invalid into");
    into.asks = into.asks.map((n, i) => n + (r.asks[i] ?? 0));
    into.askers += r.askers;
    into.mergedFrom += 1 + r.mergedFrom;
    into.bySource = {
      ask: into.bySource.ask + r.bySource.ask,
      agent: into.bySource.agent + r.bySource.agent,
      search: into.bySource.search + r.bySource.search,
    };
    STORE.splice(STORE.indexOf(r), 1);
    return { ok: true, gap: out(into) };
  }

  // dismiss
  const reason = body.reason;
  if (typeof reason !== "string" || !(DISMISS_REASONS as readonly string[]).includes(reason))
    throw new ApiError(400, "invalid reason");
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note.length > 200) throw new ApiError(400, "invalid note");
  if (note && PD.test(note))
    throw new ApiError(400, "personal data in note", { error: "personal_data_in_note" });
  r.status = "dismissed";
  r.dismissedReason = reason as DismissReason;
  return { ok: true, gap: out(r) };
}
