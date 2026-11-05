// Pure helpers for the Living Wiki: text hygiene, citations and links, line diffs, the deterministic
// extractor, generated pages, lint and dreaming checks, and de-identification for Promote to Global.
// No I/O, no clock, no model: everything here is testable on its own.

import { excludePersonalSegments, maskContacts } from "../ai/segments.ts";
import type {
  Fact,
  Finding,
  PageDraft,
  PageRow,
  Proposal,
  SourceInfo,
  WikiSchema,
} from "./types.ts";

// ---- hygiene ----

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** One line of plain text. Brackets and braces are removed so extracted text can never forge a citation or a link. */
export const cleanText = (v: unknown, max: number): string =>
  typeof v === "string"
    ? v
        .replace(/\p{Cc}+/gu, " ")
        .replace(/[{}[\]<>]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max)
    : "";

export const slug = (s: string): string =>
  s
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

export const PAGE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const SOURCE_REF = /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,159}$/;

export function tokensOf(q: string): string[] {
  const t = q.normalize("NFKC").toLowerCase();
  return (t.match(/[\p{L}\p{N}]+/gu) ?? []).filter((x) => x.length <= 40).slice(0, 8);
}
/** Any word may match, best matches rank first: a question is not a conjunction. */
export const matchOfTokens = (tokens: string[]): string =>
  tokens.map((t) => `"${t}"*`).join(" OR ");

// ---- citations and links ----

const CITE = /\{src:([A-Za-z0-9][A-Za-z0-9:_.-]{0,159})\}/g;
const LINK = /\[\[([A-Za-z0-9:_-]{1,70})\]\]/g;

export const citationsOf = (s: string): string[] => [
  ...new Set([...s.matchAll(CITE)].map((m) => m[1] as string)),
];
export const linksOf = (s: string): string[] => [
  ...new Set([...s.matchAll(LINK)].map((m) => m[1] as string)),
];
export const withoutCitations = (s: string): string => s.replace(CITE, "").replace(/ +$/gm, "");

/** A claim is a bullet that says something. A bullet made only of page links is navigation. */
export function claimLines(md: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  md.split("\n").forEach((raw, i) => {
    const m = /^\s*[-*]\s+(.+)$/.exec(raw);
    if (!m) return;
    const rest = (m[1] as string)
      .replace(LINK, "")
      .replace(CITE, "")
      .replace(/[\s,;.()]+/g, "");
    if (rest) out.push({ line: i + 1, text: m[1] as string });
  });
  return out;
}

export function sectionsOf(md: string): string[] {
  return [...md.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => (m[1] as string).trim());
}

export function summaryOf(md: string): string {
  for (const raw of md.split("\n")) {
    const t = raw
      .replace(/^\s*[-*]\s+/, "")
      .replace(CITE, "")
      .replace(LINK, "")
      .trim();
    if (!t || t.startsWith("#")) continue;
    return t.length > 160 ? `${t.slice(0, 157)}...` : t;
  }
  return "";
}

// ---- line diff ----

export type DiffLine = { type: "add" | "del" | "same"; text: string };

/** Lines a diff will compare. Above this a page change is shown as a whole replacement (M-03). */
export const MAX_DIFF_LINES = 1_000;
/** Lines a page may hold. */
export const MAX_PAGE_LINES = 1_000;

export const capLines = (md: string, max = MAX_PAGE_LINES): string => {
  const lines = md.split("\n");
  return lines.length > max ? lines.slice(0, max).join("\n") : md;
};

/**
 * Line diff. Common head and tail are trimmed first; the middle is compared with a table of 16-bit
 * counters only while both sides stay under MAX_DIFF_LINES. A bigger change is a plain replacement,
 * so memory and time are bounded by the cap, not by what a page holds.
 */
