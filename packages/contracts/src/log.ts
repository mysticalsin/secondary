// Structured logs for every worker. One JSON object per line, built from an allowlist of keys, so
// content, emails and tokens cannot reach a log by accident. Values are redacted a second time.
// Pure TypeScript, safe in workerd. Workers import this file by relative path.

export const LOG_KEYS = [
  "event",
  "worker",
  "env",
  "requestId",
  "principal",
  "tenant",
  "route",
  "method",
  "status",
  "latencyMs",
  "check",
  "ok",
  "count",
  "reason",
  "errorName",
] as const;
export type LogKey = (typeof LOG_KEYS)[number];
export type LogFields = Partial<Record<LogKey, string | number | boolean | null>>;

const MAX_VALUE = 200;
// Emails, JWTs, bearer tokens, key=value secrets and long opaque tokens.
const REDACTIONS: [RegExp, string][] = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
  [/eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}(\.[A-Za-z0-9_-]*)?/g, "[token]"],
  [/\bBearer\s+\S+/gi, "[token]"],
  [/\b(token|secret|password|key|authorization)\s*[=:]\s*\S+/gi, "$1=[redacted]"],
  [/[A-Za-z0-9+/_-]{40,}={0,2}/g, "[token]"],
];

export function redact(value: string): string {
  let out = value;
  for (const [re, to] of REDACTIONS) out = out.replace(re, to);
  return out.length > MAX_VALUE ? `${out.slice(0, MAX_VALUE)}...` : out;
}

/** Keeps allowlisted keys with primitive values only. Anything else is dropped, strings are redacted. */
export function buildLogLine(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { at: new Date().toISOString() };
  for (const k of LOG_KEYS) {
    const v = fields[k];
    if (typeof v === "string") out[k] = redact(v);
    else if (typeof v === "number" || typeof v === "boolean" || v === null) out[k] = v;
  }
  return out;
}

export function logEvent(fields: Record<string, unknown>): void {
  console.log(JSON.stringify(buildLogLine(fields)));
}

/** Stable, non-reversible handle for a principal id: first 16 hex characters of SHA-256. */
export async function principalHash(principalId: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(principalId));
  return Array.from(new Uint8Array(d).slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}
