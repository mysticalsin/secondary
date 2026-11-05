// Dev mock for /v1/lp/* (docs/DESIGN-LP-STUDIO.md section 2). Synthetic data only. Loaded only when
// VITE_MOCK=1. State lives in sessionStorage so a persona switch or a reload keeps the pages.
import { ApiError } from "../api";
import type {
  ComposeInput,
  LandingDraft,
  LandingSummary,
  LpCandidate,
  LpChecks,
  LpIssue,
  LpReference,
  LpReviewDetail,
  LpSlots,
  LpStats,
  SlotId,
} from "../lp/types";
import { EXPIRY_DAYS, MAX_REFERENCES, SLOT_IDS } from "../lp/types";
import type { Question } from "../uxv2/types";
import { hash } from "./org";

export const NO = Symbol("lp: not handled");
const DAY = 86_400_000;
const REVIEWERS = ["reviewer", "ceo", "platform_admin"];
export const LIMITS: Record<SlotId, number> = {
  hero: 110,
  intro: 320,
  whyUs: 400,
  caseStudyIntro: 200,
  cta: 140,
};

// ---------- brain candidates ----------

const visual = (n: number, hue: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="${hue}"/><g fill="none" stroke="#f3e8ff" stroke-width="3" stroke-linecap="round" opacity=".9">${
      [
        '<circle cx="160" cy="90" r="46"/><circle cx="160" cy="90" r="20"/>',
        '<rect x="96" y="46" width="128" height="88" rx="14"/><path d="M96 90h128M160 46v88"/>',
        '<path d="M80 130l50-60 40 36 70-62"/><circle cx="240" cy="44" r="8"/>',
        '<path d="M100 60h120M100 90h90M100 120h120"/><circle cx="238" cy="90" r="14"/>',
      ][n % 4]
    }</g></svg>`,
  )}`;

export const VISUALS = [
  visual(0, "#5e2399"),
  visual(1, "#6600ae"),
  visual(2, "#8e3fe0"),
  visual(3, "#1a0033"),
];

const CANDIDATES: LpCandidate[] = [
  {
    pageId: "acme-retail-platform",
    metric: { value: "40 stores", label: "on one platform" },
    title: "Acme retail platform migration",
    summary: "Moved 40 stores to one platform in 9 months, with no trading day lost.",
    image: VISUALS[0],
    permission: "named",
  },
  {
    pageId: "acme-ai-governance",
    metric: { value: "1 quarter", label: "to a working AI office" },
    title: "Acme AI governance office",
    summary: "Stood up an AI governance office and a use-case register in one quarter.",
    image: VISUALS[1],
    permission: "named",
  },
  {
    pageId: "northwind-kyc",
    title: "Northwind Bank KYC automation",
    summary: "Cut onboarding checks from five days to one with a reviewed AI assistant.",
    image: VISUALS[2],
    permission: "generalised-only",
    generalisedTitle: "A European bank: KYC automation",
  },
  {
    pageId: "contoso-control-tower",
    title: "Contoso supply chain control tower",
    summary: "One view of orders, stock and delays across 12 plants.",
    image: VISUALS[3],
    permission: "generalised-only",
    generalisedTitle: "A global manufacturer: control tower",
  },
  {
    pageId: "fabrikam-bid-factory",
    metric: { value: "+33%", label: "win rate" },
    title: "Fabrikam bid factory",
    summary: "A repeatable bid process that lifted the win rate by a third.",
    image: VISUALS[1],
    permission: "named",
  },
  {
    pageId: "tailspin-data-platform",
    metric: { value: "0 tickets", label: "to reach the data" },
    title: "Tailspin data platform",
    summary: "A governed data platform that business teams use without a ticket.",
    image: VISUALS[0],
    permission: "named",
  },
  {
    pageId: "wingtip-cyber",
    title: "Wingtip cyber maturity programme",
    summary: "Lifted a public body from ad hoc to managed security in 18 months.",
    image: VISUALS[3],
    permission: "generalised-only",
    generalisedTitle: "A public-sector body: cyber maturity",
  },
  {
    pageId: "litware-agent-desk",
    metric: { value: "6 in 10", label: "questions answered" },
    title: "Litware agent desk",
    summary: "An agent desk that answers 6 in 10 internal questions without a person.",
    image: VISUALS[2],
    permission: "named",
  },
];

/** The same references in French, so a French page has no English sentence on it. */
const FR: Record<string, Pick<LpCandidate, "title" | "summary" | "generalisedTitle" | "metric">> = {
  "acme-retail-platform": {
    title: "Migration de la plateforme retail d'Acme",
    summary: "40 magasins passés sur une seule plateforme en 9 mois, sans journée de vente perdue.",
    metric: { value: "40 magasins", label: "sur une seule plateforme" },
  },
  "acme-ai-governance": {
    title: "Bureau de gouvernance IA d'Acme",
    summary: "Un bureau de gouvernance IA et un registre des cas d'usage en un trimestre.",
    metric: { value: "1 trimestre", label: "pour un bureau IA opérationnel" },
  },
  "northwind-kyc": {
    title: "Automatisation KYC de Northwind Bank",
    summary:
      "Des contrôles d'entrée en relation passés de cinq jours à un grâce à un assistant IA relu.",
    generalisedTitle: "Une banque européenne : automatisation du KYC",
  },
  "contoso-control-tower": {
    title: "Tour de contrôle supply chain de Contoso",
    summary: "Une vue unique des commandes, des stocks et des retards sur 12 usines.",
    generalisedTitle: "Un industriel mondial : tour de contrôle",
  },
  "fabrikam-bid-factory": {
    title: "Fabrique de réponses de Fabrikam",
    summary: "Un processus de réponse répétable qui a fait gagner un tiers de taux de succès.",
    metric: { value: "+33 %", label: "de taux de succès" },
  },
  "tailspin-data-platform": {
    title: "Plateforme de données de Tailspin",
    summary: "Une plateforme de données gouvernée que les métiers utilisent sans ticket.",
    metric: { value: "0 ticket", label: "pour accéder aux données" },
  },
  "wingtip-cyber": {
    title: "Programme de maturité cyber de Wingtip",
    summary: "Un organisme public passé d'une sécurité ad hoc à une sécurité maîtrisée en 18 mois.",
    generalisedTitle: "Un organisme public : maturité cyber",
  },
  "litware-agent-desk": {
    title: "Guichet d'agents de Litware",
    summary:
      "Un guichet d'agents qui répond à 6 questions internes sur 10 sans intervention humaine.",
    metric: { value: "6 sur 10", label: "questions résolues" },
  },
};
const localised = (c: LpCandidate, lang: ComposeInput["lang"]): LpCandidate => ({
  ...c,
  ...(lang === "fr" ? FR[c.pageId] : {}),
});

/** Client names the page may not show without permission, and the wording that replaces them. */
const BLOCKED: [RegExp, string][] = [
  [/Northwind( Bank)?/gi, "a European bank"],
  [/Contoso/gi, "a global manufacturer"],
  [/Wingtip/gi, "a public-sector body"],
];
const SENSITIVE =
  /((€|\$|CAD|EUR)\s?\d[\d.,]*\s?(k|m|M)?|\d[\d.,]*\s?(k€|M€|%\s?margin)|\bconfidential\b|\bNDA\b)/gi;

// ---------- compose ----------

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 3);