export function lineDiff(before: string | null, after: string): DiffLine[] {
  const a = before === null ? [] : before.split("\n");
  const b = after.split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  )
    tail++;
  const ma = a.slice(head, a.length - tail);
  const mb = b.slice(head, b.length - tail);
  const out: DiffLine[] = a.slice(0, head).map((text) => ({ type: "same" as const, text }));
  if (ma.length > MAX_DIFF_LINES || mb.length > MAX_DIFF_LINES) {
    for (const text of ma) out.push({ type: "del", text });
    for (const text of mb) out.push({ type: "add", text });
  } else {
    const n = ma.length;
    const m = mb.length;
    const w = m + 1;
    const dp = new Uint16Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[i * w + j] =
          ma[i] === mb[j]
            ? (dp[(i + 1) * w + j + 1] as number) + 1
            : Math.max(dp[(i + 1) * w + j] as number, dp[i * w + j + 1] as number);
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (ma[i] === mb[j]) {
        out.push({ type: "same", text: ma[i] as string });
        i++;
        j++;
      } else if ((dp[(i + 1) * w + j] as number) >= (dp[i * w + j + 1] as number)) {
        out.push({ type: "del", text: ma[i++] as string });
      } else out.push({ type: "add", text: mb[j++] as string });
    }
    while (i < n) out.push({ type: "del", text: ma[i++] as string });
    while (j < m) out.push({ type: "add", text: mb[j++] as string });
  }
  for (const text of a.slice(a.length - tail)) out.push({ type: "same", text });
  return out;
}

// ---- the deterministic extractor ----

export type Extracted = {
  subject: string;
  predicate: string;
  object: string;
  validAt: string;
  confidence: number;
  /** The words of the source this fact came from, one cleaned line, shown next to the fact in review (L-07). */
  excerpt?: string;
};
export type RawSource = {
  itemKind: string;
  title: string;
  body: string;
  tags: string[];
  status: string;
  updatedAt: number;
};

const KINDS = ["decision", "commitment", "risk"] as const;
type FactKind = (typeof KINDS)[number];
const SECTION_KIND: Record<string, FactKind> = { dec: "decision", com: "commitment", risk: "risk" };
const DEFAULT_STATUS: Record<FactKind, string> = {
  decision: "decided",
  commitment: "open",
  risk: "open",
};
const ATTRS = ["status", "owner", "due", "severity"] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Longest source excerpt kept next to a fact. */
export const EXCERPT_MAX = 240;
const iso = (ms: number): string => new Date(ms).toISOString();
const dayIso = (d: string): string => `${d}T00:00:00.000Z`;
const subjectOf = (k: FactKind, title: string): string => `${k}: ${title}`;
export const kindOfSubject = (s: string): FactKind | null => {
  const k = s.split(":", 1)[0] as FactKind;
  return (KINDS as readonly string[]).includes(k) ? k : null;
};
export const titleOfSubject = (s: string): string => s.slice(s.indexOf(":") + 1).trim();

function pushFact(
  out: Extracted[],
  kind: FactKind,
  title: string,
  attrs: Partial<Record<(typeof ATTRS)[number], unknown>>,
  validAt: string,
  excerpt: string,
): void {
  const t = cleanText(title, 160);
  if (t.length < 3) return;
  const given = Object.fromEntries(
    Object.entries(attrs).filter(([, v]) => v !== undefined && v !== null && v !== ""),
  );
  const withStatus: Record<string, unknown> = { status: DEFAULT_STATUS[kind], ...given };
  for (const a of ATTRS) {
    const raw = withStatus[a];
    const v = cleanText(raw, 120);
    if (!v) continue;
    if (a === "due" && !DATE.test(v)) continue;
    out.push({
      subject: subjectOf(kind, t),
      predicate: a,
      object: v,
      validAt,
      confidence: 0.9,
      excerpt: cleanText(excerpt, EXCERPT_MAX),
    });
  }
}

