// The copy of a landing page. Two composers, one result shape (the five slots):
//   - the deterministic composer: a good template per angle in French and English, no model, no network.
//     It is what runs whenever AI is off, unavailable, refused for the account, or out of budget.
//   - the AI composer: the same gate every AI path uses, with only generalised text sent, and every slot
//     it returns checked again (shape, length, no figure, no account name). A slot that fails the
//     check is replaced by the deterministic one, never shown.

import { callModel, extractJson, type FetchFn } from "../ai/anthropic.ts";
import type { AiGate } from "../ai/brief.ts";
import { type BudgetStore, reserve } from "../ai/budget.ts";
import { estimateTokens } from "../ai/config.ts";
import { residualIdentifiers } from "../wiki/text.ts";
import { languageOf } from "./lang.ts";
import { type Named, withoutMetrics } from "./refs.ts";
import {
  type Brand,
  cleanSlot,
  type Lang,
  type Prospect,
  type Reference,
  SLOT_MAX,
  SLOTS,
  type Slots,
} from "./types.ts";

export const BRAND_NAME: Record<Brand, string> = { amaris: "Amaris", mantu: "Mantu" };

type Theme = "ai" | "cloud" | "cyber" | "data" | "cost" | "change" | "general";
const THEMES: [Theme, RegExp][] = [
  [
    "ai",
    /\b(ai|ia|genai|llm|copilot|machine learning|intelligence artificielle|artificial intelligence)\b/i,
  ],
  [
    "cyber",
    /(cyber|security|sécurité|securite|compliance|conformité|conformite|dora|nis2|risk|risque)/i,
  ],
  ["cloud", /(cloud|migration|infrastructure|devops|platform|plateforme|modernis)/i],
  ["data", /(\bdata\b|analytics|données|donnees|reporting|\bbi\b)/i],
  ["cost", /(cost|finops|saving|économ|econom|margin|marge|efficien|coût|cout)/i],
  ["change", /(transform|agile|change|operating model|modèle opérat|organi[sz]|conduite)/i],
];
export const themeOf = (angle: string): Theme =>
  THEMES.find(([, re]) => re.test(angle))?.[0] ?? "general";

interface Words {
  /** What the page promises, in a few words. */
  topic: string;
  hero: string;
  value: string;
  why: string;
  cases: string;
  cta: string;
}

