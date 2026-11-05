// References for a landing page: which pages of the brain may back a claim, ranked, and how each may
// be shown. Everything starts from the composer's own admitted view: a workspace the person cannot
// read at content level is never opened, a page whose sources they cannot read is not a candidate, and
// an NDA account never is. A client is NAMED only when a CustomerPermission record covers that exact
// external text for the channel "landing page"; every other reference is generalised with the same
// de-identifier Promote to Global uses, and dropped when anything that names a client survives it.

import type { AdmittedView, ViewNode } from "@secondary/policy";
import { viewOf } from "../auth.ts";
import { scopeOfNode } from "../scope.ts";
import { workspaceStub } from "../stubs.ts";
import type { C } from "../ux/util.ts";
import { sess } from "../ux/util.ts";
import {
  canGlobal,
  filterMarkdown,
  pageVisible,
  type Readable,
  readableMany,
} from "../wiki/routes.ts";
import {
  citationsOf,
  claimLines,
  generalise,
  matchOfTokens,
  residualIdentifiers,
  slug,
  tokensOf,
} from "../wiki/text.ts";
import { languageOf } from "./lang.ts";
import { cleanSlot, type Lang, MAX_REFERENCES, type Reference } from "./types.ts";

/** Wiki page types a landing page may point at. Contacts, decisions, risks and the generated pages never. */
const REF_TYPES = new Set(["success_story", "project", "case_study", "topic", "method"]);
const TYPE_WEIGHT: Record<string, number> = {
  success_story: 20,
  case_study: 20,
  project: 10,
  method: 4,
  topic: 2,
};
const MAX_RESOLVED = 24;
const MAX_TARGETS = 60;
const SUMMARY_MAX = 280;
const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "our",
  "your",
  "les",
  "des",
  "une",
  "pour",
  "dans",
  "sur",
  "avec",
  "par",
  "est",
  "aux",
  "que",
  "qui",
  "how",
  "comment",
]);

const EUROPE = new Set([
  "france",
  "germany",
  "allemagne",
  "spain",
  "espagne",
  "italy",
  "italie",
  "belgium",
  "belgique",
  "netherlands",
  "pays-bas",
  "portugal",
  "ireland",
  "irlande",
  "luxembourg",
  "austria",
  "autriche",
  "poland",
  "pologne",
  "sweden",
  "suede",
  "suède",
  "denmark",
  "danemark",
  "finland",
  "finlande",
  "switzerland",
  "suisse",
  "norway",
  "norvege",
  "norvège",
  "united kingdom",
  "royaume-uni",
  "uk",
]);

export interface Target {
  param: string;
  nodeId: string;
  scope: string;
  label: string;
}

/** An account the composer's view knows by name, whether or not they may read it. */
export interface Named {
  id: string;
  label: string;
  /** What identifies it in free text. */
  ids: string[];
}

const norm = (s: string): string =>
  s
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/\b(?:synthetic|sample|sas|sa|sarl|gmbh|ltd|inc|llc|group|groupe|the|le|la)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Two names that mean the same company: equal once legal suffixes go, or one holds the other. */
export function sameCompany(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (x.length < 3 || y.length < 3) return false;
  return x === y || x.includes(y) || y.includes(x);
}

/** Sectors the page can name in its own language. A sector not listed is left out, never printed in another language. */
const SECTORS: Record<string, { en: string; fr: string }> = {
  banking: { en: "banking", fr: "du secteur bancaire" },
  retail: { en: "retail", fr: "du commerce de détail" },
  telecom: { en: "telecom", fr: "des télécommunications" },
  mining: { en: "mining", fr: "des mines" },
  energy: { en: "energy", fr: "de l'énergie" },
  "public sector": { en: "public-sector", fr: "du secteur public" },
  manufacturing: { en: "manufacturing", fr: "de l'industrie" },
  logistics: { en: "logistics", fr: "de la logistique" },
  insurance: { en: "insurance", fr: "de l'assurance" },
};
const SECTOR_ALIAS: Record<string, string> = {
  banque: "banking",
  bank: "banking",
  commerce: "retail",
  telecoms: "telecom",
  télécoms: "telecom",
  énergie: "energy",
  energie: "energy",
  "secteur public": "public sector",
  industrie: "manufacturing",
  assurance: "insurance",
};

