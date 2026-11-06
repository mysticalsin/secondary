// Dev mock for the v8 lens endpoints (docs/API-CONTRACT.md "v8 lens"): page lens, Who knows, faceted
// search with saved searches, expert listing and pulse. Synthetic data only. It follows the same
// rules as the API: a role sees only the brains and pages the mock's stand-in policy opens for it, an
// unreadable page is a 404, nothing from an unreadable brain appears in a graph, a list or a count,
// and a person who left the expert listing is named nowhere. The real API is the only place access
// is decided.
import { ApiError } from "../api";
import { type MockPage, NOT_HANDLED, PAGES, seen, TYPE_LABEL, WS_LABEL } from "./uxv2";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-05T18:00:00.000Z");
const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();
const day = (daysAgo: number) => iso(daysAgo).slice(0, 10);

// ---- people: synthetic, each with the persona they stand for ----

interface Person {
  id: string;
  name: string;
  /** The brain role the person holds where they work. */
  role: "owner" | "steward" | "editor" | "contributor" | "reader";
}
const PEOPLE: Record<string, Person> = {
  ceo: { id: "u_ceo", name: "Ines Moreau", role: "reader" },
  head_bid: { id: "u_head_bid", name: "Grace Hopper", role: "steward" },
  acme_lead: { id: "u_acme_lead", name: "Katherine Johnson", role: "owner" },
  consultant: { id: "u_consultant", name: "Ada Lovelace", role: "contributor" },
  reviewer: { id: "u_reviewer", name: "Alan Turing", role: "editor" },
  platform_admin: { id: "u_platform_admin", name: "Radia Perlman", role: "owner" },
  auditor: { id: "u_auditor", name: "Donald Knuth", role: "reader" },
};

/** Who changed which page, how many approved changes, and how long ago the last one was. */
const CONTRIB: Record<string, [persona: string, changes: number, lastDaysAgo: number][]> = {
  "c_bid/bid-playbook": [
    ["head_bid", 7, 3],
    ["reviewer", 3, 12],
    ["consultant", 2, 40],
  ],
  "c_bid/bid-checklist": [
    ["head_bid", 4, 9],
    ["consultant", 3, 21],
  ],
  "c_bid/pricing-guide": [
    ["head_bid", 5, 6],
    ["reviewer", 1, 70],
  ],
  "c_bid/bid-overview": [["head_bid", 2, 15]],
  "core/bid-playbook": [
    ["head_bid", 6, 5],
    ["reviewer", 4, 18],
    ["acme_lead", 1, 90],
  ],
  "core/success-stories": [
    ["acme_lead", 5, 8],
    ["head_bid", 2, 33],
  ],
  "core/data-governance": [
    ["reviewer", 6, 4],
    ["consultant", 2, 26],
  ],
  "core/delivery-handbook": [
    ["consultant", 5, 2],
    ["reviewer", 3, 19],
  ],
  "core/mantu-overview": [["reviewer", 2, 30]],
  "a_acme/acme-overview": [
    ["acme_lead", 8, 1],
    ["head_bid", 2, 22],
  ],
  "a_acme/acme-health-check": [
    ["acme_lead", 3, 6],
    ["consultant", 2, 11],
  ],
  "a_acme/acme-kickoff": [["acme_lead", 2, 3]],
  "c_delivery/delivery-rituals": [
    ["consultant", 6, 5],
    ["reviewer", 2, 44],
  ],
  "c_sales/sales-pipeline": [["ceo", 1, 60]],
};

