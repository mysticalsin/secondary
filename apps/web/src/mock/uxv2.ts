// Dev mock for the UX v2 endpoints and the slice of the Living Wiki the Brain explorer reads.
// Synthetic data only (docs: CLAUDE.md data rules). Loaded only when VITE_MOCK=1.
import { ApiError } from "../api";
import type { ViewPlan } from "../types";
import type {
  AskEvent,
  Digest,
  Question,
  Routine,
  RoutineRun,
  TreeNode,
  Usage,
} from "../uxv2/types";
import type { WikiFact, WikiPage, WikiRevision, WikiSearchHit } from "../views/wiki/types";

export const NOT_HANDLED = Symbol("not handled");

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("aborted", "AbortError"));
    });
  });

// ---------- the synthetic brain ----------

const FOLDERS: Record<string, string> = {
  client: "Clients",
  project: "Projects",
  opportunity: "Opportunities",
  bid: "Bids",
  offer: "Offers",
  expertise: "Expertise",
  interaction: "Interactions",
  entity: "Entities",
  contact: "Contacts",
};

const DIAGRAM = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 120"><rect width="480" height="120" rx="14" fill="#2a1d38"/><g fill="none" stroke="#d791ff" stroke-width="2"><rect x="24" y="36" width="104" height="48" rx="10"/><rect x="188" y="36" width="104" height="48" rx="10"/><rect x="352" y="36" width="104" height="48" rx="10"/><path d="M128 60h60M292 60h60"/></g><g fill="#fff" font-family="Carlito,Calibri,sans-serif" font-size="16" text-anchor="middle"><text x="76" y="65">Index</text><text x="240" y="65">Pages</text><text x="404" y="65">Answer</text></g></svg>',
)}`;

interface MockPage {
  ws: string;
  id: string;
  type: string;
  title: string;
  summary: string;
  md: string;
}

const PAGES: MockPage[] = [
  {
    ws: "a_acme",
    id: "acme-overview",
    type: "client",
    title: "Acme overview",
    summary: "Who Acme is, what we deliver, and where the relationship stands.",
    md:
      "# Acme overview\n\nAcme is a synthetic manufacturing client. We run a data platform health check and a fixed fee analytics retainer for them {src:mtg:acme:1}.\n\n## Where it stands\n\n- Renewal is due 2027-03-31 {src:ctr:acme:1}\n- Sponsor is the Acme head of operations {src:mtg:acme:1}\n- Next step: scope the platform health check with [[acme-health-check]]\n\n![How an answer is built](" +
      DIAGRAM +
      ")\n\n## Open questions\n\n- Pricing for year two is not agreed yet {src:mtg:acme:2}",
  },
  {
    ws: "a_acme",
    id: "acme-health-check",
    type: "opportunity",
    title: "Data platform health check",
    summary: "A four week assessment of the Acme data platform. Proposal sent.",
    md: "# Data platform health check\n\nFour week assessment of the Acme data platform. Fixed fee. Proposal sent on 2026-10-28 {src:mtg:acme:2}.\n\n- Owner: account lead\n- Stage: proposal\n- Linked client: [[acme-overview]]",
  },
  {
    ws: "a_acme",
    id: "acme-kickoff",
    type: "interaction",
    title: "Kickoff call, 2 Nov",
    summary: "Decisions and commitments from the Acme kickoff call.",
    md: "# Kickoff call, 2 Nov\n\n- Decision: start with the health check {src:mtg:acme:1}\n- Commitment: share the draft scope by 8 Nov {src:mtg:acme:1}\n- Risk: data access is not confirmed {src:mtg:acme:2}",
  },
  {
    ws: "a_acme",
    id: "acme-contacts",
    type: "contact",
    title: "Acme contacts",
    summary: "Named people at Acme, restricted.",
    md: "# Acme contacts\n\n- Head of operations (ref c_001)\n- Data lead (ref c_002)",
  },
  {
    ws: "core",
    id: "success-stories",
    type: "offer",
    title: "Analytics retainer offer",
    summary: "Our fixed fee analytics retainer: scope, price bands, proof points.",
    md: "# Analytics retainer offer\n\nA monthly retainer for dashboards, data quality and a weekly digest {src:doc:offer:1}.\n\n- Price bands: three tiers, set by scope {src:doc:offer:1}\n- Proof points: two approved success stories {src:doc:offer:2}\n\nSee [[bid-playbook]] for how we position it in a bid.",
  },
  {
    ws: "core",
    id: "bid-playbook",
    type: "bid",
    title: "Bid playbook",
    summary: "How we qualify, price and review a bid.",
    md: "# Bid playbook\n\n- Qualify within two days {src:doc:bid:1}\n- Price with a second pair of eyes {src:doc:bid:1}\n- Red team before sending {src:doc:bid:2}\n\nRelated: [[success-stories]]",
  },
  {
    ws: "core",
    id: "data-governance",
    type: "expertise",
    title: "Data governance practice",
    summary: "What our data governance practice offers and who leads it.",
    md: "# Data governance practice\n\nOur data governance practice covers policy, lineage and stewardship {src:doc:exp:1}.\n\n- Lead: practice director\n- Reference method: three step maturity review {src:doc:exp:1}",
  },
  {
    ws: "core",
    id: "delivery-handbook",
    type: "project",
    title: "Delivery handbook",
    summary: "How a project is run: roles, rituals, handover.",
    md: "# Delivery handbook\n\nEvery step has an owner {src:doc:del:1}. A handover note closes each phase {src:doc:del:1}.",
  },
  {
    ws: "core",
    id: "mantu-entity",
    type: "entity",
    title: "Group entities",
    summary: "Legal entities and regions of the group.",
    md: "# Group entities\n\nThe group runs five regions: Montreal, Sao Paulo, Bogota, Paris and Ho Chi Minh City {src:doc:ent:1}.",
  },
  {
    ws: "me",
    id: "me-notes",
    type: "interaction",
    title: "My weekly notes",
    summary: "Private notes. Only you can read this.",
    md: "# My weekly notes\n\n- Follow up on the Acme scope\n- Draft a short offer one pager",
  },
  {
    ws: "me",
    id: "me-expertise",
    type: "expertise",
    title: "What I know well",
    summary: "My own expertise map.",
    md: "# What I know well\n\n- Data platform assessments\n- Bid red teaming",
  },
];

const SRC_TITLES: Record<string, string> = {
  "mtg:acme:1": "Kickoff meeting record, 2 Nov",
  "mtg:acme:2": "Scoping call record, 28 Oct",
  "ctr:acme:1": "Contract summary",
  "doc:offer:1": "Offer sheet",
  "doc:offer:2": "Two success stories",
  "doc:bid:1": "Bid method",
  "doc:bid:2": "Red team checklist",
  "doc:exp:1": "Practice sheet",
  "doc:del:1": "Handbook v3",
  "doc:ent:1": "Entity register",
};

const WS_LABEL: Record<string, string> = {
  core: "Company Global",
  a_acme: "Acme",
  me: "Personal Brain",
};

type Seen = "full" | "locked" | "hidden";
/** What a role sees per folder type. Contacts are locked or absent, Bids vary. Server enforcement is real, this is a stand-in. */
function seen(role: string, ws: string, type: string): Seen {
  if (ws === "me") return "full";
  if (ws === "a_acme" && !["ceo", "acme_lead", "head_bid"].includes(role)) return "hidden";
  if (type === "contact")
    return role === "acme_lead" || role === "ceo"
      ? "full"
      : role === "auditor"
        ? "hidden"
        : "locked";
  if (type === "bid")
    return role === "head_bid" || role === "ceo"
      ? "full"
      : role === "consultant"
        ? "locked"
        : role === "auditor"
          ? "hidden"
          : "full";
  return "full";
}

function workspaceTree(role: string, ws: string): TreeNode | null {
  const pages = PAGES.filter((p) => p.ws === ws);
  const types = [...new Set(pages.map((p) => p.type))];
  const folders: TreeNode[] = [];
  for (const type of Object.keys(FOLDERS).filter((t) => types.includes(t))) {
    const s = seen(role, ws, type);
    if (s === "hidden") continue;
    if (s === "locked") {
      folders.push({
        id: `${ws}/${type}`,
        label: FOLDERS[type] as string,
        kind: "folder",
        access: "locked",
      });
      continue;
    }
    const kids = pages
      .filter((p) => p.type === type)
      .map<TreeNode>((p) => ({ id: p.id, label: p.title, kind: "page", access: "full" }));
    folders.push({
      id: `${ws}/${type}`,
      label: FOLDERS[type] as string,
      kind: "folder",
      access: "full",
      count: kids.length,
      children: kids,
    });
  }
  if (!folders.length) return null;
  return {
    id: ws,
    label: WS_LABEL[ws] ?? ws,
    kind: "workspace",
    access: "full",
    children: folders,
  };
}

function wikiPage(role: string, ws: string, id: string): MockPage {
  const p = PAGES.find((x) => x.ws === ws && x.id === id);
  if (!p || seen(role, ws, p.type) !== "full") throw new ApiError(404, "Not found.");
  return p;
}

function citationsOf(md: string): WikiPage["citations"] {
  const out: WikiPage["citations"] = {};
  for (const m of md.matchAll(/\{src:([^}]+)\}/g)) {
    const k = m[1] as string;
    out[k] = { title: SRC_TITLES[k] ?? k, kind: "item" };
  }
  return out;
}

const FACTS: Record<string, WikiFact[]> = {
  a_acme: [
    {
      id: 1,
      subject: "commitment: Acme renewal",
      predicate: "due",
      object: "2027-03-31",
      validAt: "2026-09-01T00:00:00.000Z",
      invalidAt: "2026-11-02T00:00:00.000Z",
      recordedAt: "2026-09-01T00:00:00.000Z",
      sources: [{ id: "ctr:acme:1", title: "Contract summary" }],
      confidence: 0.9,
      origin: "human",
      verifiedBy: "u_acme_lead",
      unverified: false,
    },
    {
      id: 2,
      subject: "decision: Acme overview start with the health check",
      predicate: "status",
      object: "decided",
      validAt: "2026-11-02T00:00:00.000Z",
      invalidAt: null,
      recordedAt: "2026-11-02T00:00:00.000Z",
      sources: [{ id: "mtg:acme:1", title: "Kickoff meeting record, 2 Nov" }],
      confidence: 0.8,
      origin: "agent",
      verifiedBy: null,
      unverified: true,
    },
  ],
  core: [],
  me: [],
};

function hist(p: MockPage): WikiRevision[] {
  return [
    {
      revision: 2,
      title: p.title,
      actor: "u_acme_lead",
      at: "2026-11-03T15:20:00.000Z",
      proposalId: null,
      diff: [
        { type: "same", text: `# ${p.title}` },
        { type: "del", text: "- Pricing for year two: to be defined" },
        { type: "add", text: "- Pricing for year two is not agreed yet" },
      ],
    },
    {
      revision: 1,
      title: p.title,
      actor: "svc:wiki",
      at: "2026-10-29T09:00:00.000Z",
      proposalId: null,
      diff: [
        { type: "add", text: `# ${p.title}` },
        { type: "add", text: p.summary },
      ],
    },
  ];
}