function pickReferences(input: ComposeInput): LpReference[] {
  const want = new Set([...words(input.angle), ...words(input.prospect.company)]);
  const scored = CANDIDATES.map((c, i) => ({
    c,
    s: words(`${c.title} ${c.summary}`).filter((w) => want.has(w)).length * 10 - i,
  })).sort((a, b) => b.s - a.s);
  return scored.slice(0, 4).map((x) => localised(x.c, input.lang));
}

// The copy is written in the chosen language only: the angle picks a theme, and the words of that theme
// come in both languages. The angle itself is never pasted in (people type it in any language).
type Theme = "ai" | "cloud" | "cyber" | "data" | "cost" | "change" | "general";
const THEMES: [Theme, RegExp][] = [
  ["ai", /\b(ai|ia|genai|llm|copilot|machine learning|intelligence artificielle)\b/i],
  ["cyber", /(cyber|security|sécurité|securite|compliance|conformité|risk|risque)/i],
  ["cloud", /(cloud|migration|infrastructure|devops|platform|plateforme)/i],
  ["data", /(\bdata\b|analytics|données|donnees|reporting|visibility|visibilité|supply)/i],
  ["cost", /(cost|finops|saving|économ|econom|margin|marge|coût|cout)/i],
  ["change", /(transform|agile|change|operating model|organi[sz]|conduite|adoption)/i],
];
const themeOf = (angle: string): Theme => THEMES.find(([, re]) => re.test(angle))?.[0] ?? "general";