/** Links the synthetic wiki adds to those in the text, so the local graph has something to draw. */
const EXTRA_LINKS: [from: string, to: string][] = [
  ["c_bid/bid-playbook", "c_bid/bid-checklist"],
  ["c_bid/bid-playbook", "c_bid/pricing-guide"],
  ["c_bid/pricing-guide", "c_bid/bid-checklist"],
  ["c_bid/bid-overview", "c_bid/bid-playbook"],
  ["c_bid/bid-overview", "c_bid/pricing-guide"],
  ["c_bid/bid-playbook", "core/bid-playbook"],
  ["c_bid/pricing-guide", "core/success-stories"],
  ["core/bid-playbook", "core/data-governance"],
  ["core/success-stories", "core/delivery-handbook"],
  ["core/mantu-overview", "core/success-stories"],
  ["core/mantu-overview", "core/data-governance"],
  ["core/delivery-handbook", "core/mantu-entity"],
  ["a_acme/acme-kickoff", "a_acme/acme-health-check"],
  ["a_acme/acme-overview", "a_acme/acme-kickoff"],
  ["a_acme/acme-health-check", "core/bid-playbook"],
  ["c_delivery/delivery-rituals", "core/delivery-handbook"],
];

const key = (p: MockPage) => `${p.ws}/${p.id}`;
const label = (ws: string) => WS_LABEL[ws] ?? ws;
const brainName = (ws: string) => (ws === "me" ? "My Secondary" : label(ws));

interface Link {
  from: string;
  to: string;
}
const LINKS: Link[] = (() => {
  const out: Link[] = [];
  const have = new Set(PAGES.map(key));
  for (const p of PAGES) {
    for (const m of p.md.matchAll(/\[\[([^\]]+)\]\]/g)) {
      const to = `${p.ws}/${m[1]}`;
      if (have.has(to)) out.push({ from: key(p), to });
    }
  }
  for (const [from, to] of EXTRA_LINKS) if (have.has(from) && have.has(to)) out.push({ from, to });
  return out;
})();

// ---- what a role may read ----

const WORKSPACES = ["me", "core", "a_acme", "c_bid", "c_delivery", "c_sales"];
const readsBrain = (role: string, ws: string) => seen(role, ws, "topic") !== "hidden";
const canRead = (role: string, p: MockPage) => seen(role, p.ws, p.type) === "full";
const visiblePages = (role: string): MockPage[] => PAGES.filter((p) => canRead(role, p));
const byKey = (role: string) => new Map(visiblePages(role).map((p) => [key(p), p]));

// ---- the person's own choices, kept in this browser for the mock ----

const store = (k: string, v?: string): string | null => {
  try {
    if (v !== undefined) window.localStorage.setItem(k, v);
    return window.localStorage.getItem(k);
  } catch {
    return v ?? null;
  }
};
const listedKey = (persona: string) => `secondary.mock.expert.${persona}`;
const savedKey = (persona: string) => `secondary.mock.saved.${persona}`;
const isListed = (persona: string) => store(listedKey(persona)) !== "0";

interface Saved {
  id: string;
  name: string;
  q: string;
  at: string;
}
const readSaved = (persona: string): Saved[] => {
  try {
    const v: unknown = JSON.parse(store(savedKey(persona)) ?? "[]");
    return Array.isArray(v) ? (v as Saved[]) : [];
  } catch {
    return [];
  }
};

/** People who opted out are named nowhere: the mock's only opt-out is the viewer's own. */
const named = (viewer: string, persona: string): boolean => persona !== viewer || isListed(viewer);

// ---- the pieces ----

function peopleFor(
  role: string,
  viewer: string,
  pages: MockPage[],
  weight: (p: MockPage) => number,
  limit: number,
) {
  const by = new Map<
    string,
    { who: string; ws: string; n: number; pages: Set<string>; last: number; score: number }
  >();
  for (const p of pages) {
    if (p.ws === "me") continue;
    for (const [who, n, ago] of CONTRIB[key(p)] ?? []) {
      if (!named(viewer, who)) continue;
      const k = `${p.ws}:${who}`;
      const e = by.get(k) ?? { who, ws: p.ws, n: 0, pages: new Set(), last: 9999, score: 0 };
      e.n += n;
      e.pages.add(p.id);
      e.last = Math.min(e.last, ago);
      e.score += weight(p) * n * 0.5 ** (ago / 180);
      by.set(k, e);
    }
  }
  void role;
  return [...by.values()]
    .sort((a, z) => z.score - a.score || a.last - z.last)
    .slice(0, limit)
    .map((e) => {
      const person = PEOPLE[e.who] as Person;
      return {
        id: person.id,
        name: person.name,
        role: person.role,
        brainId: e.ws,
        brainName: brainName(e.ws),
        contributions: e.n,
        pages: e.pages.size,
        lastAt: iso(e.last),
        score: Math.round(e.score * 100) / 100,
      };
    });
}