/** The phrase that stands for a client once its name is gone: "A European retail client". One language only. */
export function clientPhrase(facts: Readonly<Record<string, string>>, lang: Lang): string {
  const raw = (facts.Sector ?? "").trim().toLowerCase();
  const sector = SECTORS[SECTOR_ALIAS[raw] ?? raw];
  const eu = EUROPE.has((facts.Country ?? "").trim().toLowerCase());
  if (lang === "fr") return `Un client${eu ? " européen" : ""}${sector ? ` ${sector.fr}` : ""}`;
  return `A ${eu ? "European " : ""}${sector ? `${sector.en} ` : ""}client`;
}

/** `generalise` with its placeholder in the page's language ("the client" is English). */
export function anonymise(text: string, ids: string[], lang: Lang): string {
  // The contact placeholders ("[email removed]") are English and have no place on a page: they go.
  const out = generalise(text, ids)
    .replace(/\s*\[(?:email|phone) removed\]/g, "")
    .replace(/\s+([.,;:])/g, "$1");
  return lang === "fr" ? out.replace(/\bthe client\b/gi, "le client") : out;
}

const METRIC = /\d|%|[€$£]|["“”«»]/;
/** Sentences with a figure, a currency, a percentage or a quotation are dropped: they are metrics and quotes. */
export function withoutMetrics(text: string): string {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s && !METRIC.test(s))
    .join(" ");
}

const FALLBACK: Record<Lang, string> = {
  en: "A delivery engagement completed for a client in this field.",
  fr: "Une mission menée à bien pour un client de ce secteur.",
};

interface Resolved {
  target: Target;
  pageId: string;
  type: string;
  title: string;
  text: string;
  node: ViewNode | null;
  cited: string[];
}

interface Story {
  id: string;
  label: string;
  external: string;
  permitted: boolean;
  /** The figure the permission covers, if it names one. */
  metric?: { value: string; label: string };
}

const channelOk = (channels: unknown): boolean =>
  Array.isArray(channels) &&
  channels.some((c) => typeof c === "string" && /^landing[\s_-]?pages?$/i.test(c.trim()));

export class Brain {
  readonly view: AdmittedView;
  readonly lang: Lang;
  private readonly targets: Target[];
  private readonly named: Named[];
  private stories = new Map<string, Promise<Story[]>>();

  private readonly c: C;

  constructor(c: C, lang: Lang) {
    this.c = c;
    this.view = viewOf(sess(c));
    this.lang = lang;
    // Company workspaces only, never the Personal Brain and never an NDA account. The cap of the wiki's
    // own search would cut a broad reader's list at random, so the order is chosen: Company Global, then
    // accounts, then circles and departments.
    const order: Record<string, number> = { core: 0, account: 1, circle: 2, department: 3 };
    this.targets = [...this.view.nodes.values()]
      .filter((vn) => vn.kind in order && vn.level === "content" && !vn.nda)
      .flatMap((vn): Target[] => {
        const scope = scopeOfNode(vn);
        return scope ? [{ param: vn.id, nodeId: vn.id, scope, label: vn.label }] : [];
      })
      .sort(
        (a, b) =>
          (order[this.view.nodes.get(a.nodeId)?.kind ?? ""] ?? 9) -
            (order[this.view.nodes.get(b.nodeId)?.kind ?? ""] ?? 9) ||
          a.param.localeCompare(b.param),
      )
      .slice(0, MAX_TARGETS);
    this.named = [...this.view.nodes.values()]
      .filter((n) => n.kind === "account")
      .map((n) => ({
        id: n.id,
        label: n.label,
        ids: [n.id, n.label, ...(n.account ? [n.account] : [])],
      }));
  }

  /** Every account name the composer knows: none of them may reach a page without permission. */
  get accounts(): readonly Named[] {
    return this.named;
  }

  /** The account a company name stands for, when the composer may read it and it is not under NDA. */
  knownAccount(company: string): ViewNode | null {
    for (const n of this.view.nodes.values())
      if (n.kind === "account" && !n.nda && n.level === "content" && sameCompany(n.label, company))
        return n;
    return null;
  }

