// Review desk, pure part (docs/DESIGN-V8-AMAZING.md section 1). Priority, age against the brain's SLA,
// effort, the "what changed" line, the risk panel and the section a row belongs in. Nothing here reads
// a store or knows the caller: the routes hand in what the caller may see, and every function is
// deterministic so the tests can pin it.

import { detectSensitivity } from "../sensitivity.ts";

export const HOUR = 3_600_000;
export const DAY = 86_400_000;
export const DEFAULT_SLA_DAYS = 2;
export const SLA_MIN_DAYS = 1;
export const SLA_MAX_DAYS = 10;
export const SNOOZE_MAX_DAYS = 60;
export const STRIP_DAYS = 14;

export type DeskKind = "ingest" | "contradiction" | "lint" | "review" | "release";
export type What =
  | "new_page"
  | "change"
  | "contradiction"
  | "import"
  | "session_report"
  | "release"
  | "review"
  | "lint"
  | "ingest";
export type Section = "decision" | "contradictions" | "mentions" | "fyi" | "snoozed";
export type AgeState = "ok" | "near" | "overdue";
export type Sensitivity = "low" | "medium" | "high";

export interface DiffLineIn {
  type: "add" | "del" | "same";
  text: string;
}

/** Business days (Monday to Friday, UTC) between two instants, in fractions of a day. */
export function businessDaysBetween(fromMs: number, toMs: number): number {
  if (toMs <= fromMs) return 0;
  let total = 0;
  let t = fromMs;
  while (t < toMs) {
    const dayStart = Math.floor(t / DAY) * DAY;
    const next = Math.min(dayStart + DAY, toMs);
    const weekday = new Date(dayStart).getUTCDay();
    if (weekday !== 0 && weekday !== 6) total += (next - t) / DAY;
    t = next;
  }
  return total;
}

export function ageOf(createdMs: number, nowMs: number, slaDays: number) {
  const business = businessDaysBetween(createdMs, nowMs);
  const ratio = slaDays > 0 ? business / slaDays : 0;
  const state: AgeState = ratio >= 1 ? "overdue" : ratio >= 0.75 ? "near" : "ok";
  return {
    hours: Math.max(0, Math.round((nowMs - createdMs) / HOUR)),
    businessDays: Math.round(business * 10) / 10,
    slaDays,
    state,
  };
}

/** Where a brain sits on sensitivity: accounts, NDA, restricted and Global are high. */
export function sensitivityOf(f: {
  type: "personal" | "team" | "account" | "global";
  restricted?: boolean;
  nda?: boolean;
}): Sensitivity {
  if (f.type === "personal") return "low";
  if (f.type === "account" || f.type === "global" || f.restricted || f.nda) return "high";
  return "medium";
}

export interface Risk {
  /** Account names the text mentions in a brain that is not that account's own. */
  clients: string[];
  personalData: { count: number; kinds: string[] };
  /** Business-field labels (confidential or personal) the text touches. */
  confidential: string[];
  /** The rule a receipt says matched, when there is one: `ruleId@version`. */
  rule: string | null;
  /** Added statement lines with no citation. */
  unsupported: number;
}

const RULE = /^[A-Za-z0-9_.:-]{1,64}@\d{1,6}$/;
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The lines a reviewer is asked to accept: added lines that are statements, not blanks or headings. */
export const addedStatements = (diff: readonly DiffLineIn[]): string[] =>
  diff
    .filter((l) => l.type === "add" && l.text.trim() && !/^\s*#{1,6}\s/.test(l.text))
    .map((l) => l.text);

export function riskOf(i: {
  addedText: string[];
  clientNames: readonly string[];
  fieldLabels: readonly string[];
  rule?: string | null;
}): Risk {
  const joined = i.addedText.join("\n");
  const lower = joined.toLowerCase();
  const flags = detectSensitivity({ body: joined });
  const clients = i.clientNames
    .filter((n) => n.length >= 3 && new RegExp(`\\b${escapeRe(n.toLowerCase())}\\b`).test(lower))
    .slice(0, 5);
  const confidential = i.fieldLabels
    .filter(
      (l) => l.length >= 2 && new RegExp(`\\b${escapeRe(l.toLowerCase())}\\s*[:=]`).test(lower),
    )
    .slice(0, 5);
  return {
    clients,
    personalData: { count: flags.length, kinds: [...new Set(flags.map((f) => f.type))] },
    confidential,
    rule: i.rule && RULE.test(i.rule) ? i.rule : null,
    unsupported: i.addedText.filter((t) => !/\{src:[^}]+\}/.test(t)).length,
  };
}

