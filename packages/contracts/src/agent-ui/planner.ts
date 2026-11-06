// The deterministic planner: no model, same line format. It answers when AI is off, over budget or
// unavailable, and it is what the dev mock uses. Pure: it only sees the brains the caller may read
// (id, name, type) and the text or action of the turn. It writes ids and fixed words, never data.

import { hasControl } from "./schemas.ts";

export interface BrainRef {
  id: string;
  name: string;
  type: string;
}

export type PlanInput = {
  text?: string;
  action?: { action: string; values: Record<string, string> };
  brains: readonly BrainRef[];
  lang?: "en" | "fr";
};

type Words = Record<
  | "flow"
  | "health"
  | "pages"
  | "map"
  | "focus"
  | "compare"
  | "overview"
  | "found"
  | "last30"
  | "open"
  | "focusBtn"
  | "none"
  | "who",
  string
>;

const WORDS: Record<"en" | "fr", Words> = {
  en: {
    flow: "Knowledge flow",
    health: "Brain health",
    pages: "Best pages",
    map: "Brain map",
    focus: "In focus",
    compare: "Side by side",
    overview: "Your brains",
    found: "Pages that match",
    last30: "Last 30 days",
    open: "Open",
    focusBtn: "Focus",
    none: "No brain matched that. Here are your brains.",
    who: "Who knows",
  },
  fr: {
    flow: "Flux de connaissances",
    health: "Santé du cerveau",
    pages: "Meilleures pages",
    map: "Carte du cerveau",
    focus: "En détail",
    compare: "Côte à côte",
    overview: "Vos cerveaux",
    found: "Pages qui correspondent",
    last30: "30 derniers jours",
    open: "Ouvrir",
    focusBtn: "Détail",
    none: "Aucun cerveau ne correspond. Voici vos cerveaux.",
    who: "Qui connaît",
  },
};

const fold = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "show",
  "me",
  "where",
  "what",
  "how",
  "this",
  "that",
  "stands",
  "stand",
  "month",
  "week",
  "quarter",
  "year",
  "pages",
  "page",
  "brain",
  "brains",
  "from",
  "about",
  "les",
  "des",
  "une",
  "est",
  "mon",
  "mes",
  "dans",
  "sur",
  "pour",
  "avec",
  "montre",
  "moi",
  "ou",
  "mois",
  "semaine",
]);
const tokens = (s: string): string[] =>
  fold(s)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOP.has(t));

