// Dev mock for the v8 Review desk endpoints (docs/API-CONTRACT.md "v8 Review desk"). Synthetic data
// only. The desk is a view over the same question list as /v1/questions (questionsFor), so deciding a
// question through /v1/questions/:id takes it off the desk. The mock follows the API's rules in
// spirit: eligible-only reassign, snooze range, a personal-data warning before a comment is posted,
// the revision a request for changes names. Real access is decided only by the real API.
import { ApiError } from "../api";
import type { Question } from "../uxv2/types";
import type {
  Desk,
  DeskComment,
  DeskDetail,
  DeskRow,
  Person,
  Risk,
  RiskKey,
  SlaInfo,
  StripDot,
  What,
} from "../views/review-desk/types";
import { NOT_HANDLED, questionsFor } from "./uxv2";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const BIZ_SKIP = new Set([0, 6]);

type Diff = { type: "add" | "del" | "same"; text: string; change?: number }[];
const same = (text: string) => ({ type: "same" as const, text });
const add = (text: string) => ({ type: "add" as const, text });
const del = (text: string) => ({ type: "del" as const, text });
function numbered(lines: Diff): { lines: Diff; count: number } {
  let count = 0;
  let inRun = false;
  const out = lines.map((l) => {
    if (l.type === "same") {
      inRun = false;
      return l;
    }
    if (!inRun) {
      inRun = true;
      count++;
    }
    return { ...l, change: count - 1 };
  });
  return { lines: out, count };
}

const BRAINS: Record<string, { name: string; type: "personal" | "team" | "account" | "global" }> = {
  me: { name: "My Personal Brain", type: "personal" },
  core: { name: "Company Global", type: "global" },
  c_bid: { name: "Bid & Pre-sales", type: "team" },
  c_sales: { name: "Sales", type: "team" },
  a_acme: { name: "Acme", type: "account" },
};
const brainOf = (id: string) => BRAINS[id] ?? { name: id, type: "team" as const };
const CLIENTS = ["Acme", "Globex"];

const PEOPLE: (Person & { role: string })[] = [
  { id: "u_ceo", name: "Chief Executive", handle: "ceo", role: "ceo" },
  { id: "u_head_bid", name: "Head of Bid", handle: "head_bid", role: "head_bid" },
  { id: "u_reviewer", name: "Knowledge Reviewer", handle: "reviewer", role: "reviewer" },
];

// ---------- extra questions, so the desk has every kind of item ----------

const seeded = new Set<string>();
/** Called once per request, before any handler, so every list of questions has the same items. */
export function seedReviewMock(role: string): void {
  seed(role);
}
function seed(role: string): void {
  if (seeded.has(role)) return;
  seeded.add(role);
  if (!["ceo", "head_bid", "reviewer"].includes(role)) return;
  const now = Date.now();
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const imp = numbered([
    add("# Delivery playbook"),
    add(""),
    add("## Handover"),
    add("- Every step has one owner. {src:doc:hand}"),
    add("- The client signs the handover note. {src:doc:hand}"),
    add("## Escalation"),
    add("- Raise a blocker within one working day. {src:doc:esc}"),
    add("- Name the sponsor who can unblock it."),
  ]);
  const late = numbered([
    same("# Pricing guide"),
    same(""),
    same("## Payment terms"),
    del("- Standard payment terms are 30 days."),
    add("- Standard payment terms are 60 days for Acme."),
    add("- Questions go to jane.doe@example.invalid or +1 514 555 0188."),
    same("- Quote in the client currency."),
    add("- Margin: 18 percent."),
  ]);
  const men = numbered([
    add("# Go/no-go checklist v2"),
    add(""),
    add("## Gates"),
    add("- Qualify within two days. {src:doc:q}"),
    add("- Name the bid lead and the red team."),
    add("- Record the reason for every no-go. {src:doc:q}"),
  ]);
  const base = (
    id: string,
    title: string,
    createdAt: string,
    summary: string,
    d: { count: number; lines: Diff },
    pageId: string,
    over: Record<string, unknown> = {},
  ): Question =>
    ({
      id,
      kind: "review",
      title,
      workspaceId: "c_bid",
      createdAt,
      summary,
      options: [
        { action: "approve", label: "Approve" },
        { action: "reject", label: "Reject" },
      ],
      detail: {
        approvals: 0,
        required: 1,
        revisionHash: id.slice(-1).repeat(64),
        authorId: "u_consultant",
        changeCount: d.count,
        pages: [{ pageId, title, diff: d.lines }],
        pageTypes: ["topic"],
        rationale: "",
        ...over,
      },
    }) as Question;
  questionsFor(role).push(
    base(
      "q_v8_import",
      "Delivery playbook",
      ago(5 * HOUR),
      "Imported from a zip: three sections about handover and escalation.",
      imp,
      "delivery-playbook",
      { rationale: "Imported from zip" },
    ),
    base(
      "q_v8_overdue",
      "Pricing guide: payment terms",
      ago(8 * DAY),
      "Changes the payment terms and adds a margin.",
      late,
      "pricing-guide",
    ),
    base(
      "q_v8_mention",
      "Go/no-go checklist v2",
      ago(20 * HOUR),
      "A new checklist for the qualify step.",
      men,
      "go-no-go-checklist-v2",
    ),
  );
}