function fromJson(o: Record<string, unknown>, fallbackAt: string): Extracted[] {
  const out: Extracted[] = [];
  const date = typeof o.date === "string" && DATE.test(o.date) ? dayIso(o.date) : fallbackAt;
  const list = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v)
      ? v.slice(0, 30).filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
      : [];
  const shown = (kind: string, x: Record<string, unknown>): string =>
    `${kind}: ${Object.entries(x)
      .filter(([, v]) => typeof v === "string" || typeof v === "number")
      .map(([k, v]) => `${k} ${v}`)
      .join(", ")}`;
  for (const d of list(o.decisions))
    pushFact(
      out,
      "decision",
      d.title as string,
      { status: d.status, owner: d.owner },
      date,
      shown("decision", d),
    );
  for (const c of list(o.commitments))
    pushFact(
      out,
      "commitment",
      c.title as string,
      { status: c.status, owner: c.owner, due: c.due },
      date,
      shown("commitment", c),
    );
  for (const r of list(o.risks))
    pushFact(
      out,
      "risk",
      r.title as string,
      { status: r.status, severity: r.severity },
      date,
      shown("risk", r),
    );
  return out;
}

const LINE = /^\s*(?:[-*]\s*)?(Decision|Commitment|Risk)\s*:\s*(.+?)\s*$/i;

function fromText(body: string, fallbackAt: string): Extracted[] {
  // R-110 before anything else: personal sentences never reach a fact.
  const kept = excludePersonalSegments(body).kept;
  const out: Extracted[] = [];
  let date = fallbackAt;
  for (const line of kept.split("\n").slice(0, 400)) {
    const d = /^\s*Date\s*:\s*(\d{4}-\d{2}-\d{2})\b/i.exec(line);
    if (d) {
      date = dayIso(d[1] as string);
      continue;
    }
    const m = LINE.exec(line);
    if (!m) continue;
    const kind = (m[1] as string).toLowerCase() as FactKind;
    let title = m[2] as string;
    const attrs: Record<string, string> = {};
    const p = /\(([^()]*)\)\s*$/.exec(title);
    if (p) {
      title = title.slice(0, p.index).trim();
      for (const part of (p[1] as string).split(/[,;]/)) {
        const kv = /^\s*(status|owner|due|severity)\s*:\s*(.+?)\s*$/i.exec(part);
        if (kv) attrs[(kv[1] as string).toLowerCase()] = kv[2] as string;
      }
    }
    pushFact(out, kind, title, attrs, date, line);
  }
  return out;
}

/** Decisions, commitments and risks from structured records and meeting records. Free text yields only "Decision:", "Commitment:" and "Risk:" lines. */
export function extractFacts(s: RawSource): Extracted[] {
  const at = iso(s.updatedAt);
  const section = s.tags.find((t) => t in SECTION_KIND);
  let json: Record<string, unknown> | null = null;
  try {
    const v: unknown = JSON.parse(s.body);
    if (v && typeof v === "object" && !Array.isArray(v)) json = v as Record<string, unknown>;
  } catch {
    json = null;
  }
  if (s.itemKind === "record") {
    const kind = section ? SECTION_KIND[section] : undefined;
    if (!kind) return [];
    const out: Extracted[] = [];
    pushFact(
      out,
      kind,
      s.title,
      { status: s.status, owner: json?.ownerRole, due: json?.due },
      at,
      `${s.title} (record, status ${s.status})`,
    );
    return out;
  }
  if (json) return fromJson(json, at);
  return fromText(`${s.title}\n${s.body}`, at);
}

// ---- generated pages ----

export const GENERATED: Record<string, { id: string; title: string; kind: FactKind | null }> = {
  overview: { id: "overview", title: "Overview", kind: null },
  decision_log: { id: "decision-log", title: "Decision log", kind: "decision" },
  commitments: { id: "commitments", title: "Commitments", kind: "commitment" },
  risk_register: { id: "risk-register", title: "Risk register", kind: "risk" },
};
const HEADING: Record<FactKind, string> = {
  decision: "Decisions",
  commitment: "Commitments",
  risk: "Risks",
};
const TYPE_OF_KIND: Record<FactKind, string> = {
  decision: "decision_log",
  commitment: "commitments",
  risk: "risk_register",
};
const cite = (ids: string[]): string => ids.map((i) => `{src:${i}}`).join("");
const ATTR_ORDER = ["status", "owner", "due", "severity"];