interface Words {
  topic: string;
  hero: string;
  value: string;
  cases: string;
  cta: string;
}
const WHY = {
  en: "We ship in small steps, show results at every step and leave your teams holding the keys to what we build.",
  fr: "Nous livrons en petites étapes, nous montrons les résultats à chaque étape et nous laissons à vos équipes les clés de ce qui est construit.",
};
const WORDS: Record<"en" | "fr", Record<Theme, Words>> = {
  en: {
    ai: {
      topic: "AI that your teams actually use",
      hero: "AI that moves from pilot to daily work, for {company}",
      value:
        "It starts with the use cases that matter, a governance your risk team can sign, and a path to a service people rely on.",
      cases: "Engagements where AI went into production.",
      cta: "Talk about AI at {company}",
    },
    cyber: {
      topic: "security and compliance that hold under pressure",
      hero: "Security and compliance that hold under pressure, for {company}",
      value:
        "We make the controls you need visible, owned and tested, so the next audit is a routine.",
      cases: "Engagements where controls moved from paper to practice.",
      cta: "Talk security with us",
    },
    cloud: {
      topic: "cloud and platform change",
      hero: "A cloud move your teams can run, built for {company}",
      value:
        "We plan the move around the services you cannot interrupt, and leave a platform your teams can operate.",
      cases: "Engagements where a platform moved with no surprise.",
      cta: "Plan the move with us",
    },
    data: {
      topic: "data you can decide with",
      hero: "Data that supports the decision, for {company}",
      value:
        "We start from the decisions your leaders take every week and work back to the data they need.",
      cases: "Engagements where better data changed a decision.",
      cta: "Talk data with us",
    },
    cost: {
      topic: "lower cost without damage to the service",
      hero: "Lower cost, same service, a plan {company} can verify",
      value: "We look for the savings that last, each with an owner and a way to check it.",
      cases: "Engagements where efficiency was measured and kept.",
      cta: "Look at your levers with us",
    },
    change: {
      topic: "change that people adopt",
      hero: "Change your people adopt, designed with {company}",
      value:
        "We design the operating model, the tools and the habits as one programme and keep the steering group short.",
      cases: "Engagements where the new way of working held.",
      cta: "Shape the change with us",
    },
    general: {
      topic: "delivery you can rely on",
      hero: "A partner for what comes next at {company}",
      value:
        "We help leaders turn a priority into a plan and a plan into delivery, with a team accountable for the result.",
      cases: "Engagements that look like yours.",
      cta: "Start the conversation",
    },
  },
  fr: {
    ai: {
      topic: "une IA que vos équipes utilisent vraiment",
      hero: "Une IA qui passe du pilote au quotidien, pour {company}",
      value:
        "Tout commence par les cas d'usage qui comptent, une gouvernance que votre direction des risques peut signer, et un chemin vers un service fiable.",
      cases: "Des missions où l'IA est passée en production.",
      cta: "Parler d'IA chez {company}",
    },
    cyber: {
      topic: "une sécurité et une conformité qui tiennent sous pression",
      hero: "Une sécurité et une conformité qui tiennent, pour {company}",
      value:
        "Nous rendons les contrôles utiles visibles, attribués et testés, pour que le prochain audit soit une routine.",
      cases: "Des missions où les contrôles sont passés du papier à la pratique.",
      cta: "Parler sécurité avec nous",
    },
    cloud: {
      topic: "le changement de cloud et de plateforme",
      hero: "Une migration cloud que vos équipes savent exploiter, pour {company}",
      value:
        "Nous planifions le déménagement autour des services que vous ne pouvez pas interrompre et laissons une plateforme que vos équipes exploitent.",
      cases: "Des missions où une plateforme a changé sans surprise.",
      cta: "Préparer la migration avec nous",
    },
    data: {
      topic: "des données pour décider",
      hero: "Des données qui servent la décision, pour {company}",
      value:
        "Nous partons des décisions que vos dirigeants prennent chaque semaine et remontons aux données nécessaires.",
      cases: "Des missions où de meilleures données ont changé une décision.",
      cta: "Parler données avec nous",
    },
    cost: {
      topic: "des coûts réduits sans dégrader le service",
      hero: "Des coûts réduits, un service préservé, un plan que {company} peut vérifier",
      value:
        "Nous cherchons les économies qui durent, chacune avec un responsable et un moyen de contrôle.",
      cases: "Des missions où l'efficacité a été mesurée et conservée.",
      cta: "Examiner vos leviers avec nous",
    },
    change: {
      topic: "un changement que les équipes adoptent",
      hero: "Un changement que vos équipes adoptent, conçu avec {company}",
      value:
        "Nous concevons le modèle opérationnel, les outils et les habitudes comme un seul programme et gardons un comité de pilotage court.",
      cases: "Des missions où la nouvelle façon de travailler a tenu.",
      cta: "Façonner le changement avec nous",
    },
    general: {
      topic: "une exécution fiable",
      hero: "Un partenaire pour la suite chez {company}",
      value:
        "Nous aidons les dirigeants à transformer une priorité en plan, et un plan en livraison, avec une équipe responsable du résultat.",
      cases: "Des missions qui ressemblent à la vôtre.",
      cta: "Engager la conversation",
    },
  },
};