// ---------- state, per role ----------

interface State {
  snooze: Map<string, string>;
  assigned: Map<string, string>;
  changes: Map<string, string>;
  comments: Map<string, DeskComment[]>;
  mention: Set<string>;
  sla: Map<string, number>;
}
const states = new Map<string, State>();
function stateOf(role: string): State {
  let s = states.get(role);
  if (s) return s;
  s = {
    snooze: new Map([["q_lint_1", new Date(Date.now() + 3 * DAY).toISOString()]]),
    assigned: new Map(),
    changes: new Map(),
    comments: new Map([
      [
        "q_v8_mention",
        [
          {
            id: 1,
            authorId: "u_reviewer",
            name: "Knowledge Reviewer",
            text: `@${role} can you check the gate wording before this goes live?`,
            at: new Date(Date.now() - 3 * HOUR).toISOString(),
            mine: false,
            mentions: [role],
          },
        ],
      ],
    ]),
    mention: new Set(["q_v8_mention"]),
    sla: new Map(),
  };
  states.set(role, s);
  return s;
}

// ---------- the rules, in small ----------

const text = (q: Question): string[] =>
  (q.detail?.pages ?? [])
    .flatMap((p) => p.diff)
    .filter((l) => l.type === "add" && l.text.trim() && !/^\s*#{1,6}\s/.test(l.text))
    .map((l) => l.text);

function riskOf(q: Question): Risk {
  const added = text(q);
  const joined = added.join("\n");
  const kinds: string[] = [];
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(joined)) kinds.push("email");
  if (/\+?\d[\s().-]?\d{2,}[\s().-]\d{3}[\s().-]\d{3,}/.test(joined)) kinds.push("phone");
  const clients =
    q.workspaceId === "a_acme"
      ? []
      : CLIENTS.filter((c) => new RegExp(`\\b${c}\\b`, "i").test(joined));
  return {
    clients,
    personalData: { count: kinds.length, kinds },
    confidential: /\bmargin\s*[:=]/i.test(joined) ? ["Margin"] : [],
    rule: null,
    unsupported: added.filter((l) => !/\{src:[^}]+\}/.test(l)).length,
  };
}
const flags = (r: Risk): RiskKey[] => [
  ...(r.clients.length ? (["client"] as const) : []),
  ...(r.personalData.count ? (["personal"] as const) : []),
  ...(r.confidential.length ? (["confidential"] as const) : []),
  ...(r.unsupported ? (["unsupported"] as const) : []),
];

function business(from: number, to: number): number {
  let total = 0;
  for (let t = from; t < to; ) {
    const start = Math.floor(t / DAY) * DAY;
    const next = Math.min(start + DAY, to);
    if (!BIZ_SKIP.has(new Date(start).getUTCDay())) total += (next - t) / DAY;
    t = next;
  }
  return total;
}

