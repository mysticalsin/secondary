/**
 * The day-counter body on an `ai:usage` row. The writer stores a canonical
 * non-negative integer. Anything else is unreadable and must not be treated as zero.
 */

export type UsageBody =
  | { ok: true; used: number }
  | { ok: false; at: "usage_unreadable"; key: string };

const CANONICAL = /^(0|[1-9][0-9]*)$/;

/**
 * Empty (null, undefined, or "") is zero: the row has no spend recorded.
 * A canonical integer is that usage. Corrupt text, a negative, NaN, and any
 * other value are unreadable. The failure names the row key and not the body.
 */
export function decodeUsageBody(body: unknown, key: string): UsageBody {
  if (body == null || body === "") return { ok: true, used: 0 };
  if (typeof body !== "string" || !CANONICAL.test(body)) {
    return { ok: false, at: "usage_unreadable", key };
  }
  const used = Number(body);
  if (!Number.isSafeInteger(used)) return { ok: false, at: "usage_unreadable", key };
  return { ok: true, used };
}