type Entity = { subject: string; attrs: Map<string, string>; sources: string[] };
function entitiesOf(facts: Pick<Fact, "subject" | "predicate" | "object" | "sourceIds">[]) {
  const by = new Map<string, Entity>();
  for (const f of facts) {
    const e: Entity = by.get(f.subject) ?? {
      subject: f.subject,
      attrs: new Map<string, string>(),
      sources: [],
    };
    e.attrs.set(f.predicate, f.object);
    for (const id of f.sourceIds) if (!e.sources.includes(id)) e.sources.push(id);
    by.set(f.subject, e);
  }
  return [...by.values()].sort((a, b) => a.subject.localeCompare(b.subject));
}
const attrText = (e: Entity): string =>
  [...e.attrs.entries()]
    .sort((a, b) => ATTR_ORDER.indexOf(a[0]) - ATTR_ORDER.indexOf(b[0]) || a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k} ${v}`)
    .join("; ");

/** The markdown of a generated page from the facts that hold now. null when there is nothing to say. */
export function renderGenerated(
  type: string,
  valid: Pick<Fact, "subject" | "predicate" | "object" | "sourceIds">[],
  otherPageIds: string[],
): string | null {
  const g = GENERATED[type];
  if (!g) return null;
  if (g.kind) {
    const ents = entitiesOf(valid.filter((f) => kindOfSubject(f.subject) === g.kind));
    if (!ents.length) return null;
    return [
      `# ${g.title}`,
      "",
      `## ${HEADING[g.kind]}`,
      ...ents.map((e) => `- ${titleOfSubject(e.subject)}: ${attrText(e)} ${cite(e.sources)}`),
      "",
    ].join("\n");
  }
  // overview
  const open: string[] = [];
  for (const e of entitiesOf(valid)) {
    const k = kindOfSubject(e.subject);
    if (!k) continue;
    const status = e.attrs.get("status") ?? DEFAULT_STATUS[k];
    const settled = status === "decided" || status === "done" || status === "closed";
    if (settled) continue;
    const due = e.attrs.get("due");
    const label = k === "decision" ? "Decision" : k === "commitment" ? "Commitment" : "Risk";
    open.push(
      `- ${label} ${status}: ${titleOfSubject(e.subject)}${due ? ` (due ${due})` : ""} ${cite(e.sources)}`,
    );
  }
  if (!open.length && !otherPageIds.length) return null;
  return [
    "# Overview",
    "",
    "## Needs attention",
    ...(open.length ? open : ["Nothing needs attention."]),
    "",
    "## Pages",
    ...(otherPageIds.length ? otherPageIds.map((id) => `- [[${id}]]`) : ["No other pages yet."]),
    "",
  ].join("\n");
}
export const generatedTypeOfKind = (k: FactKind): string => TYPE_OF_KIND[k];

/** What a generated page says once every fact it listed has ended. */
export function emptyGenerated(type: string): string {
  const g = GENERATED[type];
  const heading = g?.kind ? HEADING[g.kind] : "Needs attention";
  return `# ${g?.title ?? type}\n\n## ${heading}\nNone recorded.\n`;
}

// ---- lint ----

export type LintInput = {
  pages: Pick<PageRow, "id" | "type" | "title" | "markdown" | "revision">[];
  facts: Fact[];
  /** Current content hash of each source the facts cite. A missing key means the source is gone. */
  hashes: Record<string, string | undefined>;
  schema: WikiSchema;
  now: number;
  freshnessDays: number;
};

const ms = (s: string): number => Date.parse(s);
const MAX_PER_KIND = 20;

