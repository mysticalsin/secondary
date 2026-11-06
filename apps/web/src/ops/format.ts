// Small pure formatters for the v7 Operate views. Times are UTC so charts, tooltips and tests agree.
import type { OpsStatus } from "./types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_FR = [
  "janv.",
  "févr.",
  "mars",
  "avr.",
  "mai",
  "juin",
  "juil.",
  "août",
  "sept.",
  "oct.",
  "nov.",
  "déc.",
];

/** `11:04:09` */
export const hms = (iso: string): string => iso.slice(11, 19);
/** `11:04` */
export const hm = (iso: string): string => iso.slice(11, 16);

/** `Nov 6` or `6 nov.` */
export function dayLabel(iso: string, lang: "en" | "fr"): string {
  const m = Number(iso.slice(5, 7)) - 1;
  const d = Number(iso.slice(8, 10));
  return lang === "fr" ? `${d} ${MONTHS_FR[m]}` : `${MONTHS[m]} ${d}`;
}

/** Latency: `640 ms`, `1.2 s`, `13.9 s`, `15.0 s`. */
export function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 60_000)} m`;
}

/** A wait: `5 s`, `30 s`, `3 m`, `1.8 h`, `24 h`. */
export function fmtWait(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} m`;
  if (seconds <= 172_800) {
    const h = Math.round((seconds / 3600) * 10) / 10;
    return `${Number.isInteger(h) ? h : h.toFixed(1)} h`;
  }
  return `${Math.round(seconds / 86_400)} d`;
}

export const pct = (share: number, digits = 1): string => `${(share * 100).toFixed(digits)}%`;

/** Position of a latency on the log axis 100 ms .. 10 s (and beyond, clamped), 0..1. */
export function logPos(ms: number, lo = 100, hi = 15_000): number {
  const v = Math.max(lo, Math.min(hi, ms));
  return Math.log(v / lo) / Math.log(hi / lo);
}

export const isFailing = (s: OpsStatus): boolean =>
  s === "blocked" || s === "failed" || s === "retrying";

/** `ruleId@v3` gives `ruleId`. */
export const ruleName = (ref: string): string => ref.replace(/@.*$/, "");

/** Count with thousands separators for the viewer's locale. */
export const num = (n: number, locale: string): string => new Intl.NumberFormat(locale).format(n);

/** A share as a percent in the viewer's locale: `7.5%` or `7,5 %`. */
export const pctL = (share: number, locale: string, digits = 1): string =>
  new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(share);
