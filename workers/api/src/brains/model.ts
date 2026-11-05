// Shapes and pure rules of the v3 brains (API-CONTRACT "v3 brains"). No I/O here.

import type { BrainType, Everyone, Publication } from "@secondary/policy";
import { citationsOf, linksOf } from "../wiki/text.ts";
import type { SchemaType } from "../wiki/types.ts";

export const DAY = 86_400_000;

export type TemplateId = "personal" | "team" | "account" | "bid" | "practice" | "global" | "blank";
export type Collection = { type: string; label: string; required: string[] };
export interface Template {
  id: TemplateId;
  label: string;
  collections: Collection[];
}

const C = (type: string, label: string, required: string[] = ["Summary"]): Collection => ({
  type,
  label,
  required,
});

export const TEMPLATES: Record<TemplateId, Template> = {
  blank: { id: "blank", label: "Blank", collections: [] },
  personal: {
    id: "personal",
    label: "Personal",
    collections: [C("topic", "Topics"), C("method", "Methods", ["Summary", "Steps"]), C("glossary", "Glossary", ["Terms"])],
  },
  team: {
    id: "team",
    label: "Team or practice",
    collections: [
      C("topic", "Topics"),
      C("method", "Methods", ["Summary", "Steps"]),
      C("expertise", "Expertise"),
      C("glossary", "Glossary", ["Terms"]),
    ],
  },
  account: {
    id: "account",
    label: "Account",
    collections: [
      C("client", "Clients"),
      C("project", "Projects"),
      C("opportunity", "Opportunities"),
      C("bid", "Bids"),
      C("interaction", "Interactions"),
      C("stakeholders", "Stakeholder roles", ["Roles"]),
    ],
  },
  bid: {
    id: "bid",
    label: "Bid",
    collections: [
      C("opportunity", "Opportunities"),
      C("bid", "Bids"),
      C("offer", "Offers"),
      C("method", "Methods", ["Summary", "Steps"]),
      C("success_story", "Success stories"),
    ],
  },
  practice: {
    id: "practice",
    label: "Practice",
    collections: [
      C("expertise", "Expertise"),
      C("method", "Methods", ["Summary", "Steps"]),
      C("success_story", "Success stories"),
      C("entity", "Entities"),
    ],
  },
  global: {
    id: "global",
    label: "Company Global",
    collections: [
      C("method", "Methods", ["Summary", "Steps"]),
      C("topic", "Topics"),
      C("glossary", "Glossary", ["Terms"]),
      C("expertise", "Expertise"),
    ],
  },
};

export const isTemplateId = (v: unknown): v is TemplateId =>
  typeof v === "string" && Object.hasOwn(TEMPLATES, v);

export const defaultTemplate = (t: BrainType): TemplateId =>
  t === "personal" ? "personal" : t === "global" ? "global" : t === "account" ? "account" : "team";

export const schemaTypeOf = (c: Collection): SchemaType => ({ label: c.label, required: c.required });

// ---- business fields ----

export const FIELD_TYPES = ["text", "number", "date", "select", "email", "phone", "url"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export const SENSITIVITIES = ["none", "confidential", "personal"] as const;
export type Sensitivity = (typeof SENSITIVITIES)[number];

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  sensitivity: Sensitivity;
  retentionDays: number | null;
  appliesTo: string[];
}

export const FIELD_KEY = /^[a-z][a-z0-9_]{0,31}$/;
export const MAX_FIELDS = 30;
export const MAX_VALUE = 500;

/** Validate a field schema from a request. Returns the clean list or a code. */
export function parseFields(v: unknown): { ok: true; fields: FieldDef[] } | { ok: false; code: string } {
  if (!Array.isArray(v) || v.length > MAX_FIELDS) return { ok: false, code: "invalid_fields" };
  const seen = new Set<string>();
  const out: FieldDef[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") return { ok: false, code: "invalid_fields" };
    const f = raw as Record<string, unknown>;
    if (typeof f.key !== "string" || !FIELD_KEY.test(f.key) || seen.has(f.key))
      return { ok: false, code: "invalid_field_key" };
    seen.add(f.key);
    const label = typeof f.label === "string" ? f.label.trim() : "";
    if (!label || label.length > 60) return { ok: false, code: "invalid_field_label" };
    if (!(FIELD_TYPES as readonly string[]).includes(f.type as string))
      return { ok: false, code: "invalid_field_type" };
    const sensitivity = f.sensitivity ?? "none";
    if (!(SENSITIVITIES as readonly string[]).includes(sensitivity as string))
      return { ok: false, code: "invalid_sensitivity" };
    let options: string[] | undefined;
    if (f.type === "select") {
      if (
        !Array.isArray(f.options) ||
        f.options.length < 1 ||
        f.options.length > 20 ||
        f.options.some((o) => typeof o !== "string" || !o.trim() || o.length > 60)
      )
        return { ok: false, code: "invalid_field_options" };
      options = [...new Set((f.options as string[]).map((o) => o.trim()))];
    }
    const ret = f.retentionDays ?? null;
    if (ret !== null && (!Number.isInteger(ret) || (ret as number) < 1 || (ret as number) > 3650))
      return { ok: false, code: "invalid_retention" };
    const applies = f.appliesTo ?? [];
    if (
      !Array.isArray(applies) ||
      applies.length > 20 ||
      applies.some((a) => typeof a !== "string" || !/^[a-z][a-z0-9_]{0,40}$/.test(a))
    )
      return { ok: false, code: "invalid_applies_to" };
    out.push({
      key: f.key,
      label,
      type: f.type as FieldType,
      ...(options ? { options } : {}),
      sensitivity: sensitivity as Sensitivity,
      retentionDays: ret as number | null,
      appliesTo: applies as string[],
    });
  }
  return { ok: true, fields: out };
}