function writeSlots(input: ComposeInput): LpSlots {
  const { role, company, firstName } = input.prospect;
  const w = WORDS[input.lang][themeOf(input.angle)];
  const fill = (t: string) => t.replace("{company}", company);
  const fr = input.lang === "fr";
  const hi = firstName ? (fr ? `Bonjour ${firstName}. ` : `Hello ${firstName}. `) : "";
  return {
    hero: fill(w.hero),
    intro: fr
      ? `${hi}En tant que ${role} chez ${company}, vous avez une priorité : ${w.topic}. ${w.value}`
      : `${hi}As ${role} at ${company}, you have a priority: ${w.topic}. ${w.value}`,
    whyUs: WHY[input.lang],
    caseStudyIntro: w.cases,
    cta: fill(w.cta),
  };
}

// ---------- store ----------

interface Snap {
  slots: LpSlots;
  references: LpReference[];
  contact: LandingDraft["contact"];
  revision: number;
}
interface Rec {
  draft: LandingDraft;
  author: string;
  baseline: Snap;
  stats: LpStats;
  note?: string;
}
interface Store {
  seq: number;
  recs: Rec[];
}

const KEY = "secondary.mock.lp";
let mem: Store | null = null;

const snap = (d: LandingDraft): Snap => ({
  slots: { ...d.slots },
  references: d.references.map((r) => ({ ...r })),
  contact: { ...d.contact },
  revision: d.revision,
});
const hashOf = (d: LandingDraft) =>
  hash(JSON.stringify([d.slots, d.references.map((r) => r.pageId), d.contact, d.revision]))
    .toString(16)
    .padStart(8, "0")
    .repeat(8);