function backlinks(role: string, ws: string, id: string): WikiSearchHit[] {
  const self = PAGES.find((p) => p.ws === ws && p.id === id);
  if (!self) return [];
  return PAGES.filter(
    (p) =>
      p.ws === ws && p.id !== id && seen(role, ws, p.type) === "full" && p.md.includes(`[[${id}]]`),
  ).map((p) => ({
    ws,
    label: WS_LABEL[ws] ?? ws,
    pageId: p.id,
    title: p.title,
    type: p.type,
    summary: p.summary,
    lines: [],
    restricted: 0,
  }));
}

// ---------- questions, routines, usage (in memory, per role) ----------

const questionsByRole = new Map<string, Question[]>();
function questionsFor(role: string): Question[] {
  let list = questionsByRole.get(role);
  if (list) return list;
  list = [
    {
      id: "q_ing_1",
      kind: "ingest",
      title: "Include the Q4 pricing thread?",
      workspaceId: "core",
      createdAt: "2026-11-05T13:10:00.000Z",
      summary: "A meeting note from your routine. It mentions a price.",
      options: [
        { action: "ingest", label: "Include" },
        { action: "skip", label: "Skip" },
      ],
      detail: {
        reason:
          "It names a price band, and the classifier cannot tell if it is a decision or a draft.",
      },
    },
    {
      id: "q_con_1",
      kind: "contradiction",
      title: "Acme renewal date",
      workspaceId: "a_acme",
      createdAt: "2026-11-05T12:40:00.000Z",
      summary: "Two sources disagree about when the Acme renewal is due.",
      options: [
        { action: "keep_current", label: "Keep the current page" },
        { action: "accept_incoming", label: "Use the new source" },
      ],
      detail: {
        current: { text: "Renewal is due 2027-03-31.", sources: ["Contract summary"] },
        incoming: {
          text: "Renewal moved to 2027-06-30.",
          sources: ["Kickoff meeting record, 2 Nov"],
        },
      },
    },
    {
      id: "q_lint_1",
      kind: "lint",
      title: "Page with no links: Group entities",
      workspaceId: "core",
      createdAt: "2026-11-04T08:00:00.000Z",
      summary: "No other page points to it. Link it or leave it.",
      options: [
        { action: "dismiss", label: "Leave it" },
        { action: "link", label: "Add a link" },
      ],
    },
  ];
  if (["ceo", "head_bid", "reviewer"].includes(role))
    list.push(
      {
        id: "q_rev_1",
        kind: "review",
        title: "Review: Analytics retainer offer",
        workspaceId: "core",
        createdAt: "2026-11-05T09:30:00.000Z",
        summary: "A new revision of the offer is waiting for a second pair of eyes.",
        options: [{ action: "approve", label: "Approve" }],
        detail: { approvals: 0, required: 1, revisionHash: "a".repeat(64) },
      },
      {
        id: "q_rel_1",
        kind: "release",
        title: "Release to Company Global: Bid playbook",
        workspaceId: "core",
        createdAt: "2026-11-04T16:00:00.000Z",
        summary: "Two different people must approve before this goes company wide.",
        options: [{ action: "approve", label: "Approve release" }],
        detail: { approvals: 1, required: 2, revisionHash: "b".repeat(64) },
      },
    );
  questionsByRole.set(role, list);
  return list;
}