export function lintFindings(i: LintInput): Finding[] {
  const out: Finding[] = [];
  const add = (f: Finding, n: Map<string, number>) => {
    const c = n.get(f.kind) ?? 0;
    if (c >= MAX_PER_KIND) return;
    n.set(f.kind, c + 1);
    out.push(f);
  };
  const count = new Map<string, number>();
  const empty = { pages: [], facts: [], invalidate: [], confirm: [], archive: [], reingest: [] };

  // contradictions: same subject and predicate, overlapping validity, different object
  const groups = new Map<string, Fact[]>();
  for (const f of i.facts) {
    const k = `${f.subject}\u0000${f.predicate}`;
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  for (const g of groups.values()) {
    const sorted = [...g].sort((a, b) => ms(a.validAt) - ms(b.validAt) || a.id - b.id);
    for (let x = 0; x < sorted.length; x++)
      for (let y = x + 1; y < sorted.length; y++) {
        const a = sorted[x] as Fact;
        const b = sorted[y] as Fact;
        if (a.object === b.object) continue;
        const overlap = a.invalidAt === null || ms(b.validAt) < ms(a.invalidAt);
        if (!overlap) continue;
        add(
          {
            key: `contra:${a.id}:${b.id}`,
            kind: "contradiction",
            title: `Contradiction: ${titleOfSubject(a.subject)} (${a.predicate})`,
            detail: `"${a.object}" (from ${a.validAt.slice(0, 10)}) and "${b.object}" (from ${b.validAt.slice(0, 10)}) are both valid. Approving ends the older one at ${b.validAt.slice(0, 10)}; both stay in the history.`,
            proposal: {
              ...empty,
              title: "",
              invalidate: [{ factId: a.id, at: b.validAt }],
              titleSources: [...new Set([...a.sourceIds, ...b.sourceIds])],
            },
          },
          count,
        );
      }
  }

  const valid = i.facts.filter((f) => f.invalidAt === null);

  // source hash changed, or the source is gone
  const affected = new Map<string, Fact[]>();
  for (const f of valid)
    for (const id of f.sourceIds) {
      const cur = i.hashes[id];
      if (cur === undefined || cur !== f.sourceHashes[id])
        affected.set(`${id}\u0000${cur ?? "gone"}`, [
          ...(affected.get(`${id}\u0000${cur ?? "gone"}`) ?? []),
          f,
        ]);
    }
  for (const [k, fs] of affected) {
    const [id, cur] = k.split("\u0000") as [string, string];
    add(
      {
        key: cur === "gone" ? `gone:${id}` : `hash:${id}:${cur.slice(0, 12)}`,
        kind: "source_changed",
        title: cur === "gone" ? `Source removed: ${id}` : `Source changed: ${id}`,
        detail: `${fs.length} claim${fs.length === 1 ? "" : "s"} cite ${id}, which ${cur === "gone" ? "no longer exists" : "has changed since they were recorded"}. Approving re-reads the source and proposes the update.`,
        proposal: {
          ...empty,
          title: "",
          reingest: cur === "gone" ? [] : [id],
          titleSources: [id],
        },
      },
      count,
    );
  }

  // stale claims
  const window = i.freshnessDays * 86_400_000;
  for (const f of valid) {
    const last = Math.max(ms(f.recordedAt), ms(f.checkedAt));
    if (i.now - last > window)
      add(
        {
          key: `stale:${f.id}:${Math.floor(last / 86_400_000)}`,
          kind: "stale",
          title: `Stale: ${titleOfSubject(f.subject)} (${f.predicate})`,
          detail: `Last confirmed ${new Date(last).toISOString().slice(0, 10)}, more than ${i.freshnessDays} days ago. Approving confirms it still holds.`,
          proposal: { ...empty, title: "", confirm: [f.id], titleSources: f.sourceIds },
        },
        count,
      );
    if (f.sourceIds.length === 0)
      add(
        {
          key: `uncited:fact:${f.id}`,
          kind: "uncited",
          title: `Uncited claim: ${titleOfSubject(f.subject)} (${f.predicate})`,
          detail: "This fact has no source. Add a source or retire it.",
          proposal: { ...empty, title: "", titleSources: f.sourceIds },
        },
        count,
      );
  }

  // page checks
  const ids = new Set(i.pages.map((p) => p.id));
  const inbound = new Map<string, number>();
  for (const p of i.pages) {
    if (p.type === "overview") continue;
    for (const l of linksOf(p.markdown)) if (l !== p.id) inbound.set(l, (inbound.get(l) ?? 0) + 1);
  }
  for (const p of i.pages) {
    if (!GENERATED[p.type] && !inbound.get(p.id) && p.type !== "overview")
      add(
        {
          key: `orphan:${p.id}`,
          kind: "orphan",
          title: `Orphan page: ${p.title}`,
          detail: "No other page links here. Link it from a related page, or acknowledge.",
          proposal: { ...empty, title: "", subjectPages: [p.id] },
        },
        count,
      );
    for (const l of linksOf(p.markdown)) {
      if (l.startsWith("global:") || ids.has(l)) continue;
      add(
        {
          key: `link:${p.id}:${l}`,
          kind: "broken_link",
          title: `Broken link in ${p.title}: ${l}`,
          detail:
            "The target is not a page of this wiki. Links across workspaces exist only toward Company Global.",
          proposal: {
            ...empty,
            title: "",
            subjectPages: [p.id],
            pages: [
              {
                pageId: p.id,
                type: p.type,
                title: p.title,
                baseRevision: p.revision,
                markdown: p.markdown.replace(
                  new RegExp(`\\[\\[${l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\]`, "g"),
                  "",
                ),
              },
            ],
          },
        },
        count,
      );
    }
    const bad = claimLines(p.markdown).filter((c) => citationsOf(c.text).length === 0);
    if (bad.length)
      add(
        {
          key: `uncited:${p.id}:${p.revision}`,
          kind: "uncited",
          title: `Uncited claims in ${p.title}`,
          detail: `${bad.length} line${bad.length === 1 ? "" : "s"} without a source, for example: ${bad[0]?.text.slice(0, 80)}`,
          proposal: { ...empty, title: "", subjectPages: [p.id] },
        },
        count,
      );
    const have = new Set(sectionsOf(p.markdown));
    for (const need of i.schema.types[p.type]?.required ?? [])
      if (!have.has(need))
        add(
          {
            key: `schema:${p.id}:${slug(need)}`,
            kind: "schema",
            title: `Missing section "${need}" in ${p.title}`,
            detail: `The schema for ${p.type} requires a "${need}" section.`,
            proposal: { ...empty, title: "", subjectPages: [p.id] },
          },
          count,
        );
  }
  return out;
}

// ---- dreaming ----

export type DreamDraft = {
  key: string;
  title: string;
  detail: string;
  pages: Proposal["pages"];
  archive: string[];
};

const wordSet = (s: string): Set<string> =>
  new Set((s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []) as string[]);
const jaccard = (a: Set<string>, b: Set<string>): number => {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / (a.size + b.size - n);
};

/** Merges, summary refreshes and cross-links inside one wiki. Pure: it returns drafts, it writes nothing. */
export function dreamDrafts(
  pages: Pick<PageRow, "id" | "type" | "title" | "markdown" | "revision" | "createdAt">[],
  max = 10,
): DreamDraft[] {
  const out: DreamDraft[] = [];
  const authored = pages.filter((p) => !GENERATED[p.type]);
  const merged = new Set<string>();
  for (let x = 0; x < authored.length; x++)
    for (let y = x + 1; y < authored.length; y++) {
      const [a, b] = [authored[x], authored[y]].sort(
        (p, q) => (p?.createdAt ?? 0) - (q?.createdAt ?? 0),
      ) as [(typeof authored)[number], (typeof authored)[number]];
      if (merged.has(a.id) || merged.has(b.id)) continue;
      const same =
        slug(a.title) === slug(b.title) || jaccard(wordSet(a.title), wordSet(b.title)) >= 0.8;
      if (!same) continue;
      merged.add(b.id);
      const extra = b.markdown
        .split("\n")
        .filter((l) => /^\s*[-*]\s+/.test(l) && !a.markdown.includes(l))
        .join("\n");
      out.push({
        key: `dream:merge:${a.id}:${b.id}`,
        title: `Merge "${b.title}" into "${a.title}"`,
        detail:
          "Two pages cover the same topic. Approving keeps the older page, adds the lines it lacks, and archives the other.",
        pages: [
          {
            pageId: a.id,
            type: a.type,
            title: a.title,
            baseRevision: a.revision,
            markdown: `${a.markdown.trimEnd()}\n${extra ? `\n## Merged from ${b.title}\n${extra}\n` : ""}`,
          },
        ],
        archive: [b.id],
      });
    }
  for (const p of authored) {
    if (merged.has(p.id)) continue;
    if (p.type === "topic" || p.type === "method") {
      if (!sectionsOf(p.markdown).includes("Summary")) {
        const first = claimLines(p.markdown).slice(0, 2);
        if (first.length)
          out.push({
            key: `dream:summary:${p.id}:${p.revision}`,
            title: `Add a summary to "${p.title}"`,
            detail:
              "The page has no Summary section. Approving adds one from its first cited lines.",
            pages: [
              {
                pageId: p.id,
                type: p.type,
                title: p.title,
                baseRevision: p.revision,
                markdown: `${p.markdown.trimEnd()}\n\n## Summary\n${first.map((c) => `- ${c.text}`).join("\n")}\n`,
              },
            ],
            archive: [],
          });
      }
    }
    for (const q of authored) {
      if (q.id === p.id || merged.has(q.id) || q.title.length < 4) continue;
      if (linksOf(p.markdown).includes(q.id)) continue;
      const re = new RegExp(`\\b${q.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      const lines = p.markdown.split("\n");
      const at = lines.findIndex((l) => !l.startsWith("#") && re.test(l));
      if (at < 0) continue;
      lines[at] = `${lines[at]} ([[${q.id}]])`;
      out.push({
        key: `dream:link:${p.id}:${q.id}`,
        title: `Link "${p.title}" to "${q.title}"`,
        detail: `"${q.title}" is mentioned without a link. Approving adds the link.`,
        pages: [
          {
            pageId: p.id,
            type: p.type,
            title: p.title,
            baseRevision: p.revision,
            markdown: lines.join("\n"),
          },
        ],
        archive: [],
      });
    }
  }
  return out.slice(0, max);
}

// ---- de-identification for Promote to Global ----

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Words of a company name that say nothing about who it is. */
const GENERIC_NAME = new Set([
  "group",
  "groupe",
  "company",
  "corp",
  "corporation",
  "holding",
  "holdings",
  "limited",
  "ltd",
  "inc",
  "llc",
  "gmbh",
  "synthetic",
  "the",
  "and",
]);

/** What identifies the account in free text: its ids, its label, and each distinctive word of the label. */
export function accountIdentifiers(ids: string[]): string[] {
  const out = new Set<string>();
  for (const id of ids) {
    const t = id.trim();
    if (t.length < 3) continue;
    out.add(t);
    for (const w of t.split(/[^\p{L}\p{N}]+/u))
      if (w.length >= 4 && !GENERIC_NAME.has(w.toLowerCase())) out.add(w);
  }
  return [...out].sort((a, b) => b.length - a.length);
}

const URL_RE = /\b(?:https?:\/\/|ftp:\/\/|www\.)[^\s)<>\]]+/gi;
const DOMAIN_RE = /\b(?:[a-z0-9-]+\.)+(?:[a-z]{2,24})(?:\/[^\s)<>\]]*)?/gi;
const REF_RE = /\b(?:rec|src|cand|pi|pb|mtg|ud|a|c|d|u|g)[:_][A-Za-z0-9:_.-]{2,}/g;

/**
 * Generalises an account page: no citations, no page links, no ids, no account name, no URLs, no
 * contact details. The caller must still run `residualIdentifiers` and the sensitivity scan on it.
 */
export function generalise(md: string, identifiers: string[]): string {
  let t = md.replace(CITE, "").replace(LINK, "");
  t = t.replace(URL_RE, "").replace(REF_RE, "");
  t = maskContacts(t);
  t = t.replace(DOMAIN_RE, (m) => (/^\d+(?:\.\d+)+$/.test(m) ? m : ""));
  for (const id of accountIdentifiers(identifiers))
    t = t.replace(new RegExp(esc(id), "gi"), "the client");
  t = t
    .replace(/\b(?:rec|src|cand|pi|pb):[A-Za-z0-9:_.-]+/g, "")
    .replace(/\b[a-z]_[a-z0-9_]{2,}\b/g, "")
    .replace(/\b(?:acct|a)_[A-Za-z0-9_-]+\b/g, "");
  return t
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/g, "").replace(/ {2,}/g, " "))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** What is still in a generalised text that must not reach Company Global. Empty means clean. */
export function residualIdentifiers(text: string, identifiers: string[]): string[] {
  const left: string[] = [];
  const low = text.toLowerCase();
  for (const id of accountIdentifiers(identifiers))
    if (low.includes(id.toLowerCase())) left.push("account name or id");
  if (/\{src:|\[\[/.test(text)) left.push("citation or link");
  if (/\b(?:https?:\/\/|www\.)/i.test(text)) left.push("url");
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/.test(text)) left.push("email");
  if (REF_RE.test(text)) left.push("record or source id");
  REF_RE.lastIndex = 0;
  return [...new Set(left)];
}

// ---- dev seed: page drafts from raw records ----

const bulletOf = /^\s*[-*]\s+/;
const linkOnly = (line: string): boolean =>
  !line
    .replace(bulletOf, "")
    .replace(/\[\[[^\]]+\]\]/g, "")
    .replace(/[\s,;.()]+/g, "");

/**
 * The page a seed source stands for, drafted without a model. A record tagged `page:<type>` holds the
 * page as Markdown; each claim bullet gets a citation to the record. A meeting record becomes an
 * interaction page from its decisions, commitments and risks. A page a person has since taken over
 * (origin "human") is never redrafted.
 */
export function seedPageDrafts(
  info: Pick<SourceInfo, "id" | "title" | "body" | "tags" | "itemKind">,
  pages: Pick<PageRow, "id" | "type" | "revision" | "origin">[],
): PageDraft[] {
  let type: string | null = null;
  let title = info.title;
  let markdown = "";
  const tag = info.tags.find((t) => t.startsWith("page:"));
  if (tag) {
    type = tag.slice(5);
    const lines = info.body.split("\n");
    const h = lines.find((l) => /^#\s+/.test(l));
    if (h) title = cleanText(h.replace(/^#\s+/, ""), 120) || info.title;
    markdown = lines
      .map((l) =>
        bulletOf.test(l) && !linkOnly(l) && !citationsOf(l).length
          ? `${l.trimEnd()} {src:${info.id}}`
          : l,
      )
      .join("\n");
  } else if (info.itemKind === "meeting_record") {
    let j: Record<string, unknown> | null = null;
    try {
      const v: unknown = JSON.parse(info.body);
      if (v && typeof v === "object" && !Array.isArray(v)) j = v as Record<string, unknown>;
    } catch {
      j = null;
    }
    if (!j) return [];
    type = "interaction";
    const list = (v: unknown): Record<string, unknown>[] =>
      Array.isArray(v)
        ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
        : [];
    const part = (x: Record<string, unknown>, keys: string[]): string => {
      const extra = keys
        .filter((k) => typeof x[k] === "string" && x[k])
        .map((k) => `${k} ${cleanText(x[k], 60)}`)
        .join(", ");
      return `- ${cleanText(x.title, 160)}${extra ? ` (${extra})` : ""} {src:${info.id}}`;
    };
    const out = [`# ${title}`, "", "## Summary"];
    const when = typeof j.date === "string" ? `Held on ${j.date}. ` : "";
    out.push(
      `- ${when}${cleanText(j.notes, 300) || "Notes are in the raw record."} {src:${info.id}}`,
    );
    const sections: [string, Record<string, unknown>[], string[]][] = [
      ["Decisions", list(j.decisions), ["status", "owner"]],
      ["Commitments", list(j.commitments), ["owner", "due", "status"]],
      ["Risks", list(j.risks), ["severity", "status"]],
    ];
    for (const [h2, items, keys] of sections)
      if (items.length) out.push("", `## ${h2}`, ...items.slice(0, 10).map((x) => part(x, keys)));
    markdown = out.join("\n");
  }
  if (!type || !markdown.trim()) return [];
  const id = slug(title);
  if (!PAGE_ID.test(id)) return [];
  const cur = pages.find((p) => p.id === id);
  if (cur && cur.origin !== "seed") return [];
  return [{ pageId: id, type, title, baseRevision: cur?.revision ?? null, markdown }];
}