const EN: Record<Theme, Words> = {
  ai: {
    topic: "AI that your teams actually use",
    hero: "AI that moves from pilot to daily work, for {company}",
    value:
      "It starts with the use cases that matter to your business, a governance your risk team can sign, and a path from a first pilot to a service people rely on.",
    why: "We build with the people who run the process, not around them. Every use case has an owner, a measure and a decision on data before any model is chosen. That is how a pilot becomes part of daily work.",
    cases: "Engagements where AI went into production, shown the way we may share them.",
    cta: "Talk about AI at {company}",
  },
  cyber: {
    topic: "security and compliance that hold under pressure",
    hero: "Security and compliance that hold under pressure, for {company}",
    value:
      "Regulation changes faster than programmes do. We make the controls you need visible, owned and tested, so the next audit is a routine.",
    why: "Our teams combine consulting and hands-on engineering. We start from your real exposure, agree what good looks like with your risk owners, and deliver controls that run without heroics.",
    cases: "Engagements where controls moved from paper to practice.",
    cta: "Talk security with us",
  },
  cloud: {
    topic: "cloud and platform change",
    hero: "A cloud move your teams can run, built for {company}",
    value:
      "The move is the easy part. We plan it around the services you cannot interrupt, and leave you a platform your own teams can operate and extend.",
    why: "We rehearse the cut-over, name a client owner for every deliverable and hand over a run team that is ready on day one. Delivery stays predictable because the plan is short and the decisions are written down.",
    cases: "Engagements where a platform moved with no surprise for the business.",
    cta: "Plan the move with us",
  },
  data: {
    topic: "data you can decide with",
    hero: "Data that supports the decision, not another dashboard, for {company}",
    value:
      "We start from the decisions your leaders take every week and work back to the data they need, with owners, quality rules and a model people understand.",
    why: "We join business and data engineering in one team. A measure is agreed before a pipeline is built, and what is built is documented so it outlives the project.",
    cases: "Engagements where better data changed a decision.",
    cta: "Talk data with us",
  },
  cost: {
    topic: "cost and efficiency without damage to the service",
    hero: "Lower cost, same service, a plan {company} can verify",
    value:
      "We look for the savings that last: demand you can steer, platforms you can simplify and contracts you can renegotiate, each with an owner and a way to check it.",
    why: "We show our working. Each lever comes with its assumptions and the evidence behind it, so your finance partner can follow the logic and your teams can carry it out.",
    cases: "Engagements where efficiency was measured and kept.",
    cta: "Look at your levers with us",
  },
  change: {
    topic: "transformation that people adopt",
    hero: "Change your people adopt, designed with {company}",
    value:
      "Transformation succeeds when the operating model, the tools and the habits move together. We design the three as one programme and keep the steering group short.",
    why: "We agree the measure of success at the start, keep decisions written and make sure each team knows what changes for them and when. Adoption is planned, not hoped for.",
    cases: "Engagements where the new way of working held after the project ended.",
    cta: "Shape the change with us",
  },
  general: {
    topic: "delivery you can rely on",
    hero: "A partner for what comes next at {company}",
    value:
      "We help leaders turn a priority into a plan and a plan into delivery, with a team that stays accountable for the result.",
    why: "We combine consulting judgment with hands-on delivery. You get a small senior team, clear owners and decisions written down, from the first workshop to handover.",
    cases: "Engagements that look like yours.",
    cta: "Start the conversation",
  },
};