function whatOf(q: Question): What {
  if (
    q.kind === "contradiction" ||
    q.kind === "release" ||
    q.kind === "ingest" ||
    q.kind === "lint"
  )
    return q.kind;
  const d = q.detail as Record<string, unknown> | null;
  const pages = q.detail?.pages ?? [];
  if (pages.some((p) => p.pageId.startsWith("session-report"))) return "session_report";
  if (/^imported/i.test(String(d?.rationale ?? ""))) return "import";
  if (pages.length)
    return pages.every((p) => p.diff.every((l) => l.type !== "del")) ? "new_page" : "change";
  return "review";
}

const BLOCK: Partial<Record<What, number>> = {
  release: 22,
  contradiction: 25,
  lint: 5,
  ingest: 5,
  session_report: 8,
};

function summaryOf(q: Question, what: What): string {
  const pages = q.detail?.pages ?? [];
  const added = pages
    .flatMap((p) => p.diff)
    .filter((l) => l.type === "add" && l.text.trim()).length;
  const removed = pages.flatMap((p) => p.diff).filter((l) => l.type === "del").length;
  const lines = (n: number) => `${n} line${n === 1 ? "" : "s"}`;
  const one = pages[0]?.title ?? "";
  if (what === "contradiction")
    return `Two statements disagree about ${q.title.replace(/^Contradiction:\s*/, "")}. Pick the one that is right.`;
  if (what === "new_page") return `Adds the page "${one}" with ${lines(added)}.`;
  if (what === "session_report") return `A session report: ${lines(added)} added in "${one}".`;
  if (what === "import") return `An import adds ${lines(added)}, starting with "${one}".`;
  if (what === "change")
    return `Adds ${lines(added)}${removed ? ` and removes ${lines(removed)}` : ""} in "${one}" (${q.detail?.changeCount ?? 0} changes).`;
  if (what === "release")
    return (q.detail?.required ?? 1) > 1
      ? `Releases a contribution. ${q.detail?.approvals ?? 0} of ${q.detail?.required} approvals so far.`
      : "Releases a contribution to its target.";
  if (what === "lint") return "A maintenance finding the brain raised on its own.";
  if (what === "ingest") return "A note from one of your routines the classifier could not place.";
  return "A contribution that needs a second pair of eyes.";
}

function rowOf(role: string, q: Question): DeskRow {
  const st = stateOf(role);
  const now = Date.now();
  const what = whatOf(q);
  const brain = brainOf(q.workspaceId);
  const sla = st.sla.get(q.workspaceId) ?? 2;
  const created = Date.parse(q.createdAt);
  const bd = business(created, now);
  const ratio = bd / sla;
  const state = ratio >= 1 ? "overdue" : ratio >= 0.75 ? "near" : "ok";
  const risk = riskOf(q);
  const rf = flags(risk);
  const sens = brain.type === "personal" ? 0 : brain.type === "team" ? 5 : 12;
  const approvals = q.detail?.approvals ?? 0;
  const required = q.detail?.required ?? 1;
  const blocking =
    what === "release"
      ? approvals > 0 && approvals + 1 >= required
        ? 30
        : 22
      : (BLOCK[what] ?? 15);
  const priority = Math.min(
    100,
    blocking + Math.min(40, Math.round(ratio * 20)) + sens + Math.min(18, rf.length * 6),
  );
  const until = st.snooze.get(q.id) ?? null;
  const snoozed = until && Date.parse(until) > now ? until : null;
  const hash = q.detail?.revisionHash ?? "";
  const waitingOnAuthor = st.changes.get(q.id) === hash && hash !== "";
  const mentioned = st.mention.has(q.id);
  const section: DeskRow["section"] =
    snoozed || waitingOnAuthor
      ? "snoozed"
      : mentioned
        ? "mentions"
        : what === "contradiction"
          ? "contradictions"
          : "decision";
  const added = text(q);
  const words = added.join(" ").split(/\s+/).filter(Boolean).length;
  const changes = q.detail?.changeCount ?? 0;
  const aid = q.detail?.authorId ?? null;
  return {
    id: q.id,
    kind: q.kind,
    what,
    title: q.title,
    brain: {
      id: q.workspaceId,
      name: brain.name,
      type: brain.type,
      sensitivity: brain.type === "personal" ? "low" : brain.type === "team" ? "medium" : "high",
    },
    author: aid ? { id: aid, agent: aid.startsWith("svc:") } : null,
    createdAt: q.createdAt,
    age: {
      hours: Math.max(0, Math.round((now - created) / HOUR)),
      businessDays: Math.round(bd * 10) / 10,
      slaDays: sla,
      state,
    },
    effortMinutes: Math.min(30, Math.max(1, Math.ceil(words / 200 + changes * 0.25))),
    risk: rf,
    priority,
    reasons: [],
    section,
    snoozedUntil: snoozed,
    assignedTo: st.assigned.get(q.id) ?? null,
    assignedToMe: st.assigned.get(q.id) === `u_${role}`,
    waitingOnAuthor,
    summary: { text: summaryOf(q, what), source: "rules" },
    approvals,
    required,
    changeCount: changes,
  };
}