const zeros = (): LpStats => ({ views: 0, ctaClicks: 0, consentRate: 0, byDay: [] });
/** Daily view counts, newest last, as the API sends them: one entry per day. */
const days = (views: number[]): LpStats["byDay"] =>
  views.map((v, i) => ({
    day: new Date(Date.now() - (views.length - 1 - i) * DAY).toISOString().slice(0, 10),
    views: v,
    ctaClicks: Math.floor(v / 8),
  }));

function blank(
  store: Store,
  author: string,
  input: ComposeInput,
  extra: Partial<LandingDraft> = {},
): Rec {
  store.seq += 1;
  const draft: LandingDraft = {
    id: `lp_${store.seq}`,
    status: "draft",
    brand: input.brand,
    lang: input.lang,
    prospect: input.prospect,
    slots: writeSlots(input),
    references: pickReferences(input),
    contact: {
      name: author === "head_bid" ? "Sam Rowe" : "Jo Marsh",
      title: author === "head_bid" ? "Head of Bid and Pre-sales" : "Sales owner",
      email: "sales.owner@example.invalid",
    },
    revision: 1,
    revisionHash: "",
    composedBy: "deterministic",
    // Every page has a clock from the day it is composed; publishing restarts it.
    expiresAt: new Date(Date.now() + EXPIRY_DAYS * DAY).toISOString(),
    updatedAt: new Date().toISOString(),
    ...extra,
  };
  draft.revisionHash = hashOf(draft);
  return { draft, author, baseline: snap(draft), stats: zeros() };
}

function seed(): Store {
  const s: Store = { seq: 0, recs: [] };
  const now = Date.now();
  const pub = blank(
    s,
    "head_bid",
    {
      prospect: { firstName: "Mira", role: "Head of Digital", company: "Fabrikam" },
      angle: "Bid process that wins",
      brand: "amaris",
      lang: "en",
    },
    {
      status: "published",
      url: "https://pages.example.invalid/p/k7Qx2mVd9aRt4LwB",
      expiresAt: new Date(now + 62 * DAY).toISOString(),
      updatedAt: new Date(now - 3 * DAY).toISOString(),
    },
  );
  pub.stats = {
    views: 87,
    ctaClicks: 9,
    consentRate: 0.62,
    byDay: days([0, 2, 3, 1, 6, 9, 14, 8, 5, 11, 7, 10, 6, 5]),
  };
  const draft = blank(
    s,
    "head_bid",
    {
      prospect: { role: "CFO", company: "Contoso" },
      angle: "Supply chain visibility",
      brand: "mantu",
      lang: "fr",
    },
    { updatedAt: new Date(now - 3_600_000).toISOString() },
  );
  const old = blank(
    s,
    "head_bid",
    {
      prospect: { firstName: "Lee", role: "CIO", company: "Tailspin" },
      angle: "Data platform adoption",
      brand: "amaris",
      lang: "en",
    },
    {
      status: "expired",
      expiresAt: new Date(now - 4 * DAY).toISOString(),
      updatedAt: new Date(now - 94 * DAY).toISOString(),
    },
  );
  old.stats = {
    views: 31,
    ctaClicks: 2,
    consentRate: 0.48,
    byDay: days([1, 0, 4, 2, 3, 0, 1, 5, 2, 0, 3, 1, 0, 0]),
  };
  s.recs = [pub, draft, old];
  return s;
}