function neighbours(role: string, k: string) {
  const vis = byKey(role);
  const hop1 = new Map<string, "out" | "in">();
  for (const l of LINKS) {
    if (l.from === k && vis.has(l.to)) hop1.set(l.to, "out");
    if (l.to === k && vis.has(l.from) && !hop1.has(l.from)) hop1.set(l.from, "in");
  }
  return { vis, hop1 };
}

function lens(role: string, viewer: string, ws: string, id: string) {
  const vis = byKey(role);
  const page = vis.get(`${ws}/${id}`);
  if (!page || !readsBrain(role, ws)) throw new ApiError(404, "Not found.");
  const k = key(page);
  const { hop1 } = neighbours(role, k);
  const nodeOf = (p: MockPage, hop: 0 | 1 | 2) => ({
    key: key(p),
    brainId: p.ws,
    brainName: brainName(p.ws),
    id: p.id,
    title: p.title,
    type: p.type,
    collection: TYPE_LABEL[p.type] ?? p.type,
    hop,
  });
  const nodes = new Map<string, ReturnType<typeof nodeOf>>([[k, nodeOf(page, 0)]]);
  const edges: { from: string; to: string }[] = [];
  const edge = (from: string, to: string) => edges.push({ from, to });
  for (const [n, dir] of [...hop1].slice(0, 12)) {
    const p = vis.get(n) as MockPage;
    nodes.set(n, nodeOf(p, 1));
    if (dir === "out") edge(k, n);
    else edge(n, k);
  }
  for (const n of [...nodes.keys()]) {
    if (n === k) continue;
    for (const l of LINKS) {
      const other = l.from === n ? l.to : l.to === n ? l.from : null;
      if (!other || other === k || !vis.has(other)) continue;
      if (nodes.size >= 24 && !nodes.has(other)) continue;
      if (!nodes.has(other)) nodes.set(other, nodeOf(vis.get(other) as MockPage, 2));
      if (l.from === n) edge(n, other);
      else edge(other, n);
    }
  }
  const backlinks = LINKS.filter((l) => l.to === k && vis.has(l.from)).map((l) => {
    const p = vis.get(l.from) as MockPage;
    return {
      brainId: p.ws,
      brainName: brainName(p.ws),
      id: p.id,
      title: p.title,
      type: p.type,
      collection: TYPE_LABEL[p.type] ?? p.type,
    };
  });
  const contrib = (CONTRIB[k] ?? []).filter(([who]) => named(viewer, who));
  const unnamed = (CONTRIB[k] ?? []).length - contrib.length;
  const age = k.length % 7 === 0 ? 220 : (CONTRIB[k]?.[0]?.[2] ?? 30);
  const freshnessDays = 180;
  const state = age <= freshnessDays / 2 ? "fresh" : age <= freshnessDays ? "aging" : "stale";
  const verifiedBy = CONTRIB[k]?.[0]?.[0];
  const weights = new Map<string, number>([[k, 3]]);
  for (const n of hop1.keys()) weights.set(n, 1);
  return {
    page: {
      id: page.id,
      title: page.title,
      type: page.type,
      collection: TYPE_LABEL[page.type] ?? page.type,
      brainId: page.ws,
      brainName: brainName(page.ws),
      status: "published",
      revision: 2,
      updatedAt: iso(age),
      lastChange: {
        at: iso(CONTRIB[k]?.[0]?.[2] ?? age),
        revision: 2,
        by:
          verifiedBy && named(viewer, verifiedBy)
            ? { id: (PEOPLE[verifiedBy] as Person).id, name: (PEOPLE[verifiedBy] as Person).name }
            : null,
      },
    },
    freshness: {
      state,
      days: age,
      score: Math.max(0, Math.round(100 * (1 - age / (freshnessDays * 1.5)))),
      freshnessDays,
    },
    verified:
      verifiedBy && page.ws !== "me"
        ? {
            by: named(viewer, verifiedBy)
              ? { id: (PEOPLE[verifiedBy] as Person).id, name: (PEOPLE[verifiedBy] as Person).name }
              : null,
            at: iso(Math.min(age + 4, 120)),
          }
        : null,
    graph: { nodes: [...nodes.values()], edges },
    facts: factsOf(page),
    contributors: contrib.map(([who, n, ago]) => ({
      id: (PEOPLE[who] as Person).id,
      name: (PEOPLE[who] as Person).name,
      role: (PEOPLE[who] as Person).role,
      changes: n,
      lastAt: iso(ago),
    })),
    unnamed,
    backlinks,
    who: peopleFor(
      role,
      viewer,
      [...weights.keys()].map((n) => vis.get(n) as MockPage),
      (p) => weights.get(key(p)) ?? 1,
      5,
    ),
  };
}