const routinesByRole = new Map<string, Routine[]>();
const runsById = new Map<string, RoutineRun[]>();
function routinesFor(role: string): Routine[] {
  let list = routinesByRole.get(role);
  if (list) return list;
  list = [
    {
      id: "r_1",
      name: "My weekly meeting notes",
      source: { kind: "meetings" },
      schedule: "weekly",
      targetScopeId: "me",
      guardrails: { excludePersonal: true, excludeHR: true, excludeNewsletters: true },
      enabled: true,
    },
  ];
  routinesByRole.set(role, list);
  runsById.set("r_1", [
    {
      id: "run_2",
      at: "2026-11-03T06:00:00.000Z",
      ingested: 3,
      skipped: 4,
      asked: 1,
      tokens: 5120,
      items: [
        {
          title: "Acme kickoff notes",
          verdict: "ingest",
          reason: "Names a decision and a commitment.",
        },
        { title: "Team lunch", verdict: "skip", reason: "Personal. Excluded by your guardrails." },
        {
          title: "Vendor newsletter",
          verdict: "skip",
          reason: "Newsletter. Excluded by your guardrails.",
        },
        {
          title: "Q4 pricing thread",
          verdict: "ask",
          reason: "Mentions a price. Not sure it is a decision.",
        },
      ],
    },
  ]);
  return list;
}

