// The retry plan, recomputed locally for an instant preview. Same formula as the API
// (packages/contracts/src/ops-v7.ts retryPlan): exponential waits are min(max, round(base * 6^i)) for
// i in 0..tries-2, linear repeats `every`, fixed uses the listed times.
import type { RetryPolicy } from "./types";

export const EXP_FACTOR = 6;
export const DAY_S = 86_400;

export const DEFAULT_RETRY: RetryPolicy = {
  kind: "exponential",
  baseSeconds: 5,
  maxSeconds: DAY_S,
  tries: 8,
};

export interface PlanStep {
  try: number;
  afterSeconds: number;
  atSeconds: number;
}

export function retryPlan(p: RetryPolicy): PlanStep[] {
  const waits: number[] = [];
  if (p.kind === "exponential")
    for (let i = 0; i < p.tries - 1; i++)
      waits.push(Math.min(p.maxSeconds, Math.round(p.baseSeconds * EXP_FACTOR ** i)));
  else if (p.kind === "linear") for (let i = 0; i < p.tries - 1; i++) waits.push(p.everySeconds);
  else if (p.kind === "fixed") waits.push(...p.times);
  let at = 0;
  return waits.map((afterSeconds, i) => {
    at += afterSeconds;
    return { try: i + 2, afterSeconds, atSeconds: at };
  });
}

/** The default policy of a kind, when the person picks it in the select. */
export function defaultOf(kind: RetryPolicy["kind"]): RetryPolicy {
  if (kind === "exponential") return DEFAULT_RETRY;
  if (kind === "linear") return { kind: "linear", everySeconds: 600, tries: 8 };
  if (kind === "fixed") return { kind: "fixed", times: [30, 300, 1800, 7200] };
  return { kind: "none" };
}

export const samePolicy = (a: RetryPolicy, b: RetryPolicy): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/** Comma separated seconds to a fixed list (1 to 11 whole numbers, 1 s to 1 day), or null. */
export function parseTimes(text: string): number[] | null {
  const parts = text
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map(Number);
  if (parts.length < 1 || parts.length > 11) return null;
  if (parts.some((n) => !Number.isInteger(n) || n < 1 || n > DAY_S)) return null;
  return parts;
}