const FR: Record<Theme, Words> = {
  ai: {
    topic: "une IA que vos équipes utilisent vraiment",
    hero: "Une IA qui passe du pilote au quotidien, pour {company}",
    value:
      "Tout commence par les cas d'usage qui comptent pour votre activité, une gouvernance que votre direction des risques peut signer, et un chemin du premier pilote à un service fiable.",
    why: "Nous construisons avec les équipes qui font tourner le processus, pas à côté. Chaque cas d'usage a un responsable, une mesure et une décision sur les données avant tout choix de modèle. C'est ainsi qu'un pilote entre dans le travail de tous les jours.",
    cases:
      "Des missions où l'IA est passée en production, présentées comme nous pouvons les partager.",
    cta: "Parler d'IA chez {company}",
  },
  cyber: {
    topic: "une sécurité et une conformité qui tiennent sous pression",
    hero: "Une sécurité et une conformité qui tiennent sous pression, pour {company}",
    value:
      "La réglementation évolue plus vite que les programmes. Nous rendons les contrôles utiles visibles, attribués et testés, pour que le prochain audit soit une routine.",
    why: "Nos équipes associent conseil et ingénierie. Nous partons de votre exposition réelle, définissons avec vos responsables des risques ce qu'est un bon niveau, puis livrons des contrôles qui tournent sans effort héroïque.",
    cases: "Des missions où les contrôles sont passés du papier à la pratique.",
    cta: "Parler sécurité avec nous",
  },
  cloud: {
    topic: "le changement de cloud et de plateforme",
    hero: "Une migration cloud que vos équipes savent exploiter, pour {company}",
    value:
      "Le déménagement est la partie facile. Nous le planifions autour des services que vous ne pouvez pas interrompre et vous laissons une plateforme que vos équipes exploitent et font évoluer.",
    why: "Nous répétons la bascule, nommons un responsable côté client pour chaque livrable et remettons une équipe d'exploitation prête dès le premier jour. La livraison reste prévisible parce que le plan est court et les décisions écrites.",
    cases: "Des missions où une plateforme a changé sans surprise pour le métier.",
    cta: "Préparer la migration avec nous",
  },
  data: {
    topic: "des données pour décider",
    hero: "Des données qui servent la décision, pas un tableau de bord de plus, pour {company}",
    value:
      "Nous partons des décisions que vos dirigeants prennent chaque semaine et remontons aux données nécessaires, avec des responsables, des règles de qualité et un modèle compréhensible.",
    why: "Nous réunissons métier et ingénierie de la donnée dans une seule équipe. La mesure est convenue avant de construire un flux, et ce qui est construit est documenté pour durer au-delà du projet.",
    cases: "Des missions où de meilleures données ont changé une décision.",
    cta: "Parler données avec nous",
  },
  cost: {
    topic: "des coûts maîtrisés sans dégrader le service",
    hero: "Des coûts réduits, un service préservé, un plan que {company} peut vérifier",
    value:
      "Nous cherchons les économies qui durent : une demande que l'on peut piloter, des plateformes à simplifier et des contrats à renégocier, chacun avec un responsable et un moyen de contrôle.",
    why: "Nous montrons notre raisonnement. Chaque levier est accompagné de ses hypothèses et de ses preuves, pour que votre partenaire finance suive la logique et que vos équipes puissent l'exécuter.",
    cases: "Des missions où l'efficacité a été mesurée et conservée.",
    cta: "Examiner vos leviers avec nous",
  },
  change: {
    topic: "une transformation que les équipes adoptent",
    hero: "Un changement que vos équipes adoptent, conçu avec {company}",
    value:
      "Une transformation réussit quand le modèle opérationnel, les outils et les habitudes avancent ensemble. Nous concevons les trois comme un seul programme et gardons un comité de pilotage court.",
    why: "Nous fixons la mesure du succès dès le départ, écrivons les décisions et veillons à ce que chaque équipe sache ce qui change pour elle et quand. L'adoption est planifiée, pas espérée.",
    cases: "Des missions où la nouvelle façon de travailler a tenu après le projet.",
    cta: "Façonner le changement avec nous",
  },
  general: {
    topic: "une exécution fiable",
    hero: "Un partenaire pour la suite chez {company}",
    value:
      "Nous aidons les dirigeants à transformer une priorité en plan, et un plan en livraison, avec une équipe qui reste responsable du résultat.",
    why: "Nous associons jugement de conseil et exécution concrète. Vous avez une petite équipe senior, des responsables clairs et des décisions écrites, du premier atelier à la remise.",
    cases: "Des missions qui ressemblent à la vôtre.",
    cta: "Engager la conversation",
  },
};

const fill = (t: string, v: Record<string, string>): string =>
  t.replace(/\{(\w+)\}/g, (_m, k: string) => v[k] ?? "");

/** The deterministic composer. The same input always gives the same page. */
export function composeDeterministic(i: {
  prospect: Prospect;
  angle: string;
  lang: Lang;
  brand: Brand;
  refs: readonly Reference[];
}): Slots {
  const w = (i.lang === "fr" ? FR : EN)[themeOf(i.angle)];
  const company = i.prospect.company;
  const role = i.prospect.role;
  const brand = BRAND_NAME[i.brand];
  const first = i.prospect.firstName?.trim();
  const v = { company, role, brand, topic: w.topic };
  const intro =
    i.lang === "fr"
      ? `${first ? `Bonjour ${first}. ` : ""}En tant que ${role} chez ${company}, vous avez une priorité : ${w.topic}. ${w.value}`
      : `${first ? `Hello ${first}. ` : ""}As ${role} at ${company}, you have a priority: ${w.topic}. ${w.value}`;
  const slots: Slots = {
    hero: fill(w.hero, v),
    intro,
    whyUs: i.lang === "fr" ? `Pourquoi ${brand}. ${w.why}` : `Why ${brand}. ${w.why}`,
    caseStudyIntro: i.refs.length ? w.cases : "",
    cta: fill(w.cta, v),
  };
  for (const s of SLOTS) slots[s] = cleanSlot(slots[s]).slice(0, SLOT_MAX[s]);
  return slots;
}

// ---- the AI composer ----