function mockRun(r: Routine): RoutineRun {
  const run: RoutineRun = {
    id: `run_${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    ingested: 1,
    skipped: 1,
    asked: 0,
    tokens: 1480,
    items: [
      { title: `New note from ${r.source.kind}`, verdict: "ingest", reason: "Names a decision." },
      { title: "Holiday plans", verdict: "skip", reason: "Personal. Excluded by your guardrails." },
    ],
  };
  runsById.set(r.id, [run, ...(runsById.get(r.id) ?? [])]);
  return run;
}

let lastAskTokens = 0;
let totalTokens = 18420;

function usage(role: string, period: string): Usage {
  const k = period === "30d" ? 3.6 : 1;
  const me = {
    tokens: Math.round(totalTokens * k),
    runs: Math.round(14 * k),
    answers: Math.round(22 * k),
    savedPct: 94,
  };
  const out: Usage = {
    me,
    byCapability: [
      { capability: "ask", tokens: Math.round(me.tokens * 0.55), runs: me.answers },
      { capability: "digest", tokens: Math.round(me.tokens * 0.2), runs: Math.round(2 * k) },
      { capability: "routines", tokens: Math.round(me.tokens * 0.25), runs: Math.round(8 * k) },
    ],
  };
  if (role === "platform_admin")
    out.tenant = {
      tokens: me.tokens * 18,
      runs: me.runs * 14,
      savedPct: 92,
      answers: me.answers * 14,
    };
  return out;
}

const DIGEST: Digest = {
  weekOf: "2026-11-02",
  stats: { opportunities: 3, newLeads: 2, commitmentsDue: 4, wins: 1 },
  sections: [
    {
      title: "Opportunities traced",
      items: [
        { label: "Data platform health check", pageId: "acme-health-check", meta: "Proposal sent" },
        { label: "Analytics retainer offer", pageId: "success-stories", meta: "Updated this week" },
      ],
    },
    {
      title: "Commitments due",
      items: [
        { label: "Share the draft scope with Acme", pageId: "acme-kickoff", meta: "Due 8 Nov" },
      ],
    },
    {
      title: "Wins",
      items: [{ label: "Bid playbook released", pageId: "bid-playbook", meta: "Company Global" }],
    },
  ],
};

// ---------- ask ----------

export async function* mockAsk(
  text: string,
  persona: string | null,
  signal?: AbortSignal,
): AsyncGenerator<AskEvent> {
  const role = persona ?? "head_bid";
  const step = 140;
  yield { event: "status", data: { stage: "index" } };
  await sleep(step, signal);
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(
      (w) =>
        w.length > 3 &&
        ![
          "what",
          "which",
          "where",
          "that",
          "this",
          "with",
          "have",
          "from",
          "about",
          "should",
          "does",
        ].includes(w),
    );
  const hits = PAGES.filter(
    (p) =>
      seen(role, p.ws, p.type) === "full" &&
      p.ws !== "me" &&
      words.some((w) => `${p.title} ${p.summary} ${p.md}`.toLowerCase().includes(w)),
  ).slice(0, 3);
  yield { event: "status", data: { stage: "read" } };
  await sleep(step, signal);
  if (!hits.length) {
    yield { event: "answer", data: { markdown: "", unknown: true } };
    lastAskTokens = 410;
    totalTokens += lastAskTokens;
    yield {
      event: "usage",
      data: {
        inputTokens: 380,
        outputTokens: 30,
        indexTokensRead: 380,
        fullContextEstimate: 48000,
        savedPct: 99,
        processor: "deterministic",
      },
    };
    yield { event: "done", data: {} as Record<string, never> };
    return;
  }
  for (const h of hits) {
    yield {
      event: "citation",
      data: {
        pageId: h.id,
        title: h.title,
        workspaceId: h.ws,
        sourceIds: Object.keys(citationsOf(h.md)),
      },
    };
    await sleep(step / 2, signal);
  }
  yield { event: "status", data: { stage: "write" } };
  await sleep(step, signal);
  const plan: ViewPlan = {
    version: 1,
    title: "What the brain holds",
    components: [{ type: "KpiRow", props: { lens: "departments", metrics: ["items", "open"] } }],
  };
  yield { event: "plan", data: plan };
  await sleep(step, signal);
  const md = hits.map((h) => `**${h.title}.** ${h.summary}`).join("\n\n");
  yield { event: "answer", data: { markdown: md, unknown: false } };
  lastAskTokens = 2230;
  totalTokens += lastAskTokens;
  yield {
    event: "usage",
    data: {
      inputTokens: 2050,
      outputTokens: 180,
      indexTokensRead: 1840,
      fullContextEstimate: 48000,
      savedPct: 96,
      processor: "deterministic",
    },
  };
  yield { event: "done", data: {} as Record<string, never> };
}

// ---------- router ----------

export function handleV2(
  method: string,
  p: string,
  search: URLSearchParams,
  body: Record<string, unknown>,
  role: string,
): unknown {
  if (method === "GET" && p === "/v1/brain/tree") {
    const root = search.get("root");
    const ws = root === "personal" ? ["me"] : ["core", "a_acme"];
    return {
      roots: ws.map((w) => workspaceTree(role, w)).filter((n): n is TreeNode => n !== null),
    };
  }
  const wp = p.match(/^\/v1\/wiki\/([^/]+)\/(.*)$/);
  if (wp && method === "GET") {
    const ws = decodeURIComponent(wp[1] as string);
    const rest = wp[2] as string;
    const pg = rest.match(/^pages\/([^/]+)(\/history)?$/);
    if (pg) {
      const page = wikiPage(role, ws, decodeURIComponent(pg[1] as string));
      if (pg[2]) return hist(page);
      const links = [...page.md.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => {
        const t = PAGES.find((x) => x.ws === ws && x.id === m[1]);
        return {
          id: m[1] as string,
          title: t?.title ?? (m[1] as string),
          local: true,
          ...(t ? {} : { broken: true }),
        };
      });
      const out: WikiPage = {
        id: page.id,
        type: page.type,
        title: page.title,
        revision: 2,
        current: 2,
        markdown: page.md,
        summary: page.summary,
        citations: citationsOf(page.md),
        restricted: 0,
        links,
        uncited: 0,
        updatedAt: "2026-11-03T15:20:00.000Z",
      };
      return out;
    }
    if (rest.startsWith("facts")) return FACTS[ws] ?? [];
    if (rest.startsWith("search")) {
      // The real search is text based, so a page's backlinks are the pages that match its title.
      const term = (search.get("q") ?? "").toLowerCase();
      const self = PAGES.find((x) => x.ws === ws && x.title.toLowerCase() === term);
      return { results: self ? backlinks(role, ws, self.id) : [] };
    }
  }
  if (method === "GET" && p === "/v1/questions") return questionsFor(role);
  const qa = p.match(/^\/v1\/questions\/([^/]+)$/);
  if (method === "POST" && qa) {
    const list = questionsFor(role);
    const i = list.findIndex((x) => x.id === decodeURIComponent(qa[1] as string));
    const item = list[i];
    if (!item) throw new ApiError(404, "This question is already resolved.");
    if (item.kind === "release" && role === "head_bid" && body.action === "approve")
      throw new ApiError(403, "You wrote this change, so a different person has to approve it.");
    if ((item.kind === "review" || item.kind === "release") && !body.revisionHash)
      throw new ApiError(400, "Name the revision you read before approving.");
    list.splice(i, 1);
    return { ok: true };
  }
  if (p === "/v1/routines") {
    const list = routinesFor(role);
    if (method === "GET") return list;
    if (method === "POST") {
      const r = {
        ...(body as unknown as Routine),
        id: `r_${list.length + 1}_${Date.now() % 1000}`,
      };
      list.push(r);
      return r;
    }
  }
  const rt = p.match(/^\/v1\/routines\/([^/]+)(\/run|\/runs)?$/);
  if (rt) {
    const list = routinesFor(role);
    const id = decodeURIComponent(rt[1] as string);
    const r = list.find((x) => x.id === id);
    if (!r) throw new ApiError(404, "Not found.");
    if (rt[2] === "/runs" && method === "GET") return runsById.get(id) ?? [];
    if (rt[2] === "/run" && method === "POST") return mockRun(r);
    if (method === "GET") return r;
    if (method === "PUT") {
      Object.assign(r, body);
      return r;
    }
    if (method === "DELETE") {
      list.splice(list.indexOf(r), 1);
      return { ok: true };
    }
  }
  if (method === "GET" && p === "/v1/usage") return usage(role, search.get("period") ?? "7d");
  if (method === "GET" && p === "/v1/digest/preview") {
    // Only links to pages the reader can open, like the server.
    const open = (id?: string) => {
      const pg = PAGES.find((x) => x.id === id);
      return !id || (!!pg && seen(role, pg.ws, pg.type) === "full");
    };
    return {
      ...DIGEST,
      sections: DIGEST.sections
        .map((sec) => ({ ...sec, items: sec.items.filter((i) => open(i.pageId)) }))
        .filter((sec) => sec.items.length),
    };
  }
  if (method === "POST" && p === "/v1/digest/draft") return { draftId: "draft_digest_1" };
  return NOT_HANDLED;
}

export { lastAskTokens };