  private storiesOf(t: Target): Promise<Story[]> {
    let p = this.stories.get(t.scope);
    if (!p) {
      p = workspaceStub(this.c.env, sess(this.c).tenantId, t.scope)
        .listByKind("record", 200)
        .then((rows) =>
          rows.flatMap((r): Story[] => {
            if (!r.tags.includes("out")) return [];
            try {
              const st = (JSON.parse(r.body ?? "{}") as { story?: Record<string, unknown> }).story;
              if (!st || typeof st.external !== "string") return [];
              const perm = st.permission as {
                text?: unknown;
                channels?: unknown;
                metric?: { value?: unknown; label?: unknown };
              } | null;
              // The permission stands for these exact words and for this channel, nothing wider (M-12).
              const permitted =
                !!perm &&
                perm.text === st.external &&
                st.external.trim().length > 0 &&
                channelOk(perm.channels);
              const m = perm?.metric;
              const metric =
                permitted && m && typeof m.value === "string" && typeof m.label === "string"
                  ? { value: m.value, label: m.label }
                  : undefined;
              return [
                {
                  id: r.id,
                  label: r.label,
                  external: st.external,
                  permitted,
                  ...(metric ? { metric } : {}),
                },
              ];
            } catch {
              return [];
            }
          }),
        );
      this.stories.set(t.scope, p);
    }
    return p;
  }

  /** The pages behind these ids, as this composer may read them. Anything unreadable is simply absent. */
  private async load(want: { target: Target; pid: string }[]): Promise<Resolved[]> {
    const stubs = new Map<string, ReturnType<typeof workspaceStub>>();
    const stubOf = (t: Target) => {
      let s = stubs.get(t.scope);
      if (!s) {
        s = workspaceStub(this.c.env, sess(this.c).tenantId, t.scope);
        stubs.set(t.scope, s);
      }
      return s;
    };
    const pages = await Promise.all(want.map((w) => stubOf(w.target).wikiPage(w.pid)));
    const live = want.flatMap((w, i) => {
      const p = pages[i];
      return p && p.status === "published" && REF_TYPES.has(p.type) ? [{ w, p }] : [];
    });
    const oks = await readableMany(
      this.c,
      live.map(({ w, p }) => ({
        w: { view: this.view, personal: false, stub: stubOf(w.target) },
        ids: citationsOf(p.markdown),
      })),
    );
    const g = canGlobal(this.view);
    return live.flatMap(({ w, p }, i): Resolved[] => {
      const ok = oks[i] as Readable;
      const cites = citationsOf(p.markdown);
      if (!pageVisible(cites, ok)) return [];
      const f = filterMarkdown(p.markdown, ok, g);
      return [
        {
          target: w.target,
          pageId: p.id,
          type: p.type,
          title: p.title,
          text: f.text,
          node: this.view.nodes.get(w.target.nodeId) ?? null,
          cited: cites,
        },
      ];
    });
  }