/** Risk icons for a row: the keys the web maps to an icon and a label. */
export function riskFlags(r: Risk): string[] {
  const out: string[] = [];
  if (r.clients.length) out.push("client");
  if (r.personalData.count) out.push("personal");
  if (r.confidential.length) out.push("confidential");
  if (r.rule) out.push("rule");
  if (r.unsupported) out.push("unsupported");
  return out;
}

/** What the change is, for the row's kind label. */
export function whatOf(i: {
  kind: DeskKind;
  title: string;
  pageTypes: readonly string[];
  pageIds: readonly string[];
  rationale: string;
  allAdds: boolean;
}): What {
  if (i.kind === "contradiction") return "contradiction";
  if (i.kind === "release") return "release";
  if (i.kind === "ingest") return "ingest";
  if (i.kind === "lint") return "lint";
  if (
    i.pageTypes.includes("session_report") ||
    i.pageIds.some((p) => p.startsWith("session-report-"))
  )
    return "session_report";
  if (/^imported\b/i.test(i.rationale)) return "import";
  if (i.pageIds.length) return i.allAdds ? "new_page" : "change";
  return "review";
}

/** Minutes to read: 200 words a minute plus a quarter minute per change, at least one, at most 30. */
export function effortMinutes(i: {
  addedWords: number;
  removedWords: number;
  changes: number;
}): number {
  const reading = (i.addedWords + i.removedWords * 0.5) / 200;
  return Math.min(30, Math.max(1, Math.ceil(reading + i.changes * 0.25)));
}

export const wordCount = (lines: readonly string[]): number =>
  lines.join(" ").split(/\s+/).filter(Boolean).length;

/** The one-line "what changed" summary. A summary only: the diff stays the source of truth. */
export function summaryOf(i: {
  what: What;
  pageTitles: readonly string[];
  added: number;
  removed: number;
  changes: number;
  subject?: string;
  required?: number;
  approvals?: number;
}): string {
  const lines = (n: number) => `${n} line${n === 1 ? "" : "s"}`;
  const one = i.pageTitles[0] ?? "";
  const more = i.pageTitles.length > 1 ? ` and ${i.pageTitles.length - 1} more` : "";
  switch (i.what) {
    case "contradiction":
      return `Two statements disagree${i.subject ? ` about ${i.subject}` : ""}. Pick the one that is right.`;
    case "new_page":
      return `Adds the page "${one}"${more} with ${lines(i.added)}.`;
    case "session_report":
      return `A session report: ${lines(i.added)} added${one ? ` in "${one}"` : ""}.`;
    case "import":
      return `An import adds ${lines(i.added)}${one ? `, starting with "${one}"` : ""}${more}.`;
    case "change": {
      const parts = [
        i.added ? `adds ${lines(i.added)}` : "",
        i.removed ? `removes ${lines(i.removed)}` : "",
      ].filter(Boolean);
      return `${parts.length ? parts.join(" and ") : "Changes text"} in "${one}"${more} (${i.changes} ${i.changes === 1 ? "change" : "changes"}).`.replace(
        /^./,
        (ch) => ch.toUpperCase(),
      );
    }
    case "release":
      return i.required && i.required > 1
        ? `Releases a contribution. ${i.approvals ?? 0} of ${i.required} approvals so far.`
        : "Releases a contribution to its target.";
    case "lint":
      return "A maintenance finding the brain raised on its own.";
    case "ingest":
      return "A note from one of your routines the classifier could not place.";
    default:
      return "A contribution that needs a second pair of eyes.";
  }
}

/** Blocking weight 0 to 30: how much waits on this decision. */
export function blockingWeight(i: { what: What; approvals: number; required: number }): number {
  if (i.what === "release") return i.approvals > 0 && i.approvals + 1 >= i.required ? 30 : 22;
  if (i.what === "contradiction") return 25;
  if (i.what === "lint" || i.what === "ingest") return 5;
  if (i.what === "session_report") return 8;
  return 15;
}

export interface Scored {
  priority: number;
  reasons: string[];
}