/** Check one value against its field type. Returns the normalised value or null when it does not fit. */
export function normaliseValue(f: FieldDef, raw: string): string | null {
  const v = raw.trim();
  if (v.length > MAX_VALUE) return null;
  switch (f.type) {
    case "number":
      return /^-?\d{1,15}(?:\.\d{1,6})?$/.test(v) ? v : null;
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null;
    case "select":
      return f.options?.includes(v) ? v : null;
    case "email":
      return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v) ? v : null;
    case "phone":
      return /^\+?[\d\s().-]{6,24}$/.test(v) ? v : null;
    case "url":
      return /^https:\/\/[^\s<>"']+$/i.test(v) ? v : null;
    default:
      // No markup in a property: they are shown as plain text.
      return /[<>]/.test(v) ? null : v;
  }
}

export const fieldAppliesTo = (f: FieldDef, pageType: string): boolean =>
  f.appliesTo.length === 0 || f.appliesTo.includes(pageType);

// ---- health ----

export interface Component {
  value: number;
  score: number;
}
export interface Health {
  score: number;
  components: {
    lint: Component | null;
    freshness: Component;
    orphans: Component;
    backlog: Component | null;
    coverage: Component & { have: number; want: number; missing: string[] };
  };
}

export interface HealthPage {
  id: string;
  type: string;
  markdown: string;
  updatedAt: number;
}

const WEIGHT = { lint: 25, freshness: 25, orphans: 15, backlog: 15, coverage: 20 } as const;
const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

/**
 * The health strip, from the pages the caller can read. `lint` and `backlog` are the counts of open
 * findings and proposals, given only to someone who can decide them (else null and left out).
 */
export function computeHealth(i: {
  pages: HealthPage[];
  now: number;
  freshnessDays: number;
  lint: number | null;
  backlog: number | null;
  expected: string[];
  /** Page types that are generated or journals: they do not count as orphans or as stale. */
  skipTypes: ReadonlySet<string>;
}): Health {
  const real = i.pages.filter((p) => !i.skipTypes.has(p.type));
  const window = i.freshnessDays * DAY;
  const fresh = real.filter((p) => i.now - p.updatedAt <= window).length;
  const freshPct = real.length ? (fresh / real.length) * 100 : 100;
  const inbound = new Map<string, number>();
  for (const p of i.pages)
    for (const l of linksOf(p.markdown))
      if (l !== p.id && !l.startsWith("global:")) inbound.set(l, (inbound.get(l) ?? 0) + 1);
  const orphans = real.filter((p) => !inbound.get(p.id)).length;
  const have = new Set(i.pages.map((p) => p.type));
  const missing = i.expected.filter((t) => !have.has(t));
  const want = i.expected.length;
  const covPct = want ? ((want - missing.length) / want) * 100 : 100;
  const orphanScore = real.length ? clamp(100 - (orphans / real.length) * 100) : 100;
  const comp = {
    lint: i.lint === null ? null : { value: i.lint, score: clamp(100 - i.lint * 8) },
    freshness: { value: Math.round(freshPct), score: clamp(freshPct) },
    orphans: { value: orphans, score: orphanScore },
    backlog: i.backlog === null ? null : { value: i.backlog, score: clamp(100 - i.backlog * 5) },
    coverage: { value: Math.round(covPct), score: clamp(covPct), have: want - missing.length, want, missing },
  };
  let total = 0;
  let weight = 0;
  for (const k of Object.keys(WEIGHT) as (keyof typeof WEIGHT)[]) {
    const c = comp[k];
    if (c) {
      total += c.score * WEIGHT[k];
      weight += WEIGHT[k];
    }
  }
  return { score: weight ? clamp(total / weight) : 100, components: comp };
}

export const hasCitations = (md: string): boolean => citationsOf(md).length > 0;

// ---- agent hosts ----

export const HOSTS = [
  ["claude_code", "Claude Code"],
  ["claude_ai", "Claude.ai"],
  ["chatgpt", "ChatGPT"],
  ["codex", "Codex"],
  ["dust", "Dust"],
  ["copilot_studio", "Copilot Studio"],
  ["other", "Other"],
] as const;
export type HostId = (typeof HOSTS)[number][0];
export const isHostId = (v: string): v is HostId => HOSTS.some((h) => h[0] === v);

export type { Everyone, Publication };