/** Dated facts for a few pages, one with a conflict and one that was replaced. */
function factsOf(page: MockPage) {
  const f = (
    id: number,
    subject: string,
    predicate: string,
    object: string,
    from: number,
    to: number | null,
    extra: { unverified?: boolean; contradiction?: boolean; replacedBy?: number | null } = {},
  ) => ({
    id,
    subject,
    predicate,
    object,
    validAt: iso(from),
    invalidAt: to === null ? null : iso(to),
    unverified: extra.unverified ?? false,
    contradiction: extra.contradiction ?? false,
    replacedBy: extra.replacedBy ?? null,
  });
  switch (key(page)) {
    case "c_bid/pricing-guide":
    case "core/success-stories":
      return [
        f(11, "method: Price bands", "bands", "Three bands, by scope", 40, null),
        f(12, "method: Price bands", "bands", "Four bands, by team size", 25, null, {
          contradiction: true,
          unverified: true,
        }),
        f(10, "method: Price bands", "bands", "Two bands, fixed fee", 400, 40, { replacedBy: 11 }),
        f(13, "offer: Retainer", "minimum", "6 months", 120, null),
      ];
    case "c_bid/bid-playbook":
    case "core/bid-playbook":
      return [
        f(21, "method: Qualification", "window", "Two days", 200, null),
        f(22, "method: Red team", "when", "Before sending", 90, null),
        f(20, "method: Qualification", "window", "Five days", 500, 200, { replacedBy: 21 }),
      ];
    case "a_acme/acme-overview":
      return [
        f(31, "commitment: Acme renewal", "due", "2027-03-31", 60, 3, { replacedBy: 32 }),
        f(32, "commitment: Acme renewal", "due", "2027-06-30", 3, null, { unverified: true }),
      ];
    default:
      return [];
  }
}

// ---- search ----

const ROLES = ["owner", "steward", "editor", "contributor", "reader", "system"];
const OPS = /^(brain|type|fresh|status|role):(.*)$/i;
const VALUE = /^[\p{L}\p{N}_.:-]{1,64}$/u;

interface Parsed {
  text: string;
  brain: string[];
  type: string[];
  status: string[];
  role: string[];
  fresh: { op: "lt" | "gt"; days: number } | null;
  ignored: string[];
}