const byPriority = (a: DeskRow, b: DeskRow) =>
  b.priority - a.priority || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

// Decided history for the strip and the KPIs: days back and the outcome.
const HISTORY: [number, "approved" | "rejected", number][] = [
  [1, "approved", 20],
  [2, "approved", 30],
  [2, "approved", 9],
  [3, "rejected", 40],
  [4, "approved", 16],
  [5, "approved", 52],
  [6, "approved", 11],
  [8, "approved", 26],
  [9, "rejected", 33],
  [9, "approved", 14],
  [11, "approved", 19],
  [12, "approved", 25],
];

function desk(role: string): Desk {
  seed(role);
  const st = stateOf(role);
  void st;
  const now = Date.now();
  const rows = questionsFor(role).map((q) => rowOf(role, q));
  const sec = (s: DeskRow["section"]) => rows.filter((r) => r.section === s).sort(byPriority);
  const fyi = [
    {
      id: "fyi_1",
      title: "Win themes library",
      brainId: "c_bid",
      brainName: "Bid & Pre-sales",
      decidedAt: new Date(now - 26 * HOUR).toISOString(),
      by: "u_reviewer",
      status: "approved",
    },
    {
      id: "fyi_2",
      title: "Session report Ada Lovelace",
      brainId: "c_bid",
      brainName: "Bid & Pre-sales",
      decidedAt: new Date(now - 3 * DAY).toISOString(),
      by: "u_ceo",
      status: "approved",
    },
  ];
  const open = rows.filter((r) => r.section !== "snoozed");
  const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const days = Array.from({ length: 14 }, (_, i) => dayOf(now - (13 - i) * DAY));
  const slots = new Map<string, number>();
  const dots: StripDot[] = [];
  const put = (id: string, ms: number, state: StripDot["state"]) => {
    const day = dayOf(ms);
    if (!days.includes(day)) return;
    const slot = slots.get(day) ?? 0;
    slots.set(day, slot + 1);
    dots.push({ id, day, state, slot });
  };
  for (const [i, [d, state]] of HISTORY.entries()) put(`h${i}`, now - d * DAY - i * HOUR, state);
  for (const r of rows) put(r.id, Date.parse(r.createdAt), "waiting");
  const hours = HISTORY.map(([, , h]) => h).sort((a, b) => a - b);
  return {
    generatedAt: new Date(now).toISOString(),
    sections: {
      decision: sec("decision"),
      contradictions: sec("contradictions"),
      mentions: sec("mentions"),
      fyi,
      snoozed: sec("snoozed"),
    },
    counts: {
      decision: sec("decision").length,
      contradictions: sec("contradictions").length,
      mentions: sec("mentions").length,
      fyi: fyi.length,
      snoozed: sec("snoozed").length,
      waiting: open.length,
    },
    strip: { days, dots },
    kpis: {
      waiting: open.length,
      medianHoursToDecision: hours[Math.floor(hours.length / 2)] ?? null,
      overdue: open.filter((r) => r.age.state === "overdue").length,
      clearedThisWeek: HISTORY.filter(([d]) => d <= 6).length,
    },
    slaDefaultDays: 2,
  };
}