function store(): Store {
  if (mem) return mem;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (raw) {
      mem = JSON.parse(raw) as Store;
      return mem;
    }
  } catch {
    /* storage unavailable: the mock keeps state in memory for this page load */
  }
  mem = seed();
  return mem;
}
function persist() {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(mem));
  } catch {
    /* in memory only */
  }
}
/** Tests only. */
export function resetLpMock() {
  mem = null;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

// ---------- checks ----------

export function runChecks(d: LandingDraft): LpChecks {
  const issues: LpIssue[] = [];
  for (const id of SLOT_IDS) {
    const text = d.slots[id];
    for (const [re, plain] of BLOCKED) {
      re.lastIndex = 0;
      const m = text.match(re);
      if (m) {
        re.lastIndex = 0;
        issues.push({
          slot: id,
          kind: "customer-permission",
          detail: `Names a client without permission on record: ${m[0]}. Use a generalised description.`,
          fix: { label: `Replace with "${plain}"`, text: text.replace(re, plain) },
        });
      }
    }
    SENSITIVE.lastIndex = 0;
    const s = text.match(SENSITIVE);
    if (s) {
      SENSITIVE.lastIndex = 0;
      issues.push({
        slot: id,
        kind: "sensitivity",
        detail: `Looks like a price, a figure or a confidential marker: ${s[0]}.`,
        fix: {
          label: "Remove it",
          text: text
            .replace(SENSITIVE, "")
            .replace(/\s{2,}/g, " ")
            .replace(/\s+([.,])/g, "$1")
            .trim(),
        },
      });
    }
    if (text.length > LIMITS[id]) {
      const cut = text.slice(0, LIMITS[id] - 1).replace(/\s+\S*$/, "");
      issues.push({
        slot: id,
        kind: "length",
        detail: `${text.length} characters. This block holds ${LIMITS[id]} at most.`,
        fix: { label: "Shorten to fit", text: `${cut}.` },
      });
    }
    if (!text.trim()) issues.push({ slot: id, kind: "length", detail: "This block is empty." });
  }
  return { ok: issues.length === 0, issues };
}

// ---------- questions (the release inbox) ----------

function reviewDetail(r: Rec): LpReviewDetail {
  return { id: r.draft.id, draft: r.draft, previous: r.baseline };
}

export function lpQuestions(role: string): Question[] {
  if (!REVIEWERS.includes(role)) return [];
  return store()
    .recs.filter((r) => r.draft.status === "in_review" && r.author !== role)
    .map((r) => ({
      id: `q_lp_${r.draft.id}`,
      kind: "release" as const,
      title: `Landing page: ${r.draft.prospect.role} at ${r.draft.prospect.company}`,
      workspaceId: "core",
      createdAt: r.draft.updatedAt ?? new Date().toISOString(),
      summary: "Read the page as the visitor will see it, then approve this exact revision.",
      options: [
        { action: "approve", label: "Approve page" },
        { action: "request_changes", label: "Ask for changes" },
      ],
      detail: {
        approvals: 0,
        required: 1,
        revisionHash: r.draft.revisionHash,
        landing: reviewDetail(r),
      },
    }));
}

function approve(r: Rec, role: string, revisionHash: unknown) {
  if (r.draft.status !== "in_review")
    throw new ApiError(409, "This page is no longer waiting for review.");
  if (r.author === role)
    throw new ApiError(403, "You wrote this page, so a different person has to approve it.");
  if (!REVIEWERS.includes(role))
    throw new ApiError(403, "Only a reviewer can approve a landing page.");
  if (revisionHash !== r.draft.revisionHash)
    throw new ApiError(409, "The page changed after you opened it. Reload and read it again.");
  r.draft.status = "approved";
  persist();
}

export function lpAnswer(
  id: string,
  role: string,
  body: Record<string, unknown>,
): { ok: true } | typeof NO {
  const r = store().recs.find((x) => `q_lp_${x.draft.id}` === id);
  if (!r) return NO;
  if (body.action === "approve") approve(r, role, body.revisionHash);
  else {
    r.draft.status = "draft";
    r.note = typeof body.note === "string" ? body.note : undefined;
    persist();
  }
  return { ok: true };
}

// ---------- router ----------

function find(role: string, id: string): Rec {
  const r = store().recs.find((x) => x.draft.id === id);
  if (!r || (r.author !== role && !(REVIEWERS.includes(role) && r.draft.status !== "draft")))
    throw new ApiError(404, "This landing page does not exist, or it is not yours.");
  return r;
}
const mine = (role: string, id: string): Rec => {
  const r = find(role, id);
  if (r.author !== role) throw new ApiError(403, "Only the author can change this page.");
  return r;
};
const live = (r: Rec): LandingDraft => {
  const d = r.draft;
  if (d.status === "published" && d.expiresAt && Date.parse(d.expiresAt) < Date.now())
    d.status = "expired";
  return d;
};

export function handleLp(
  method: string,
  p: string,
  search: URLSearchParams,
  body: Record<string, unknown>,
  role: string,
): unknown {
  if (!p.startsWith("/v1/lp")) return NO;
  const s = store();
  if (p === "/v1/lp" && method === "GET")
    return s.recs
      .filter((r) => r.author === role)
      .map((r) => ({ ...live(r), stats: r.stats }) satisfies LandingSummary)
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  if (p === "/v1/lp/compose" && method === "POST") {
    const input = body as unknown as ComposeInput;
    if (!input.prospect?.role?.trim() || !input.prospect?.company?.trim())
      throw new ApiError(400, "Add the role and the company.");
    const { firstName, ...rest } = input.prospect;
    const r = blank(s, role, {
      ...input,
      prospect: firstName?.trim() ? { ...rest, firstName: firstName.trim() } : rest,
    });
    s.recs.push(r);
    persist();
    return r.draft;
  }
  const m = p.match(/^\/v1\/lp\/([^/]+)(\/[a-z]+)?$/);
  if (!m) return NO;
  const id = decodeURIComponent(m[1] as string);
  const sub = m[2];
  const rec = find(role, id);
  const d = live(rec);

  if (!sub && method === "GET") return d;
  if (!sub && method === "PUT") {
    mine(role, id);
    if (d.status !== "draft")
      throw new ApiError(403, "Only a draft can be edited. This page is already past that step.");
    if (body.revision !== d.revision)
      throw new ApiError(409, "This page changed since you opened it.");
    d.slots = { ...(body.slots as LpSlots) };
    d.references = ((body.references as LpReference[]) ?? []).slice(0, MAX_REFERENCES);
    d.contact = { ...(body.contact as LandingDraft["contact"]) };
    d.revision += 1;
    d.revisionHash = hashOf(d);
    d.updatedAt = new Date().toISOString();
    delete d.checks;
    persist();
    return d;
  }
  if (sub === "/references" && method === "GET") {
    const term = (search.get("q") ?? "").toLowerCase();
    return CANDIDATES.map((c) => localised(c, d.lang)).filter((c) =>
      `${c.title} ${c.summary}`.toLowerCase().includes(term),
    );
  }
  if (sub === "/check" && method === "POST") {
    mine(role, id);
    const c = runChecks(d);
    d.checks = c;
    return c;
  }
  if (sub === "/submit" && method === "POST") {
    mine(role, id);
    if (d.status !== "draft") throw new ApiError(409, "Only a draft can be sent for review.");
    if (!runChecks(d).ok) throw new ApiError(422, "Fix the open checks before you submit.");
    d.status = "in_review";
    d.updatedAt = new Date().toISOString();
    persist();
    return d;
  }
  if (sub === "/approve" && method === "POST") {
    approve(rec, role, body.revisionHash);
    return { ok: true, status: "approved", approvals: 1, required: 1 };
  }
  if (sub === "/publish" && method === "POST") {
    mine(role, id);
    if (d.status !== "approved")
      throw new ApiError(409, "A page goes public only after a reviewer approved it.");
    const slug = hash(`${d.id}${Date.now()}`).toString(36).padEnd(12, "x");
    d.status = "published";
    d.url = `https://pages.example.invalid/p/${slug}`;
    d.expiresAt = new Date(Date.now() + EXPIRY_DAYS * DAY).toISOString();
    d.updatedAt = new Date().toISOString();
    rec.stats = zeros();
    persist();
    return { url: d.url, expiresAt: d.expiresAt };
  }
  if (sub === "/unpublish" && method === "POST") {
    mine(role, id);
    d.status = "unpublished";
    delete d.url;
    d.updatedAt = new Date().toISOString();
    persist();
    return { ok: true };
  }
  if (sub === "/stats" && method === "GET") return rec.stats;
  return NO;
}