function parse(raw: string): Parsed {
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
  const words: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of raw.normalize("NFKC").slice(0, 300)) {
    if (ch === '"') quoted = !quoted;
    else if (/\s/u.test(ch) && !quoted) {
      if (cur) words.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) words.push(cur);
  for (const w of words) {
    const m = OPS.exec(w);
    if (!m || ops >= 8) {
      free.push(w);
      continue;
    }
    const k = (m[1] as string).toLowerCase();
    const v = (m[2] as string).trim().toLowerCase();
    const bad = () => {
      out.ignored.push(w);
      free.push(w);
    };
    if (k === "fresh") {
      const f = /^([<>]?)(\d{1,4})([dwmy])$/.exec(v);
      if (!f) {
        bad();
        continue;
      }
      const days = Number(f[2]) * ({ d: 1, w: 7, m: 30, y: 365 }[f[3] as "d"] as number);
      if (days < 1 || days > 3650) {
        bad();
        continue;
      }
      out.fresh = { op: f[1] === ">" ? "gt" : "lt", days };
      ops++;
      continue;
    }
    if (!VALUE.test(v)) {
      bad();
      continue;
    }
    if (k === "brain") out.brain.push(v);
    else if (k === "type") out.type.push(v);
    else if (k === "status") {
      if (v === "verified" || v === "unverified") out.status.push(v);
      else {
        bad();
        continue;
      }
    } else if (ROLES.includes(v)) out.role.push(v);
    else {
      bad();
      continue;
    }
    ops++;
  }
  out.text = free.join(" ");
  return out;
}

const tokens = (s: string): string[] =>
  (
    s
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  ).slice(0, 8);
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const bucket = (d: number) => (d < 30 ? "lt30" : d < 90 ? "lt90" : d < 180 ? "lt180" : "older");
const ageOf = (p: MockPage) => CONTRIB[key(p)]?.[0]?.[2] ?? 30;