function eligible(q: Question): Person[] {
  const author = q.detail?.authorId;
  return PEOPLE.filter((p) => p.id !== author).map(({ id, name, handle }) => ({
    id,
    name,
    handle,
  }));
}

function detailOf(role: string, q: Question): DeskDetail {
  const st = stateOf(role);
  const r = rowOf(role, q);
  const pages = q.detail?.pages ?? [];
  const current = pages
    .map((p) =>
      p.diff
        .filter((l) => l.type !== "add")
        .map((l) => l.text.replace(/\{src:[^}]+\}/g, "").trimEnd())
        .join("\n"),
    )
    .join("\n\n")
    .trim();
  const facts =
    q.id === "q_prop_1"
      ? [{ id: 11, subject: "Bid playbook", predicate: "qualification window", object: "two days" }]
      : q.id === "q_v8_overdue"
        ? [{ id: 12, subject: "Standard terms", predicate: "payment", object: "30 days" }]
        : [];
  const assignee = st.assigned.get(q.id);
  const person = PEOPLE.find((p) => p.id === assignee);
  return {
    id: q.id,
    summary: r.summary,
    risk: riskOf(q),
    context: {
      pageTitle: pages[0]?.title ?? null,
      current: current || null,
      facts,
      hiddenFacts: q.id === "q_v8_overdue" ? 1 : 0,
    },
    comments: st.comments.get(q.id) ?? [],
    eligible: eligible(q),
    state: {
      snoozedUntil: r.snoozedUntil,
      assignedTo: assignee ? { id: assignee, name: person?.name ?? null } : null,
      waitingOnAuthor: r.waitingOnAuthor,
    },
    slaDays: r.age.slaDays,
  };
}

const PD_EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;
const PD_PHONE = /\+?\d[\s().-]?\d{2,}[\s().-]\d{3}[\s().-]\d{3,}/;
const pdKinds = (t: string): string[] => [
  ...(PD_EMAIL.test(t) ? ["email"] : []),
  ...(PD_PHONE.test(t) ? ["phone"] : []),
  ...(/\b(salary|payroll|bonus)\b/i.test(t) ? ["hr"] : []),
];
const warn = (kinds: string[]) =>
  new ApiError(409, "This text looks like it holds personal data. Remove it, or confirm to post.", {
    error: "personal_data_warning",
    kinds,
  });

const SLA = (role: string, brain: string): SlaInfo => ({
  days: stateOf(role).sla.get(brain) ?? 2,
  defaultDays: 2,
  min: 1,
  max: 10,
  canSet: ["head_bid", "acme_lead", "platform_admin"].includes(role),
});