const SYSTEM = `You write the copy of one landing page for a B2B consulting firm. Reply with one JSON object and nothing else.
Keys: hero, intro, whyUs, caseStudyIntro, cta. Every value is plain text, no markup, no links, no email addresses.
Rules:
- Write in the requested language and in the voice of the brand: direct, concrete, one idea per section.
- hero at most 140 characters, intro at most 420, whyUs at most 700, caseStudyIntro at most 300, cta at most 90 and an action.
- Use only the facts you are given. Never invent a figure, a percentage, a result, a client, a quote or a date.
- Never name any company except the prospect's. The references are already anonymised: describe them in general terms.
- caseStudyIntro introduces the references listed. If none are listed, write one neutral sentence about relevant experience.`;

export type AiCompose =
  | { ok: true; slots: Slots; tokens: number; replaced: Slot[] }
  | { ok: false; code: "budget" | "unavailable" };
type Slot = (typeof SLOTS)[number];

export async function composeWithAi(i: {
  ai: Extract<AiGate, { ok: true }>;
  budget: BudgetStore;
  prospect: Prospect;
  angle: string;
  lang: Lang;
  brand: Brand;
  refs: readonly Reference[];
  accounts: readonly Named[];
  fetch?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
}): Promise<AiCompose> {
  // The first name is personal data of a third party: it never goes to the processor. It is added here.
  const fallback = composeDeterministic({ ...i, prospect: i.prospect });
  const user = JSON.stringify({
    language: i.lang,
    brand: BRAND_NAME[i.brand],
    prospect: { role: i.prospect.role, company: i.prospect.company },
    angle: i.angle,
    references: i.refs.map((r) => ({ title: r.title, summary: r.summary })),
  });
  const estimate = estimateTokens(SYSTEM) + estimateTokens(user) + 900;
  const hold = await reserve(i.budget, estimate, i.ai.dailyBudget);
  if (!hold) return { ok: false, code: "budget" };
  const reply = await callModel({
    apiKey: i.ai.apiKey,
    model: i.ai.model,
    system: SYSTEM,
    user,
    maxTokens: 900,
    timeoutMs: i.ai.timeoutMs,
    retries: 1,
    ...(i.fetch ? { fetch: i.fetch } : {}),
    ...(i.sleep ? { sleep: i.sleep } : {}),
  });
  await hold.settle(reply.ok ? reply.usage.inputTokens + reply.usage.outputTokens : estimate);
  if (!reply.ok) return { ok: false, code: "unavailable" };
  const raw = extractJson(reply.text) as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") return { ok: false, code: "unavailable" };
  const others = i.accounts
    .filter((a) => !sameName(a.label, i.prospect.company))
    .flatMap((a) => a.ids);
  const slots = { ...fallback };
  const replaced: Slot[] = [];
  for (const s of SLOTS) {
    const v = typeof raw[s] === "string" ? cleanSlot(raw[s] as string) : "";
    // A slot with a figure, a name of another account, a link or an address is not used.
    // Nor is one in the other language: a page speaks the language it was asked for, all of it.
    const ok =
      v.length > 0 &&
      v.length <= SLOT_MAX[s] &&
      (languageOf(v) ?? i.lang) === i.lang &&
      withoutMetrics(v) === v.replace(/\s+/g, " ") &&
      !/https?:|www\.|@/i.test(v) &&
      residualIdentifiers(v, others).every((x) => x !== "account name or id");
    if (ok) slots[s] = v;
    else replaced.push(s);
  }
  // The greeting is added after the model, from the page's own data.
  if (i.prospect.firstName?.trim() && !replaced.includes("intro"))
    slots.intro = cleanSlot(
      `${i.lang === "fr" ? "Bonjour" : "Hello"} ${i.prospect.firstName.trim()}. ${slots.intro}`,
    ).slice(0, SLOT_MAX.intro);
  if (replaced.length >= 3) return { ok: false, code: "unavailable" };
  return {
    ok: true,
    slots,
    tokens: reply.usage.inputTokens + reply.usage.outputTokens,
    replaced,
  };
}

const sameName = (a: string, b: string): boolean =>
  a.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(a.toLowerCase());