function search(role: string, sp: URLSearchParams) {
  const raw = sp.get("q") ?? "";
  if (raw.length > 300) throw new ApiError(400, "invalid query");
  const parsed = parse(raw);
  const toks = tokens(parsed.text);
  const list = (n: string) =>
    (sp.get(n) ?? "")
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);
  const f = {
    brain: [...parsed.brain, ...list("brain")],
    type: [...parsed.type, ...list("type")],
    status: [...parsed.status, ...list("status")],
    role: [...parsed.role, ...list("role")],
    age: list("age"),
    fresh: parsed.fresh,
  };
  const any =
    f.brain.length || f.type.length || f.status.length || f.role.length || f.age.length || f.fresh;
  const facetsOff = sp.get("facets") === "0";
  const limit = Math.min(50, Number(sp.get("limit") ?? 50) || 50);
  const empty = {
    q: raw,
    parsed,
    total: 0,
    results: [],
    facets: { brain: [], type: [], fresh: [], status: [], role: [] },
  };
  if (!toks.length && !any) return empty;
  const hits = visiblePages(role)
    .filter((p) => p.type !== "session_report" || toks.length)
    .flatMap((p) => {
      const text =
        `${p.title} ${p.summary} ${p.md.replace(/\{src:[^}]+\}|\[\[[^\]]+\]\]/g, "")}`.toLowerCase();
      if (toks.length && !toks.some((t) => text.includes(t))) return [];
      const score =
        toks.filter((t) => text.includes(t)).length * 2 +
        toks.filter((t) => p.title.toLowerCase().includes(t)).length * 3;
      const who = CONTRIB[key(p)]?.[0]?.[0];
      const days = ageOf(p);
      const lines = p.md
        .split("\n")
        .filter((l) => l.startsWith("- "))
        .map((l) =>
          l
            .replace(/\{src:[^}]+\}/g, "")
            .replace(/\[\[[^\]]+\]\]/g, "")
            .slice(2)
            .trim(),
        )
        .filter(Boolean)
        .map((t) => ({ t, s: toks.filter((x) => t.toLowerCase().includes(x)).length }))
        .sort((a, z) => z.s - a.s)
        .slice(0, 3)
        .map((l) => ({
          text: l.t,
          citations: [...p.md.matchAll(/\{src:([^}]+)\}/g)]
            .slice(0, 1)
            .map((m) => ({ id: m[1] as string, title: m[1] as string })),
        }));
      return [
        {
          h: {
            brainId: p.ws,
            brainName: brainName(p.ws),
            id: p.id,
            title: p.title,
            type: p.type,
            collection: TYPE_LABEL[p.type] ?? p.type,
            summary: p.summary,
            updatedAt: iso(days),
            ageDays: days,
            fresh: bucket(days) as "lt30",
            status: (key(p).length % 3 === 0 ? "unverified" : "verified") as
              | "verified"
              | "unverified",
            role: who ? (PEOPLE[who] as Person).role : "system",
            lines,
            restricted: 0,
          },
          score,
        },
      ];
    });
  const brainOk = (h: (typeof hits)[number]["h"]) =>
    !f.brain.length ||
    f.brain.some(
      (v) =>
        h.brainId.toLowerCase() === v ||
        slug(h.brainName) === slug(v) ||
        (v === "personal" && h.brainId === "me"),
    );
  const typeOk = (h: (typeof hits)[number]["h"]) =>
    !f.type.length || f.type.some((v) => h.type === v || slug(h.collection) === slug(v));
  const statusOk = (h: (typeof hits)[number]["h"]) =>
    !f.status.length || f.status.includes(h.status);
  const roleOk = (h: (typeof hits)[number]["h"]) => !f.role.length || f.role.includes(h.role);
  const ageOk = (h: (typeof hits)[number]["h"]) => {
    if (f.age.length && !f.age.includes(h.fresh)) return false;
    if (!f.fresh) return true;
    return f.fresh.op === "lt" ? h.ageDays < f.fresh.days : h.ageDays > f.fresh.days;
  };
  const pass = (h: (typeof hits)[number]["h"], skip?: string) =>
    (skip === "brain" || brainOk(h)) &&
    (skip === "type" || typeOk(h)) &&
    (skip === "status" || statusOk(h)) &&
    (skip === "role" || roleOk(h)) &&
    (skip === "fresh" || ageOk(h));
  const shown = hits
    .filter((x) => pass(x.h))
    .sort((a, z) => z.score - a.score || a.h.title.localeCompare(z.h.title));
  const count = (
    skip: string,
    id: (h: (typeof hits)[number]["h"]) => string,
    lab: (h: (typeof hits)[number]["h"]) => string,
    on: (id: string) => boolean,
  ) => {
    const m = new Map<string, { id: string; label: string; n: number; on: boolean }>();
    for (const { h } of hits.filter((x) => pass(x.h, skip))) {
      const e = m.get(id(h)) ?? { id: id(h), label: lab(h), n: 0, on: on(id(h)) };
      e.n++;
      m.set(id(h), e);
    }
    return [...m.values()].sort((a, z) => z.n - a.n || a.label.localeCompare(z.label));
  };
  const fixed = (
    skip: string,
    ids: string[],
    get: (h: (typeof hits)[number]["h"]) => string,
    picked: string[],
  ) =>
    ids.map((i) => ({
      id: i,
      label: i,
      n: hits.filter((x) => pass(x.h, skip) && get(x.h) === i).length,
      on: picked.includes(i),
    }));
  return {
    q: raw,
    parsed: {
      ...parsed,
      brain: f.brain,
      type: f.type,
      status: f.status,
      role: f.role,
      fresh: f.fresh,
    },
    total: shown.length,
    results: shown.slice(0, limit).map((x) => x.h),
    facets: facetsOff
      ? { brain: [], type: [], fresh: [], status: [], role: [] }
      : {
          brain: count(
            "brain",
            (h) => h.brainId,
            (h) => h.brainName,
            (i) => f.brain.includes(i.toLowerCase()),
          ),
          type: count(
            "type",
            (h) => h.type,
            (h) => h.collection,
            (i) => f.type.includes(i),
          ),
          fresh: fixed("fresh", ["lt30", "lt90", "lt180", "older"], (h) => h.fresh, f.age),
          status: fixed("status", ["verified", "unverified"], (h) => h.status, f.status),
          role: fixed("role", ROLES, (h) => h.role, f.role).filter((r) => r.n > 0 || r.on),
        },
  };
}