export function handleV8Review(
  method: "GET" | "POST" | "PUT" | "DELETE",
  p: string,
  _params: URLSearchParams,
  body: Record<string, unknown>,
  role: string,
): unknown {
  const sla = p.match(/^\/v1\/brains\/([^/]+)\/review-sla$/);
  if (sla) {
    const brain = decodeURIComponent(sla[1] as string);
    if (brain === "me") throw new ApiError(404, "Not found");
    if (method === "GET") return SLA(role, brain);
    if (method === "PUT") {
      const info = SLA(role, brain);
      if (!info.canSet) throw new ApiError(403, "You cannot manage this brain");
      const days = body.days;
      if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > 10)
        throw new ApiError(400, "invalid days");
      stateOf(role).sla.set(brain, days);
      return SLA(role, brain);
    }
    return NOT_HANDLED;
  }
  if (p === "/v1/review-desk" && method === "GET") return desk(role);
  const m = p.match(
    /^\/v1\/review-desk\/([^/]+)(?:\/(comments|snooze|reassign|request-changes))?$/,
  );
  if (!m) return NOT_HANDLED;
  seed(role);
  const id = decodeURIComponent(m[1] as string);
  const q = questionsFor(role).find((x) => x.id === id);
  if (!q) throw new ApiError(404, "Not found");
  const st = stateOf(role);
  const act = m[2];
  if (!act && method === "GET") return detailOf(role, q);
  if (method !== "POST") return NOT_HANDLED;

  if (act === "comments") {
    const t = typeof body.text === "string" ? body.text.trim() : "";
    if (!t || t.length > 2000) throw new ApiError(400, "invalid text");
    const kinds = pdKinds(t);
    if (kinds.length && body.acknowledged !== true) throw warn(kinds);
    const people = eligible(q);
    const handles = [
      ...new Set(
        [...t.matchAll(/(?<![\w@.])@([A-Za-z0-9][A-Za-z0-9._-]+)/g)].map((x) =>
          (x[1] as string).toLowerCase(),
        ),
      ),
    ];
    const hit = people.filter((x) => handles.includes(x.handle) && x.id !== `u_${role}`);
    const list = st.comments.get(id) ?? [];
    list.push({
      id: list.length + 10,
      authorId: `u_${role}`,
      name: null,
      text: t,
      at: new Date().toISOString(),
      mine: true,
      mentions: handles,
    });
    st.comments.set(id, list);
    st.mention.delete(id);
    return {
      ok: true,
      comment: { id: list.length + 9, at: new Date().toISOString() },
      mentioned: hit.map((x) => x.id),
      unresolved: handles.filter((h) => !people.some((x) => x.handle === h)),
    };
  }
  if (act === "snooze") {
    if (body.until === null) {
      st.snooze.delete(id);
      return { ok: true, snoozedUntil: null };
    }
    const until = typeof body.until === "string" ? Date.parse(body.until) : Number.NaN;
    if (!Number.isFinite(until) || until <= Date.now() || until > Date.now() + 60 * DAY)
      throw new ApiError(400, "invalid until");
    st.snooze.set(id, new Date(until).toISOString());
    return { ok: true, snoozedUntil: new Date(until).toISOString() };
  }
  if (act === "reassign") {
    if (body.to === null) {
      st.assigned.delete(id);
      return { ok: true, assignedTo: null };
    }
    if (typeof body.to !== "string") throw new ApiError(400, "invalid to");
    if (!eligible(q).some((x) => x.id === body.to))
      throw new ApiError(
        403,
        "That person cannot review this brain, so the item cannot go to them",
      );
    st.assigned.set(id, body.to);
    return { ok: true, assignedTo: body.to };
  }
  if (act === "request-changes") {
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (!note || note.length > 2000) throw new ApiError(400, "invalid note");
    if (q.kind === "contradiction" || q.kind === "ingest")
      throw new ApiError(409, "Changes cannot be requested on this item", {
        error: "not_available",
      });
    if (body.revisionHash !== q.detail?.revisionHash)
      throw new ApiError(409, "The proposal changed since you read it. Reload it", {
        error: "revision_conflict",
      });
    const kinds = pdKinds(note);
    if (kinds.length && body.acknowledged !== true) throw warn(kinds);
    if (q.detail?.pages?.length) {
      st.changes.set(id, q.detail?.revisionHash ?? "");
      const list = st.comments.get(id) ?? [];
      list.push({
        id: list.length + 10,
        authorId: `u_${role}`,
        name: null,
        text: note,
        at: new Date().toISOString(),
        mine: true,
        mentions: [],
      });
      st.comments.set(id, list);
    } else {
      // A candidate: the questions rule. It leaves the queue.
      const list = questionsFor(role);
      list.splice(list.indexOf(q), 1);
    }
    return { ok: true };
  }
  return NOT_HANDLED;
}