/** The brains whose name shares words with the text, best first. */
export function matchBrains(text: string, brains: readonly BrainRef[]): BrainRef[] {
  const want = new Set(tokens(text));
  const folded = fold(text);
  return brains
    .map((b) => {
      const name = tokens(b.name);
      let score = name.filter((t) => want.has(t)).length;
      // "pre-sales" and "bid & pre-sales" share only the short tokens: fall back to a substring test.
      if (!score && folded.includes(fold(b.name))) score = name.length || 1;
      if (!score && b.id !== "me" && folded.split(/\s+/).includes(b.id)) score = 1;
      return { b, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, z) => z.score - a.score || a.b.name.localeCompare(z.b.name))
    .map((x) => x.b);
}

const q = (s: string): string =>
  JSON.stringify(
    [...s]
      .map((ch) => (hasControl(ch) ? " " : ch))
      .join("")
      .slice(0, 120),
  );
const windowOf = (text: string): "7d" | "30d" | "90d" => {
  const f = fold(text);
  if (/\b(week|semaine|7 ?d)/.test(f)) return "7d";
  if (/\b(quarter|trimestre|90 ?d)/.test(f)) return "90d";
  return "30d";
};

type Lines = string[];

function brainView(b: BrainRef, text: string, w: Words): { title: string; lines: Lines } {
  const win = windowOf(text);
  const lines: Lines = [
    "root = Stack([c1, c2, c3, nav])",
    `c1 = InsightCard(${q(`${b.name}: ${w.flow}`)}, [f1], ${q(win === "7d" ? "7d" : win === "90d" ? "90d" : w.last30)})`,
    `f1 = Funnel(${q(b.id)}, ${q(win)})`,
    `c2 = InsightCard(${q(`${b.name}: ${w.health}`)}, [s1])`,
    `s1 = Beeswarm(${q(b.id)}, "freshness")`,
    `c3 = InsightCard(${q(w.pages)}, [p1])`,
    `p1 = PageList(${q(tokens(text).join(" "))}, ${q(b.id)}, 5)`,
    "nav = Buttons([n1, n2])",
    `n1 = Button(${q(`${w.focusBtn}: ${b.name}`)}, "focus", {brain: ${q(b.id)}})`,
    `n2 = Button(${q(`${w.open} ${b.name}`)}, "open_brain", {brain: ${q(b.id)}})`,
  ];
  return { title: b.name, lines };
}

function focusView(b: BrainRef, page: string | undefined, w: Words): Lines {
  const pg = page ? `, ${q(page)}` : "";
  return [
    "root = Stack([c1, c2, nav])",
    `c1 = InsightCard(${q(`${b.name}: ${w.focus}`)}, [fit, act])`,
    `fit = FitBars(${q(b.id)}${pg})`,
    `act = ActivityGrid(${q(b.id)}${pg})`,
    `c2 = InsightCard(${q(w.map)}, [tl])`,
    `tl = TimelineBars(${q(b.id)}${pg})`,
    "nav = Buttons([n1])",
    `n1 = Button(${q(`${w.open} ${b.name}`)}, "open_brain", {brain: ${q(b.id)}})`,
  ];
}

function overview(brains: readonly BrainRef[], w: Words, lead?: string): Lines {
  const top = brains.slice(0, 4);
  if (!top.length) return ["root = Stack([note])", 'note = Callout("info", "empty")'];
  const out: Lines = [
    `root = Stack([${lead ? "note, " : ""}grid, nav])`,
    ...(lead ? [`note = Callout("info", "empty", ${q(lead)})`] : []),
    `grid = Grid([${top.map((_, i) => `k${i}`).join(", ")}], ${Math.min(top.length, 2)})`,
    ...top.map((b, i) => `k${i} = KpiTile(${q(b.name)}, ${q(b.id)}, "health")`),
    `nav = Buttons([${top.map((_, i) => `b${i}`).join(", ")}])`,
    ...top.map(
      (b, i) => `b${i} = Button(${q(`${w.focusBtn}: ${b.name}`)}, "focus", {brain: ${q(b.id)}})`,
    ),
  ];
  return out;
}

/** The program for one turn. Never throws; an unknown action falls back to the overview. */
export function planProgram(i: PlanInput): { title: string; program: string } {
  const w = WORDS[i.lang ?? "en"];
  const byId = new Map(i.brains.map((b) => [b.id, b]));
  const a = i.action;
  let title: string = w.overview;
  let lines: Lines;
  if (a?.action === "focus" && byId.has(a.values.brain ?? "")) {
    const b = byId.get(a.values.brain as string) as BrainRef;
    title = b.name;
    lines = focusView(b, a.values.page, w);
  } else if (a?.action === "compare" && byId.has(a.values.a ?? "") && byId.has(a.values.b ?? "")) {
    const x = byId.get(a.values.a as string) as BrainRef;
    const y = byId.get(a.values.b as string) as BrainRef;
    title = w.compare;
    lines = [
      "root = Stack([g, nav])",
      "g = Grid([c1, c2], 2)",
      `c1 = InsightCard(${q(x.name)}, [m1])`,
      `m1 = DotConstellation(${q(x.id)})`,
      `c2 = InsightCard(${q(y.name)}, [m2])`,
      `m2 = DotConstellation(${q(y.id)})`,
      "nav = Buttons([n1, n2])",
      `n1 = Button(${q(`${w.focusBtn}: ${x.name}`)}, "focus", {brain: ${q(x.id)}})`,
      `n2 = Button(${q(`${w.focusBtn}: ${y.name}`)}, "focus", {brain: ${q(y.id)}})`,
    ];
  } else if (a?.action === "filter" && byId.has(a.values.brain ?? "")) {
    const b = byId.get(a.values.brain as string) as BrainRef;
    title = b.name;
    lines = [
      "root = Stack([c1, c2])",
      `c1 = InsightCard(${q(`${b.name}: ${w.map}`)}, [m])`,
      `m = DotConstellation(${q(b.id)}, ${q(a.values.q ?? "")}, "relevance")`,
      `c2 = InsightCard(${q(w.found)}, [p])`,
      `p = PageList(${q(a.values.q ?? "")}, ${q(b.id)}, 8)`,
    ];
  } else {
    const text = a?.action === "ask" ? (a.values.text ?? "") : (i.text ?? "");
    const hits = text ? matchBrains(text, i.brains) : [];
    // "Who knows about pricing in Bid?": a people list, for the brain the text names if it names one.
    const who =
      /\b(who knows?|who has|who can|who is the expert|qui conna[iî]t|qui sait|qui peut)\b/i.test(
        text,
      );
    if (who && !a) {
      const topic = tokens(
        hits[0]
          ? text.replace(new RegExp(hits[0].name.replace(/[^\p{L}\p{N} ]/gu, "."), "i"), " ")
          : text,
      )
        .filter((t) => !["who", "knows", "know", "qui", "connait", "sait", "peut"].includes(t))
        .join(" ");
      if (topic) {
        const scoped = hits[0];
        return {
          title: w.who,
          program: [
            "root = Stack([c1, nav])",
            `c1 = InsightCard(${q(`${w.who}: ${topic}`)}, [p])`,
            `p = PeopleList(${q(topic)}, ${scoped ? q(scoped.id) : "null"}, 5)`,
            "nav = Buttons([b0])",
            ...(scoped
              ? [
                  `b0 = Button(${q(`${w.focusBtn}: ${scoped.name}`)}, "focus", {brain: ${q(scoped.id)}})`,
                ]
              : [`b0 = Button(${q(w.who)}, "ask", {text: ${q(topic)}})`]),
          ].join("\n"),
        };
      }
    }
    const two = /\b(compare|versus|vs|compar\w+|entre)\b/i.test(text) && hits.length >= 2;
    if (two) {
      return planProgram({
        ...i,
        text: undefined,
        action: {
          action: "compare",
          values: { a: (hits[0] as BrainRef).id, b: (hits[1] as BrainRef).id },
        },
      });
    }
    if (hits[0]) {
      const v = brainView(hits[0], text, w);
      title = v.title;
      lines = v.lines;
    } else if (text && tokens(text).length) {
      title = w.found;
      const first = i.brains[0];
      lines = [
        `root = Stack([c1${first ? ", nav" : ""}])`,
        `c1 = InsightCard(${q(w.found)}, [p])`,
        `p = PageList(${q(tokens(text).join(" "))}, null, 8)`,
        ...(first
          ? [
              "nav = Buttons([b0])",
              `b0 = Button(${q(`${w.focusBtn}: ${first.name}`)}, "focus", {brain: ${q(first.id)}})`,
            ]
          : []),
      ];
    } else {
      lines = overview(i.brains, w, text ? w.none : undefined);
    }
  }
  return { title, program: lines.join("\n") };
}