// ---- pulse ----

const CATS = ["published", "resolved", "sources", "gaps", "rules"] as const;
const seeded = (s: string) => {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
};
const BUSY: Record<string, number> = {
  c_bid: 0.5,
  core: 0.32,
  a_acme: 0.42,
  c_delivery: 0.26,
  c_sales: 0.2,
  me: 0.3,
};

function pulseDays(role: string, ws: string, days: number) {
  const rnd = seeded(ws);
  const pages = visiblePages(role).filter((p) => p.ws === ws && p.type !== "session_report");
  const out: {
    date: string;
    counts: Record<(typeof CATS)[number], number>;
    total: number;
    pages: { id: string; title: string }[];
  }[] = [];
  for (let d = 0; d < 90; d++) {
    const r = rnd();
    const counts = Object.fromEntries(CATS.map((c) => [c, 0])) as Record<
      (typeof CATS)[number],
      number
    >;
    const roll = [rnd(), rnd(), rnd(), rnd(), rnd()];
    if (d > days - 1) continue;
    if (r > (BUSY[ws] ?? 0.2)) continue;
    counts.published = 1 + Math.floor((roll[0] as number) * 5);
    if ((roll[1] as number) > 0.65) counts.resolved = 1 + Math.floor((roll[1] as number) * 2);
    if ((roll[2] as number) > 0.5) counts.sources = 1 + Math.floor((roll[2] as number) * 3);
    if ((roll[3] as number) > 0.85) counts.gaps = 1;
    if ((roll[4] as number) > 0.8) counts.rules = 1 + Math.floor((roll[4] as number) * 2);
    const touched = pages
      .filter((_, i) => (i + d) % 3 === 0)
      .slice(0, 4)
      .map((p) => ({ id: p.id, title: p.title }));
    out.push({
      date: day(d),
      counts,
      total: CATS.reduce((n, c) => n + counts[c], 0),
      pages: touched,
    });
  }
  return out;
}

// ---- the handler ----