  /** How one resolved page may be shown. Null: it cannot be shown without naming a client. */
  private async referenceOf(r: Resolved): Promise<{ ref: Reference; named: boolean } | null> {
    const id = `${r.target.param}/${r.pageId}`;
    // Named: an account page with a story whose exact external text a customer permission covers.
    if (r.node?.kind === "account" && !r.node.nda) {
      const stories = await this.storiesOf(r.target);
      const t = slug(r.title);
      const story = stories.find(
        (s) =>
          s.permitted &&
          (r.cited.includes(s.id) || (slug(s.label).length >= 4 && t.startsWith(slug(s.label)))),
      );
      if (story)
        return {
          named: true,
          ref: {
            pageId: id,
            title: r.title,
            summary: cleanSlot(story.external).slice(0, SUMMARY_MAX),
            permission: "named",
            ...(story.metric ? { metric: story.metric } : {}),
          },
        };
    }
    // Generalised: no client name, logo, quote or metric survives, and nothing may name any account.
    const ids = this.named.flatMap((n) => n.ids);
    const own = r.node?.kind === "account" ? clientPhrase(r.node.facts, this.lang) : "";
    const topic = r.title.split(/\s+(?:at|chez|pour|for|with|avec)\s+/i)[0] ?? r.title;
    const gTopic = anonymise(topic, ids, this.lang).replace(/\s+/g, " ").trim();
    const generalisedTitle = (own ? `${own}: ${gTopic}` : gTopic).slice(0, 120);
    const lines = claimLines(r.text).map((l) => l.text);
    const body = anonymise(lines.join("\n"), ids, this.lang).replace(/\{src:[^}]+\}/g, "");
    const summary = withoutMetrics(body).slice(0, SUMMARY_MAX).trim() || FALLBACK[this.lang];
    if (
      generalisedTitle.length < 3 ||
      residualIdentifiers(`${generalisedTitle}\n${summary}`, ids).length
    )
      return null;
    return {
      named: false,
      ref: {
        pageId: id,
        title: generalisedTitle,
        summary,
        permission: "generalised-only",
        generalisedTitle,
      },
    };
  }

  /** The references behind these `<workspace>/<page>` ids, in the same order. Null: not available. */
  async resolve(ids: string[]): Promise<(Reference | null)[]> {
    const want = ids.map((id) => {
      const [ws, pid] = id.split("/");
      const target = this.targets.find((t) => t.param === ws);
      return target && pid && id.split("/").length === 2 ? { target, pid } : null;
    });
    const loaded = await this.load(want.flatMap((w) => (w ? [w] : [])));
    const by = new Map(loaded.map((r) => [`${r.target.param}/${r.pageId}`, r]));
    return Promise.all(
      ids.map(async (id) => {
        const r = by.get(id);
        return r ? ((await this.referenceOf(r))?.ref ?? null) : null;
      }),
    );
  }

  /** Candidates for a prospect, best first. Past work with a known account ranks above everything. */
  async find(i: {
    query: string;
    known?: ViewNode | null;
    limit?: number;
    exclude?: Set<string>;
  }): Promise<Reference[]> {
    const tokens = tokensOf(i.query).filter((t) => t.length >= 3 && !STOP.has(t));
    const hits = new Map<string, { target: Target; pid: string; rank: number }>();
    const stubs = await Promise.all(
      this.targets.map(async (t) => {
        const stub = workspaceStub(this.c.env, sess(this.c).tenantId, t.scope);
        const found = tokens.length ? await stub.wikiSearch(matchOfTokens(tokens), 10) : [];
        const own =
          i.known && t.nodeId === i.known.id
            ? (await stub.wikiPages()).filter(
                (p) => p.type === "project" || p.type === "success_story",
              )
            : [];
        return { t, found, own };
      }),
    );
    for (const { t, found, own } of stubs) {
      for (const [n, h] of found.entries())
        hits.set(`${t.param}/${h.id}`, { target: t, pid: h.id, rank: n });
      for (const p of own) hits.set(`${t.param}/${p.id}`, { target: t, pid: p.id, rank: -1 });
    }
    const wanted = [...hits.values()]
      .sort((a, b) => a.rank - b.rank || a.pid.localeCompare(b.pid))
      .slice(0, MAX_RESOLVED);
    const loaded = await this.load(wanted.map((w) => ({ target: w.target, pid: w.pid })));
    const scored = await Promise.all(
      loaded.map(async (r) => {
        const out = await this.referenceOf(r);
        if (!out) return null;
        const hay = `${r.title}\n${r.text}`.toLowerCase();
        const inTitle = tokens.filter((t) => r.title.toLowerCase().includes(t)).length;
        const inText = tokens.filter((t) => hay.includes(t)).length;
        const hit = hits.get(`${r.target.param}/${r.pageId}`);
        const score =
          (r.node && i.known && r.node.id === i.known.id ? 100 : 0) +
          (TYPE_WEIGHT[r.type] ?? 0) +
          inTitle * 5 +
          Math.min(inText, 8) +
          (out.named ? 15 : 0) +
          // A page in the language of the landing page reads better than one in the other.
          (languageOf(r.text) === this.lang ? 3 : 0) -
          (hit && hit.rank > 0 ? Math.min(hit.rank, 9) * 0.1 : 0);
        return { ref: out.ref, score };
      }),
    );
    return scored
      .flatMap((x) => (x && !i.exclude?.has(x.ref.pageId) ? [x] : []))
      .sort((a, b) => b.score - a.score || a.ref.pageId.localeCompare(b.ref.pageId))
      .slice(0, i.limit ?? MAX_REFERENCES)
      .map((x) => x.ref);
  }
}
