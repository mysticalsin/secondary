// Knowledge gaps, pure part (docs/DESIGN-V8-AMAZING.md section 2): how a question is normalised so
// near-duplicates merge, when text may be kept at all, and how gaps rank.

import { excludePersonalSegments } from "../ai/segments.ts";
import { detectSensitivity } from "../sensitivity.ts";

export const DAY = 86_400_000;
export const GAP_TEXT_MAX = 200;
export const GAPS_PER_BRAIN = 500;
export const DAYS_KEPT = 30;
export const DAYS_SHOWN = 14;
export const ASKERS_KEPT = 200;
export const DUE_MAX_DAYS = 180;

export type GapStatus = "open" | "assigned" | "drafted" | "closed" | "dismissed" | "merged";
export type GapSource = "ask" | "agent" | "search";
export const DISMISS_REASONS = [
  "not_relevant",
  "answered_elsewhere",
  "out_of_scope",
  "duplicate",
  "other",
] as const;
export type DismissReason = (typeof DISMISS_REASONS)[number];

const STOP = new Set(
  (
    "a an the of to in on for and or is are was were be been do does did what which who whom how why when where " +
    "can could should would will our we you your my me i it its this that these those with about from by at as " +
    "le la les un une des du de et ou est sont quel quelle quels comment pourquoi quand ou que qui nous vous notre " +
    "votre mon ma mes pour dans sur avec par au aux ce cet cette ces il elle"
  ).split(" "),
);

/** Lower-case words without accents, punctuation or filler. */
export function wordsOf(text: string): string[] {
  return (
    text
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .match(/[a-z0-9]+/g) ?? []
  ).filter((w) => w.length > 1 && !STOP.has(w));
}

/**
 * The merge key: the meaningful words, de-duplicated and sorted, so "What is our pricing method?"
 * and "pricing method" are one gap. Empty when nothing meaningful is left.
 */
export function normalise(text: string): string {
  return [...new Set(wordsOf(text))].sort().join(" ");
}

/** Pretty text for the gap list: the question as asked, trimmed and tidied. */
export const tidy = (text: string): string =>
  text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[?!.\s]+$/, "")
    .slice(0, GAP_TEXT_MAX);

export type Keep = { ok: true; text: string; key: string } | { ok: false; reason: string };

/**
 * May this text be stored? Never when it looks like personal data (R-110): emails, phone numbers and
 * health, family, HR or private-life wording drop the whole signal. Nothing is stored for a flagged text.
 */
export function keepable(raw: string): Keep {
  const text = tidy(raw);
  if (!text || raw.length > GAP_TEXT_MAX * 3) return { ok: false, reason: "length" };
  const key = normalise(text);
  if (!key) return { ok: false, reason: "empty" };
  if (detectSensitivity({ body: text }).length) return { ok: false, reason: "personal_data" };
  if (excludePersonalSegments(text).excluded.length) return { ok: false, reason: "personal_data" };
  return { ok: true, text, key };
}

/** The sentence-case title a started page begins with. */
export function titleOf(text: string): string {
  const t = tidy(text);
  return (t.charAt(0).toUpperCase() + t.slice(1)).slice(0, 120);
}

export interface GapIn {
  count: number;
  askers: number;
  lastAt: number;
}

/** Frequency and recency: (asks + people) halves every two weeks without a new one. */
export function scoreOf(g: GapIn, nowMs: number): number {
  const idle = Math.max(0, nowMs - g.lastAt) / DAY;
  return Math.round((g.count + g.askers) * 0.5 ** (idle / 14) * 100) / 100;
}

export const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** The last `n` days as `{date, count}`, oldest first. */
export function daysOf(
  days: Record<string, number>,
  nowMs: number,
  n = DAYS_SHOWN,
): { date: string; count: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const date = dayOf(nowMs - (n - 1 - i) * DAY);
    return { date, count: days[date] ?? 0 };
  });
}

/** Closure rate in percent over gaps that needed an answer: closed / (closed + still open). */
export function closureRate(statuses: readonly GapStatus[]): number | null {
  const closed = statuses.filter((s) => s === "closed").length;
  const live = statuses.filter(
    (s) => s === "open" || s === "assigned" || s === "drafted" || s === "closed",
  ).length;
  return live ? Math.round((closed / live) * 100) : null;
}