export function handleV8Lens(
  method: string,
  p: string,
  sp: URLSearchParams,
  body: Record<string, unknown>,
  role: string,
  persona: string | null,
): unknown {
  const viewer = role;
  const personaId = persona ?? role;

  if (p === "/v1/me/expert-listing") {
    if (method === "GET") return { listed: isListed(personaId) };
    if (method === "PUT") {
      if (typeof body.listed !== "boolean") throw new ApiError(400, "invalid listed");
      store(listedKey(personaId), body.listed ? "1" : "0");
      return { listed: body.listed };
    }
  }

  const lens$ = p.match(/^\/v1\/brains\/([^/]+)\/pages\/([^/]+)\/lens$/);
  if (lens$ && method === "GET")
    return lens(
      role,
      viewer,
      decodeURIComponent(lens$[1] as string),
      decodeURIComponent(lens$[2] as string),
    );

  const who$ = p.match(/^\/v1\/brains\/([^/]+)\/who-knows$/);
  if (who$ && method === "GET") {
    const ws = decodeURIComponent(who$[1] as string);
    if (!readsBrain(role, ws)) throw new ApiError(404, "Not found.");
    const limit = Number(sp.get("limit") ?? 5) || 5;
    const pages = visiblePages(role).filter((x) => x.ws === ws);
    const pageId = sp.get("page");
    const coll = sp.get("collection");
    if (pageId) {
      const page = pages.find((x) => x.id === pageId);
      if (!page) throw new ApiError(404, "Not found.");
      const near = neighbours(role, key(page)).hop1;
      const weights = new Map<string, number>([
        [key(page), 3],
        ...[...near.keys()]
          .filter((k) => k.startsWith(`${ws}/`))
          .map((k) => [k, 1] as [string, number]),
      ]);
      return {
        scope: { kind: "page", label: page.title },
        people: peopleFor(
          role,
          viewer,
          pages.filter((x) => weights.has(key(x))),
          (x) => weights.get(key(x)) ?? 1,
          limit,
        ),
      };
    }
    const scoped = coll ? pages.filter((x) => x.type === coll) : pages;
    return {
      scope: {
        kind: coll ? "collection" : "brain",
        label: coll ? (TYPE_LABEL[coll] ?? coll) : brainName(ws),
      },
      people: peopleFor(role, viewer, scoped, () => 1, limit),
    };
  }

  if (p === "/v1/who-knows" && method === "GET") {
    const toks = tokens(sp.get("q") ?? "");
    if (!toks.length) throw new ApiError(400, "invalid query");
    const only = (sp.get("brain") ?? "").toLowerCase();
    const pages = visiblePages(role).filter((x) => {
      if (x.ws === "me") return false;
      if (only && x.ws.toLowerCase() !== only && !brainName(x.ws).toLowerCase().includes(only))
        return false;
      const text = `${x.title} ${x.summary} ${x.md}`.toLowerCase();
      return toks.some((t) => text.includes(t));
    });
    return {
      scope: { kind: "query", label: sp.get("q") ?? "" },
      people: peopleFor(role, viewer, pages, () => 1, Number(sp.get("limit") ?? 5) || 5),
    };
  }

  if (p === "/v1/search/pages" && method === "GET") return search(role, sp);

  if (p === "/v1/search/saved") {
    if (method === "GET") return { saved: readSaved(personaId) };
    if (method === "POST") {
      const q = String(body.q ?? "").trim();
      const name = String(body.name ?? "").trim();
      if (!q || !name || q.length > 300 || name.length > 60)
        throw new ApiError(400, "invalid saved search");
      const cur = readSaved(personaId).filter((s) => s.q !== q);
      const next = [
        {
          id: `s_${Math.abs([...q].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7))
            .toString(16)
            .padStart(12, "0")
            .slice(0, 12)}`,
          name,
          q,
          at: new Date(NOW).toISOString(),
        },
        ...cur,
      ].slice(0, 25);
      store(savedKey(personaId), JSON.stringify(next));
      return { saved: next, max: 25 };
    }
  }
  const del = p.match(/^\/v1\/search\/saved\/(s_[0-9a-f]{12})$/);
  if (del && method === "DELETE") {
    const cur = readSaved(personaId);
    const next = cur.filter((s) => s.id !== del[1]);
    if (next.length === cur.length) throw new ApiError(404, "Not found.");
    store(savedKey(personaId), JSON.stringify(next));
    return { ok: true };
  }

  const pulse$ = p.match(/^\/v1\/brains\/([^/]+)\/pulse$/);
  if (pulse$ && method === "GET") {
    const ws = decodeURIComponent(pulse$[1] as string);
    if (!readsBrain(role, ws)) throw new ApiError(404, "Not found.");
    const days = Number(sp.get("days") ?? 60);
    if (!Number.isInteger(days) || days < 7 || days > 90) throw new ApiError(400, "invalid days");
    return {
      brainId: ws,
      name: brainName(ws),
      from: day(days - 1),
      to: day(0),
      categories: [...CATS],
      days: pulseDays(role, ws, days),
    };
  }
  if (p === "/v1/pulse" && method === "GET") {
    const days = Number(sp.get("days") ?? 30);
    if (!Number.isInteger(days) || days < 7 || days > 90) throw new ApiError(400, "invalid days");
    return {
      categories: [...CATS],
      from: day(days - 1),
      to: day(0),
      brains: WORKSPACES.filter((ws) => readsBrain(role, ws)).map((ws) => ({
        brainId: ws,
        name: brainName(ws),
        type:
          ws === "me"
            ? "personal"
            : ws === "core"
              ? "global"
              : ws.startsWith("a_")
                ? "account"
                : "team",
        days: pulseDays(role, ws, days).map((d) => ({
          date: d.date,
          d: CATS.map((c) => d.counts[c]),
        })),
      })),
    };
  }
  return NOT_HANDLED;
}
