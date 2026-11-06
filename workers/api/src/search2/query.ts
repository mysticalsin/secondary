// The search box language: free words plus operators (`brain:`, `type:`, `fresh:<30d`, `status:`,
// `role:`). Pure and total: any string parses, nothing throws, and an operator is only an operator
// when its value is well formed. Everything else stays a word. Operators only ever narrow a result
// set the caller may already read; they never widen it and never reach a store.

export const MAX_QUERY = 300;
export const MAX_OPS = 8;
const VALUE = /^[\p{L}\p{N}_.:-]{1,64}$/u;
const OP = /^(brain|type|fresh|status|role):(.*)$/iu;

export const STATUSES = ["verified", "unverified"] as const;
export const ROLES = ["owner", "steward", "editor", "contributor", "reader", "system"] as const;
export type StatusValue = (typeof STATUSES)[number];
export type RoleValue = (typeof ROLES)[number];

export interface Fresh {
  /** "lt": younger than `days`. "gt": older than `days`. */
  op: "lt" | "gt";
  days: number;
}

export interface Parsed {
  /** The free words, operators removed, single spaces. */
  text: string;
  brain: string[];
  type: string[];
  status: StatusValue[];
  role: RoleValue[];
  fresh: Fresh | null;
  /** Operators that were written but not understood (kept as words in `text` too, so nothing is lost). */
  ignored: string[];
}

const UNIT_DAYS: Record<string, number> = { d: 1, w: 7, m: 30, y: 365 };

/** `<30d`, `>2w`, `30d` (younger than). Null when it is not a bounded age. */
export function parseFresh(v: string): Fresh | null {
  const m = /^([<>]?)(\d{1,4})([dwmy])$/i.exec(v.trim());
  if (!m) return null;
  const days = Number(m[2]) * (UNIT_DAYS[(m[3] as string).toLowerCase()] as number);
  if (days < 1 || days > 3650) return null;
  return { op: m[1] === ">" ? "gt" : "lt", days };
}

/** Split on spaces, keeping a double-quoted run (`brain:"Company Global"`) together. */
function words(q: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of q) {
    if (ch === '"') quoted = !quoted;
    else if (/\s/u.test(ch) && !quoted) {
      if (cur) out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

export function parseQuery(raw: string): Parsed {
  const q = raw.normalize("NFKC").slice(0, MAX_QUERY);
  const out: Parsed = {
    text: "",
    brain: [],
    type: [],
    status: [],
    role: [],
    fresh: null,
    ignored: [],
  };
  const free: string[] = [];
  let ops = 0;
  for (const w of words(q)) {
    const m = OP.exec(w);
    if (!m || ops >= MAX_OPS) {
      free.push(w);
      continue;
    }
    const key = (m[1] as string).toLowerCase();
    const value = (m[2] as string).trim();
    const bad = () => {
      out.ignored.push(w);
      free.push(w);
    };
    if (key === "fresh") {
      const f = parseFresh(value);
      if (f) {
        out.fresh = f;
        ops++;
      } else bad();
      continue;
    }
    if (!VALUE.test(value)) {
      bad();
      continue;
    }
    const v = value.toLowerCase();
    if (key === "brain") out.brain.push(v);
    else if (key === "type") out.type.push(v);
    else if (key === "status") {
      if ((STATUSES as readonly string[]).includes(v)) out.status.push(v as StatusValue);
      else {
        bad();
        continue;
      }
    } else if ((ROLES as readonly string[]).includes(v)) out.role.push(v as RoleValue);
    else {
      bad();
      continue;
    }
    ops++;
  }
  out.text = free.join(" ");
  return out;
}

/** The query text of a parsed search with its operators written back, for a saved search or a link. */
export function formatQuery(p: Parsed): string {
  const parts = [p.text];
  for (const b of p.brain) parts.push(`brain:${b}`);
  for (const t of p.type) parts.push(`type:${t}`);
  for (const s of p.status) parts.push(`status:${s}`);
  for (const r of p.role) parts.push(`role:${r}`);
  if (p.fresh) parts.push(`fresh:${p.fresh.op === "gt" ? ">" : "<"}${p.fresh.days}d`);
  return parts.filter(Boolean).join(" ");
}

export type FreshBucket = "lt30" | "lt90" | "lt180" | "older";
export const FRESH_BUCKETS: readonly FreshBucket[] = ["lt30", "lt90", "lt180", "older"];
export const bucketOfAge = (days: number): FreshBucket =>
  days < 30 ? "lt30" : days < 90 ? "lt90" : days < 180 ? "lt180" : "older";