/** Priority 0 to 100: blocking (30) + age against the SLA (40) + brain sensitivity (12) + risk flags (18). */
export function priorityOf(i: {
  what: What;
  approvals: number;
  required: number;
  age: { businessDays: number; slaDays: number; state: AgeState };
  sensitivity: Sensitivity;
  risk: readonly string[];
}): Scored {
  const reasons: string[] = [];
  const blocking = blockingWeight(i);
  if (blocking >= 20) reasons.push("blocking");
  const ratio = i.age.slaDays > 0 ? i.age.businessDays / i.age.slaDays : 0;
  const ageP = Math.min(40, Math.round(ratio * 20));
  if (i.age.state !== "ok") reasons.push(i.age.state === "overdue" ? "overdue" : "near_sla");
  const sens = i.sensitivity === "high" ? 12 : i.sensitivity === "medium" ? 5 : 0;
  if (i.sensitivity === "high") reasons.push("sensitive_brain");
  const riskP = Math.min(18, i.risk.length * 6);
  if (i.risk.length) reasons.push("risk");
  return { priority: Math.min(100, blocking + ageP + sens + riskP), reasons };
}

/** A person is named with @local.part (the address before the @). */
export const MENTION = /(?<![\w@.])@([A-Za-z0-9][A-Za-z0-9._-]{1,63})/g;

export const mentionsIn = (text: string): string[] => [
  ...new Set(
    [...text.matchAll(MENTION)].map((m) => (m[1] as string).replace(/[._-]+$/, "").toLowerCase()),
  ),
];

export interface StateIn {
  /** Until when this viewer snoozed the item (ms), if they did. */
  snoozedUntil: number | null;
  /** The revision on which changes were requested, when it is still the current one. */
  waitingOnAuthor: boolean;
  /** An unanswered @mention of this viewer by someone else. */
  mentioned: boolean;
}

export function sectionOf(i: { what: What; state: StateIn; nowMs: number }): Section {
  if (i.state.snoozedUntil !== null && i.state.snoozedUntil > i.nowMs) return "snoozed";
  if (i.state.waitingOnAuthor) return "snoozed";
  if (i.state.mentioned) return "mentions";
  if (i.what === "contradiction") return "contradictions";
  return "decision";
}

/** Median of numbers, or null when there are none. */
export function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

export interface StripDot {
  id: string;
  day: string;
  state: "waiting" | "approved" | "rejected";
  /** Position within the day, so dots of one day stack. */
  slot: number;
}

const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** The 14-day strip: one dot per incoming proposal, newest day last, coloured by state. */
export function stripOf(
  proposals: readonly { id: string; status: string; createdAt: number }[],
  nowMs: number,
): { days: string[]; dots: StripDot[] } {
  const days = Array.from({ length: STRIP_DAYS }, (_, i) =>
    dayOf(nowMs - (STRIP_DAYS - 1 - i) * DAY),
  );
  const slots = new Map<string, number>();
  const dots: StripDot[] = [];
  const sorted = [...proposals].sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  );
  for (const p of sorted) {
    const day = dayOf(p.createdAt);
    if (!days.includes(day)) continue;
    const slot = slots.get(day) ?? 0;
    slots.set(day, slot + 1);
    const state =
      p.status === "candidate" ? "waiting" : p.status === "rejected" ? "rejected" : "approved";
    dots.push({ id: p.id, day, state, slot });
  }
  return { days, dots };
}

export interface Kpis {
  waiting: number;
  /** Median hours from filed to decided, over the last 30 days. */
  medianHoursToDecision: number | null;
  overdue: number;
  clearedThisWeek: number;
}

export function kpisOf(i: {
  waiting: number;
  overdue: number;
  decided: readonly { createdAt: number; decidedAt: number }[];
  nowMs: number;
}): Kpis {
  const recent = i.decided.filter((d) => d.decidedAt >= i.nowMs - 30 * DAY);
  const m = median(recent.map((d) => Math.max(0, d.decidedAt - d.createdAt) / HOUR));
  return {
    waiting: i.waiting,
    medianHoursToDecision: m === null ? null : Math.round(m * 10) / 10,
    overdue: i.overdue,
    clearedThisWeek: i.decided.filter((d) => d.decidedAt >= i.nowMs - 7 * DAY).length,
  };
}
