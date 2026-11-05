// Dev mock for the v3 brains endpoints (docs/API-CONTRACT.md "v3 brains"). Synthetic data only.
// It mirrors the policy bounds table so the UI can be tried without the stack, but the real API
// is the only place access is ever decided.
import { ApiError } from "../api";
import type {
  AccessView,
  AgentHost,
  BatchResult,
  BrainCard,
  BrainHome,
  BrainRole,
  BrainType,
  Change,
  CoachProposal,
  CoachView,
  Cohort,
  Everyone,
  FieldDef,
  Health,
  ImportFormat,
  ImportPreview,
  ImportResult,
  Member,
  NavBrain,
  NavItem,
  Publication,
  Template,
  Version,
} from "../views/brains/types";
import { NOT_HANDLED } from "./uxv2";

const NOW = Date.parse("2026-11-05T18:00:00.000Z");
const iso = (daysAgo: number, h = 0) =>
  new Date(NOW - daysAgo * 86_400_000 - h * 3_600_000).toISOString();
const day = (daysAgo: number) => iso(daysAgo).slice(0, 10);

interface MockBrain {
  id: string;
  /** The level somebody asked for and a second person has not confirmed yet. */
  openAsked?: Everyone | undefined;
  type: BrainType;
  name: string;
  template: Template;
  restricted: boolean;
  readers: number;
  publication: Publication;
  everyone: Everyone;
  /** Roles that can see the brain, and roles that manage it. */
  sees: string[];
  manages: string[];
  collections: { type: string; label: string; count: number; expected: boolean }[];
  health: Health;
  changes: Change[];
  members: Member[];
  fields: FieldDef[];
  lastActivityDaysAgo: number | null;
}

const C = (value: number, score: number) => ({ value, score });
const health = (
  score: number,
  lint: [number, number] | null,
  fresh: [number, number],
  orph: [number, number],
  back: [number, number] | null,
  cov: { have: number; want: number; missing: string[]; score: number },
): Health => ({
  score,
  components: {
    lint: lint ? C(...lint) : null,
    freshness: C(...fresh),
    orphans: C(...orph),
    backlog: back ? C(...back) : null,
    coverage: {
      value: cov.have,
      score: cov.score,
      have: cov.have,
      want: cov.want,
      missing: cov.missing,
    },
  },
});

const ALL = ["ceo", "head_bid", "acme_lead", "consultant", "reviewer", "platform_admin", "auditor"];

const BRAINS: MockBrain[] = [
  {
    id: "me",
    type: "personal",
    name: "My Secondary",
    template: "personal",
    restricted: false,
    readers: 1,
    publication: "review",
    everyone: "none",
    sees: ALL,
    manages: ALL,
    collections: [
      { type: "note", label: "Notes", count: 14, expected: true },
      { type: "interaction", label: "Interactions", count: 6, expected: true },
      { type: "topic", label: "Topics", count: 3, expected: false },
    ],
    health: health(81, [3, 74], [88, 88], [2, 90], [1, 95], {
      have: 2,
      want: 3,
      missing: ["Reading list"],
      score: 70,
    }),
    changes: [
      {
        pageId: "my-week",
        title: "My week with Acme",
        type: "note",
        change: "updated",
        revision: 3,
        at: iso(0, 5),
        actor: null,
        added: 6,
        removed: 2,
      },
    ],
    members: [],
    fields: [],
    lastActivityDaysAgo: 0,
  },
  {
    id: "core",
    type: "global",
    name: "Company Global",
    template: "global",
    restricted: true,
    readers: 412,
    publication: "review",
    everyone: "reader",
    sees: ALL,
    manages: ["platform_admin"],
    collections: [
      { type: "offer", label: "Offers", count: 9, expected: true },
      { type: "project", label: "Projects", count: 21, expected: true },
      { type: "expertise", label: "Expertise", count: 17, expected: true },
      { type: "bid", label: "Bids", count: 4, expected: true },
      { type: "glossary", label: "Glossary", count: 0, expected: true },
    ],
    health: health(72, [5, 62], [70, 70], [4, 85], [3, 78], {
      have: 4,
      want: 5,
      missing: ["Glossary"],
      score: 60,
    }),
    changes: [
      {
        pageId: "delivery-handbook",
        title: "Delivery handbook",
        type: "project",
        change: "updated",
        revision: 5,
        at: iso(1, 3),
        actor: "Delivery reviewer",
        added: 14,
        removed: 6,
      },
      {
        pageId: "bid-playbook",
        title: "Bid playbook",
        type: "bid",
        change: "updated",
        revision: 3,
        at: iso(2),
        actor: "Head of Bid & Pre-sales",
        added: 22,
        removed: 0,
      },
      {
        pageId: "success-stories",
        title: "Success stories",
        type: "offer",
        change: "new",
        revision: 1,
        at: iso(3, 4),
        actor: "Knowledge reviewer",
        added: 31,
        removed: 0,
      },
    ],
    members: [
      {
        principalId: "u_reviewer",
        email: "reviewer@example.invalid",
        role: "steward",
        state: "active",
      },
      {
        principalId: "u_platform_admin",
        email: "admin@example.invalid",
        role: "owner",
        state: "active",
      },
    ],
    fields: [],
    lastActivityDaysAgo: 1,
  },
  {
    id: "c_bid",
    type: "team",
    name: "Bid & Pre-sales",
    template: "bid",
    restricted: false,
    readers: 18,
    publication: "review",
    everyone: "none",
    sees: ["ceo", "head_bid", "reviewer", "platform_admin"],
    manages: ["head_bid"],
    collections: [
      { type: "bid", label: "Bids", count: 7, expected: true },
      { type: "offer", label: "Offers", count: 5, expected: true },
      { type: "lesson", label: "Lessons", count: 0, expected: true },
      { type: "expertise", label: "Expertise", count: 8, expected: false },
    ],
    health: health(64, [9, 48], [55, 55], [6, 72], [5, 60], {
      have: 3,
      want: 4,
      missing: ["Lessons"],
      score: 55,
    }),
    changes: [
      {
        pageId: "bid-playbook",
        title: "Bid playbook",
        type: "bid",
        change: "updated",
        revision: 3,
        at: iso(0, 9),
        actor: "Head of Bid & Pre-sales",
        added: 18,
        removed: 4,
      },
      {
        pageId: "analytics-retainer",
        title: "Analytics retainer offer",
        type: "offer",
        change: "new",
        revision: 1,
        at: iso(4),
        actor: "Consultant",
        added: 40,
        removed: 0,
      },
    ],
    members: [
      {
        principalId: "u_head_bid",
        email: "head.bid@example.invalid",
        role: "owner",
        state: "active",
      },
      {
        principalId: "u_consultant",
        email: "consultant@example.invalid",
        role: "contributor",
        state: "active",
      },
      {
        principalId: "u_reviewer",
        email: "reviewer@example.invalid",
        role: "steward",
        state: "active",
      },
    ],
    fields: [
      {
        key: "deadline",
        label: "Submission deadline",
        type: "date",
        sensitivity: "none",
        retentionDays: null,
        appliesTo: ["bid"],
      },
      {
        key: "win_probability",
        label: "Win probability",
        type: "number",
        sensitivity: "confidential",
        retentionDays: 730,
        appliesTo: ["bid"],
      },
    ],
    lastActivityDaysAgo: 0,
  },
  {
    id: "c_delivery",
    type: "team",
    name: "Delivery excellence",
    template: "practice",
    restricted: true,
    readers: 38,
    publication: "review",
    everyone: "none",
    sees: ["ceo", "consultant", "reviewer"],
    manages: [],
    collections: [
      { type: "method", label: "Methods", count: 11, expected: true },
      { type: "project", label: "Projects", count: 6, expected: true },
    ],
    health: health(88, null, [92, 92], [1, 96], null, {
      have: 2,
      want: 2,
      missing: [],
      score: 100,
    }),
    changes: [
      {
        pageId: "delivery-handbook",
        title: "Delivery handbook",
        type: "project",
        change: "updated",
        revision: 5,
        at: iso(1, 3),
        actor: "Delivery reviewer",
        added: 14,
        removed: 6,
      },
    ],
    members: [],
    fields: [],
    lastActivityDaysAgo: 1,
  },
  {
    id: "a_acme",
    type: "account",
    name: "Acme Synthetic SA",
    template: "account",
    restricted: true,
    readers: 6,
    publication: "review",
    everyone: "none",
    sees: ["ceo", "head_bid", "acme_lead"],
    manages: ["acme_lead"],
    collections: [
      { type: "client", label: "Clients", count: 1, expected: true },
      { type: "opportunity", label: "Opportunities", count: 2, expected: true },
      { type: "interaction", label: "Interactions", count: 4, expected: true },
      { type: "contact", label: "Contacts", count: 1, expected: true },
      { type: "commitment", label: "Commitments", count: 0, expected: true },
    ],
    health: health(77, [2, 80], [90, 90], [1, 94], [2, 82], {
      have: 4,
      want: 5,
      missing: ["Commitments"],
      score: 66,
    }),
    changes: [
      {
        pageId: "acme-overview",
        title: "Acme overview",
        type: "client",
        change: "updated",
        revision: 2,
        at: iso(0, 3),
        actor: "Account lead, Acme",
        added: 5,
        removed: 1,
      },
      {
        pageId: "acme-kickoff",
        title: "Kickoff meeting record",
        type: "interaction",
        change: "new",
        revision: 1,
        at: iso(3),
        actor: "Account lead, Acme",
        added: 28,
        removed: 0,
      },
    ],
    members: [
      {
        principalId: "u_acme_lead",
        email: "acme.lead@example.invalid",
        role: "owner",
        state: "active",
      },
      {
        principalId: "u_head_bid",
        email: "head.bid@example.invalid",
        role: "reader",
        state: "active",
      },
    ],
    fields: [
      {
        key: "renewal_date",
        label: "Renewal date",
        type: "date",
        sensitivity: "none",
        retentionDays: null,
        appliesTo: ["client"],
      },
      {
        key: "annual_value",
        label: "Annual value",
        type: "number",
        sensitivity: "confidential",
        retentionDays: 1095,
        appliesTo: ["client", "opportunity"],
      },
    ],
    lastActivityDaysAgo: 0,
  },
];

{
  const bid = BRAINS.find((b) => b.id === "c_bid") as MockBrain;
  BRAINS.push({
    ...bid,
    id: "c_sales",
    name: "Sales",
    template: "team",
    readers: 24,
    sees: ["ceo"],
    manages: ["ceo"],
    collections: [
      { type: "client", label: "Clients", count: 12, expected: true },
      { type: "opportunity", label: "Opportunities", count: 9, expected: true },
    ],
    changes: [],
    members: bid.members.map((m) => ({ ...m })),
    fields: [],
  });
}

/** Brains a person can see in the directory but not open (request access). */
const SEE_ONLY: { id: string; type: BrainType; name: string; opens: string[] }[] = [
  { id: "c_sales", type: "team", name: "Sales", opens: ["ceo"] },
  { id: "c_hr", type: "team", name: "HR, Legal and Hub Operations", opens: ["ceo"] },
];

const FLAG_KEYS = ["brains_v3", "imports", "coach", "batch_review", "journal"];
const cohorts: Cohort[] = [
  {
    id: "co_1",
    name: "Bid circle pilot",
    members: ["head.bid@example.invalid", "consultant@example.invalid"],
    flags: { imports: true, coach: true, batch_review: true, journal: true },
    createdAt: iso(6),
  },
];

const label = (r: string) => r.replace(/_/g, " ");
const brainOf = (id: string, role: string): MockBrain => {
  const br = BRAINS.find((x) => x.id === id);
  if (!br?.sees.includes(role)) throw new ApiError(404, "Not found.", { error: "not_found" });
  return br;
};
const manages = (br: MockBrain, role: string) => br.manages.includes(role);
const need = (br: MockBrain, role: string) => {
  if (!manages(br, role))
    throw new ApiError(403, "Only a person who manages this brain can do this.", {
      error: "forbidden",
    });
};

/** The policy bounds table from the contract. */
function bounds(br: MockBrain): {
  pub: Publication[];
  every: Everyone[];
  pubReason: string | null;
  everyReason: string | null;
} {
  if (br.type === "personal")
    return {
      pub: ["review", "direct"],
      every: ["none"],
      pubReason: null,
      everyReason: "A Personal Brain is never shared.",
    };
  if (br.type === "global")
    return {
      pub: ["review"],
      every: ["reader"],
      pubReason: "Company Global always needs a review before anything is published.",
      everyReason: "Everyone at Mantu reads Company Global. That level cannot change.",
    };
  if (br.type === "account")
    return {
      pub: ["review"],
      every: ["none"],
      pubReason: "Account brains always need a review before anything is published.",
      everyReason: "Account and NDA brains are never open to everyone at Mantu.",
    };
  if (br.restricted)
    return {
      pub: ["review"],
      every: ["none"],
      pubReason: "This team brain is restricted, so every change needs a review.",
      everyReason: "A restricted brain is never open to everyone at Mantu.",
    };
  return {
    pub: ["review", "direct"],
    every: ["none", "reader"],
    pubReason: null,
    everyReason: null,
  };
}

const ROLE_INFO: AccessView["roles"] = [
  {
    id: "reader",
    label: "Reader",
    summary: "Reads pages and structure.",
    actions: ["view_structure", "view_content"],
  },
  {
    id: "contributor",
    label: "Contributor",
    summary: "Reads, comments and sends changes for review.",
    actions: ["view_structure", "view_content", "comment", "contribute"],
  },
  {
    id: "editor",
    label: "Editor",
    summary: "Edits pages, hides versions, imports.",
    actions: ["view_structure", "view_content", "comment", "contribute", "edit"],
  },
  {
    id: "steward",
    label: "Steward",
    summary: "Reviews and approves releases.",
    actions: [
      "view_structure",
      "view_content",
      "comment",
      "contribute",
      "edit",
      "review",
      "approve_release",
    ],
  },
  {
    id: "owner",
    label: "Owner",
    summary: "Manages members and access.",
    actions: [
      "view_structure",
      "view_content",
      "comment",
      "contribute",
      "edit",
      "review",
      "approve_release",
      "manage_members",
    ],
  },
];

const roleIn = (br: MockBrain, role: string): BrainRole =>
  br.type === "personal" || manages(br, role)
    ? "owner"
    : br.type === "global"
      ? "reader"
      : role === "reviewer"
        ? "steward"
        : "contributor";

const card = (br: MockBrain, role: string): BrainCard => ({
  id: br.id,
  role: roleIn(br, role),
  type: br.type,
  name: br.name,
  template: br.template,
  readers: br.readers,
  manages: manages(br, role),
  restricted: br.restricted,
  publication: br.publication,
  pages: br.collections.reduce((n, c) => n + c.count, 0),
  health: { score: br.health.score },
  lastActivityAt: br.lastActivityDaysAgo === null ? null : iso(br.lastActivityDaysAgo, 2),
});

function homeOf(br: MockBrain, role: string): BrainHome {
  const mine = manages(br, role);
  // A caller who cannot decide proposals gets no lint or backlog and a score without them.
  const h: Health =
    mine || br.type === "personal"
      ? br.health
      : { ...br.health, components: { ...br.health.components, lint: null, backlog: null } };
  const missing = br.collections.filter((c) => c.expected && c.count === 0);
  return {
    ...card(br, role),
    health: h,
    collections: br.collections,
    changedThisWeek: { since: iso(7), total: br.changes.length, items: br.changes },
    coach: {
      available: mine,
      suggestions: missing.map((c) => ({
        kind: "missing_collection" as const,
        collection: c.type,
        message: `Nothing in ${c.label} yet. Add it so the brain answers questions about ${c.label.toLowerCase()}.`,
      })),
    },
  };
}

// ---------- per-page versions, journals, coach, agents ----------

const hiddenByPage = new Map<string, Version[]>();
function versionsOf(brainId: string, pid: string, edit: boolean): Version[] {
  const key = `${brainId}/${pid}`;
  let list = hiddenByPage.get(key);
  if (!list) {
    list = [
      { revision: 4, at: iso(0, 4), actor: "Delivery reviewer", hidden: false },
      {
        revision: 3,
        at: iso(2),
        actor: "Consultant",
        hidden: true,
        hiddenAt: iso(1),
        hiddenBy: "Knowledge reviewer",
        reason: "Contained a client name that should not be there.",
      },
      { revision: 2, at: iso(5), actor: "Delivery reviewer", hidden: false },
      { revision: 1, at: iso(12), actor: "Consultant", hidden: false },
    ];
    hiddenByPage.set(key, list);
  }
  return edit
    ? list
    : list.map((v) => (v.hidden ? { revision: v.revision, at: v.at, hidden: true } : v));
}

const JOURNAL_PAGES = new Map<string, string>();
function journalDays(brainId: string): { date: string; pageId: string }[] {
  const days = [1, 2, 3, 5, 6].map((d) => ({ date: day(d), pageId: `journal-${day(d)}` }));
  for (const d of days) JOURNAL_PAGES.set(`${brainId}/${d.pageId}`, d.date);
  return days;
}
function journalPage(brainId: string, pid: string) {
  const date = pid.replace("journal-", "");
  const br = BRAINS.find((x) => x.id === brainId);
  const links = (br?.changes ?? []).slice(0, 2).map((c) => c.pageId);
  const md = `# Journal ${date}\n\n- Ingested: ${links.length} pages ${links.map((l) => `[[${l}]]`).join(" ")}\n- Decided: 1 question answered\n- Contradictions: 1 waiting\n- Lint findings: 2\n- Approvals: 1\n`;
  return {
    id: pid,
    type: "journal",
    title: `Journal ${date}`,
    revision: 1,
    current: 1,
    markdown: md,
    summary: "Counts and links from the brain's own log.",
    citations: {},
    restricted: 0,
    links: links.map((l) => ({
      id: l,
      title: BRAINS.flatMap((x) => x.changes).find((c) => c.pageId === l)?.title ?? l,
      local: true,
    })),
    uncited: 0,
    updatedAt: iso(0, 8),
  };
}

const COACH_TEMPLATES: CoachView["templates"] = [
  {
    id: "account",
    label: "Account brain",
    collections: [
      { type: "client", label: "Clients", required: ["title", "sector"] },
      { type: "opportunity", label: "Opportunities", required: ["title", "stage"] },
      { type: "interaction", label: "Interactions", required: ["title", "date"] },
      { type: "commitment", label: "Commitments", required: ["title", "due"] },
    ],
  },
  {
    id: "bid",
    label: "Bid brain",
    collections: [
      { type: "bid", label: "Bids", required: ["title", "deadline"] },
      { type: "offer", label: "Offers", required: ["title"] },
      { type: "lesson", label: "Lessons", required: ["title"] },
    ],
  },
  {
    id: "practice",
    label: "Practice brain",
    collections: [
      { type: "method", label: "Methods", required: ["title"] },
      { type: "project", label: "Projects", required: ["title"] },
      { type: "expertise", label: "Expertise", required: ["title"] },
    ],
  },
  {
    id: "personal",
    label: "Personal",
    collections: [
      { type: "note", label: "Notes", required: ["title"] },
      { type: "interaction", label: "Interactions", required: ["title"] },
    ],
  },
];
const proposals = new Map<string, { brainId: string; hash: string; p: CoachProposal }>();

const hosts: AgentHost[] = [
  {
    id: "claude_code",
    label: "Claude Code",
    connected: true,
    lastCallAt: iso(0, 1),
    calls: 128,
    scopes: ["secondary.read", "secondary.contribute"],
    connections: [
      {
        id: "cn_cc_1",
        lastCallAt: iso(0, 1),
        lastTool: "search",
        scopes: ["secondary.read", "secondary.contribute"],
        state: "active",
      },
      {
        id: "cn_cc_2",
        lastCallAt: iso(9),
        lastTool: "get_brain_guide",
        scopes: ["secondary.read"],
        state: "active",
      },
    ],
  },
  {
    id: "claude_ai",
    label: "Claude.ai",
    connected: false,
    lastCallAt: null,
    calls: 0,
    scopes: [],
    connections: [],
  },
  {
    id: "chatgpt",
    label: "ChatGPT",
    connected: false,
    lastCallAt: null,
    calls: 0,
    scopes: [],
    connections: [],
  },
  {
    id: "codex",
    label: "Codex",
    connected: true,
    lastCallAt: iso(3),
    calls: 17,
    scopes: ["secondary.read"],
    connections: [
      {
        id: "cn_cx_1",
        lastCallAt: iso(3),
        lastTool: "ask",
        scopes: ["secondary.read"],
        state: "active",
      },
    ],
  },
  {
    id: "dust",
    label: "Dust",
    connected: false,
    lastCallAt: null,
    calls: 0,
    scopes: [],
    connections: [],
  },
  {
    id: "copilot_studio",
    label: "Copilot Studio",
    connected: false,
    lastCallAt: null,
    calls: 0,
    scopes: [],
    connections: [],
  },
];

// ---------- questions upgrades ----------

const AGE_MS: Record<string, [number, number]> = {
  "1d": [0, 86_400_000],
  "7d": [0, 7 * 86_400_000],
  "30d": [0, 30 * 86_400_000],
  older: [30 * 86_400_000, Number.POSITIVE_INFINITY],
};

// ---------- import ----------

function mockImport(
  br: MockBrain,
  format: ImportFormat,
  body: Record<string, unknown>,
): ImportResult {
  const name = String(body.fileName ?? "export.zip").replace(/\.[a-z]+$/i, "");
  const shared = br.type !== "personal";
  const ext = format === "obsidian" ? ".md" : format === "outline" ? ".json" : ".md";
  const keep = ["Welcome", "Customer onboarding", "Pricing principles", "Delivery checklist"].map(
    (t, i) => ({
      pageId: t.toLowerCase().replace(/\s+/g, "-"),
      title: t,
      state: (shared || i === 3 ? "draft" : "published") as "draft" | "published",
      ...(shared || i === 3 ? { proposalId: `prop_${i + 1}` } : {}),
    }),
  );
  return {
    ok: true,
    format,
    imported: keep,
    skipped: [
      { path: `${name}/HR/salary-review${ext}`, reason: "hr_material" },
      { path: `${name}/Journal/2026-09-14${ext}`, reason: "mostly_personal" },
      { path: `${name}/../outside${ext}`, reason: "unsafe_path" },
    ],
    asked: 1,
  };
}

function mockPreview(
  br: MockBrain,
  format: ImportFormat,
  body: Record<string, unknown>,
): ImportPreview {
  const r = mockImport(br, format, body);
  const rows: [string, "ingest" | "ask", string][] = [
    ["Welcome", "ingest", "Work content, nothing sensitive found"],
    ["Customer onboarding", "ingest", "Work content, nothing sensitive found"],
    ["Pricing principles", "ask", "Contains contact details; they would be masked"],
    ["Delivery checklist", "ingest", "Work content, nothing sensitive found"],
  ];
  return {
    ok: true,
    dryRun: true,
    format,
    pages: r.imported.map((p, i) => ({
      path: `${p.pageId}.md`,
      pageId: p.pageId,
      title: p.title,
      type: "topic",
      verdict: rows[i]?.[1] ?? "ingest",
      reason: rows[i]?.[2] ?? "",
      excluded: {},
      replaces: i === 1,
      state: p.state,
    })),
    skipped: r.skipped,
    asked: 1,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
void sleep;

export function handleV3(
  method: string,
  p: string,
  search: URLSearchParams,
  body: Record<string, unknown>,
  role: string,
  questions: () => {
    id: string;
    title: string;
    summary: string;
    kind: string;
    workspaceId: string;
    createdAt: string;
    detail?: { approvals?: number; required?: number } | null;
  }[],
  answerOne: (id: string, b: Record<string, unknown>) => unknown,
): unknown {
  if (method === "GET" && p === "/v1/me/flags") {
    const mine = role !== "auditor";
    const managed = new Set(cohorts.flatMap((c) => Object.keys(c.flags)));
    const flags: Record<string, boolean> = {};
    for (const k of FLAG_KEYS) flags[k] = managed.has(k) ? mine : true;
    return { flags };
  }

  // Questions: filters and batch.
  if (method === "GET" && p === "/v1/questions" && [...search.keys()].length) {
    const term = (search.get("q") ?? "").toLowerCase();
    const brain = search.get("brain");
    const kind = search.get("kind");
    const age = search.get("age");
    return questions().filter((x) => {
      if (term && !`${x.title} ${x.summary}`.toLowerCase().includes(term)) return false;
      if (brain && x.workspaceId !== brain) return false;
      if (kind && x.kind !== kind) return false;
      if (age && AGE_MS[age]) {
        const a = NOW - Date.parse(x.createdAt);
        const [lo, hi] = AGE_MS[age] as [number, number];
        if (age === "older" ? a <= lo : a > hi) return false;
      }
      return true;
    });
  }
  if (method === "POST" && p === "/v1/questions/batch") {
    const items =
      (body.items as { id: string; action: string; revisionHash?: string; note?: string }[]) ?? [];
    const out: BatchResult["results"] = [];
    for (const it of items) {
      const live = questions().find((x) => x.id === it.id);
      try {
        if (!live) throw new ApiError(404, "This question is already resolved.");
        const need2 = (live.detail?.required ?? 1) - (live.detail?.approvals ?? 0);
        if (/^(approve|accept)/.test(it.action) && live.detail?.required && need2 > 1) {
          if (!it.revisionHash)
            throw new ApiError(400, "Name the revision you read before approving.");
          live.detail.approvals = (live.detail.approvals ?? 0) + 1;
          out.push({ id: it.id, ok: true, status: "first_approval" });
          continue;
        }
        answerOne(it.id, { action: it.action, revisionHash: it.revisionHash, note: it.note });
        out.push({ id: it.id, ok: true, status: "resolved" });
      } catch (e) {
        out.push({
          id: it.id,
          ok: false,
          status: "refused",
          error:
            e instanceof ApiError && typeof e.body.error === "string" ? e.body.error : "refused",
          reason: e instanceof ApiError ? e.reason : "Refused.",
        });
      }
    }
    return {
      results: out,
      ok: out.filter((r) => r.ok).length,
      failed: out.filter((r) => !r.ok).length,
    } satisfies BatchResult;
  }

  // Journal pages are wiki pages.
  const jp = p.match(/^\/v1\/wiki\/([^/]+)\/pages\/(journal-[0-9-]+)$/);
  if (method === "GET" && jp) {
    const ws = decodeURIComponent(jp[1] as string);
    brainOf(ws, role);
    return journalPage(ws, jp[2] as string);
  }

  if (method === "GET" && p === "/v1/agents") return { hosts };
  if (method === "GET" && p === "/v1/agents/config")
    return { mcpUrl: "https://secondary-mcp-dev.tony-walteur.workers.dev/mcp" };
  const rc = p.match(/^\/v1\/agents\/connections\/([^/]+)\/revoke$/);
  if (method === "POST" && rc) {
    const id = decodeURIComponent(rc[1] as string);
    for (const h of hosts) {
      const c = h.connections.find((x) => x.id === id);
      if (c) {
        c.state = "revoked";
        h.connected = h.connections.some((x) => x.state === "active");
        return { ok: true, revoked: 1 };
      }
    }
    throw new ApiError(404, "Not found.");
  }
  const rh = p.match(/^\/v1\/agents\/hosts\/([^/]+)\/revoke$/);
  if (method === "POST" && rh) {
    const h = hosts.find((x) => x.id === decodeURIComponent(rh[1] as string));
    if (!h) throw new ApiError(404, "Not found.");
    const n = h.connections.filter((c) => c.state === "active").length;
    for (const c of h.connections) c.state = "revoked";
    h.connected = false;
    return { ok: true, revoked: n };
  }

  if (p === "/v1/admin/pilot" || p.startsWith("/v1/admin/pilot/")) {
    if (role !== "platform_admin" && role !== "ceo")
      throw new ApiError(403, "Only an administrator can manage pilot cohorts.", {
        error: "forbidden",
      });
    if (method === "GET") return { cohorts, flagKeys: FLAG_KEYS };
    if (method === "POST") {
      const id = `co_${cohorts.length + 2}`;
      cohorts.push({
        id,
        name: String(body.name),
        members: body.members as string[],
        flags: body.flags as Record<string, boolean>,
        createdAt: new Date(NOW).toISOString(),
      });
      return { id };
    }
    const id = decodeURIComponent(p.split("/").pop() as string);
    const i = cohorts.findIndex((c) => c.id === id);
    if (i < 0) throw new ApiError(404, "Not found.");
    if (method === "PUT") {
      cohorts[i] = {
        ...(cohorts[i] as Cohort),
        name: String(body.name),
        members: body.members as string[],
        flags: body.flags as Record<string, boolean>,
      };
      return { ok: true };
    }
    if (method === "DELETE") {
      cohorts.splice(i, 1);
      return { ok: true };
    }
  }

  if (p === "/v1/brains/nav" && method === "GET") {
    const mine = BRAINS.filter((x) => x.sees.includes(role));
    const withRole = (x: MockBrain) => card(x, role) as NavBrain;
    const order = ["c_bid", "c_sales", "accounts", "c_delivery"];
    const items: NavItem[] = [];
    for (const x of mine.filter((b) => b.type === "personal"))
      items.push({ ...withRole(x), group: "personal" });
    const accounts = mine.filter((b) => b.type === "account");
    const gov = mine.filter((b) => b.type === "team");
    const slots = order.flatMap((id): NavItem[] => {
      if (id === "accounts")
        return accounts.length
          ? [
              {
                ...withRole(accounts[0] as MockBrain),
                id: "accounts",
                name: "Accounts",
                type: "team",
                readers: 0,
                group: "governance",
                children: accounts.map(withRole),
              },
            ]
          : [];
      const b = gov.find((g) => g.id === id);
      return b ? [{ ...withRole(b), group: "governance", governanceId: b.id }] : [];
    });
    items.push(...slots);
    for (const x of mine.filter((b) => b.type === "global"))
      items.push({ ...withRole(x), group: "global" });
    return { items };
  }

  if (p === "/v1/brains" && method === "GET" && search.get("scope") === "all") {
    const type = search.get("type");
    const term = (search.get("q") ?? "").toLowerCase();
    const open = BRAINS.filter((x) => x.sees.includes(role)).map((x) => ({
      ...card(x, role),
      canOpen: true as const,
    }));
    const closed = SEE_ONLY.filter((x) => !x.opens.includes(role)).map((x) => ({
      id: x.id,
      type: x.type,
      name: x.name,
      canOpen: false as const,
      restricted: true,
      canRequestAccess: role !== "auditor",
    }));
    return {
      brains: [...open, ...closed].filter(
        (b) => (!type || b.type === type) && (!term || b.name.toLowerCase().includes(term)),
      ),
    };
  }

  if (p === "/v1/agents/revoke-all" && method === "POST") {
    if (body.confirm !== true) throw new ApiError(400, "Confirm first.");
    return { ok: true, revoked: 1 };
  }
  if (p === "/v1/admin/principals" && method === "GET")
    return ALL.map((r) => ({ id: `u_${r}`, email: `${r}@example.invalid`, roleIds: [r] }));
  if (p === "/v1/admin/access-requests" && method === "POST") return { ok: true };

  if (p === "/v1/brains" && method === "GET") {
    const type = search.get("type");
    const term = (search.get("q") ?? "").toLowerCase();
    const list = BRAINS.filter((x) => x.sees.includes(role))
      .filter((x) => (!type || x.type === type) && (!term || x.name.toLowerCase().includes(term)))
      .sort((a, b) => (a.id === "me" ? -1 : b.id === "me" ? 1 : a.name.localeCompare(b.name)));
    return { brains: list.map((x) => card(x, role)) };
  }

  const m = p.match(/^\/v1\/brains\/([^/]+)(\/.*)?$/);
  if (!m) return NOT_HANDLED;
  const id = decodeURIComponent(m[1] as string);
  const rest = m[2] ?? "";
  const br = brainOf(id, role);

  if (rest === "" && method === "GET") return homeOf(br, role);

  if (rest === "/push/page" && method === "POST") {
    const title = String(body.title ?? "").trim();
    if (!title) throw new ApiError(400, "Give the page a title.", { error: "invalid_title" });
    const pageId = `new-${title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")}`;
    const proposalId = `q_push_${Date.now() % 100000}`;
    const lines = String(body.markdown ?? "")
      .split("\n")
      .map((text) => ({ type: "add" as const, text }));
    const numberedLines = lines.map((l, i) => ({ ...l, change: i === 0 ? 0 : 0 }));
    (questions() as unknown[]).push({
      id: proposalId,
      kind: "review",
      title,
      workspaceId: br.id,
      createdAt: new Date().toISOString(),
      summary: String(body.markdown ?? "").slice(0, 120),
      options: [
        { action: "approve", label: "Approve" },
        { action: "reject", label: "Reject" },
      ],
      detail: {
        approvals: 0,
        required: 1,
        revisionHash: "9".repeat(64),
        authorId: `u_${role}`,
        changeCount: 1,
        pages: [{ pageId, title, diff: numberedLines }],
      },
    });
    return { ok: true, brainId: br.id, pageId, proposalId, status: "candidate" };
  }

  if (rest === "/template" && method === "POST") {
    need(br, role);
    const t = COACH_TEMPLATES.find((x) => x.id === body.template);
    if (!t) throw new ApiError(400, "Unknown template.", { error: "invalid_template" });
    br.template = t.id as Template;
    const added: string[] = [];
    for (const c of t.collections)
      if (!br.collections.some((x) => x.type === c.type)) {
        br.collections.push({ type: c.type, label: c.label, count: 0, expected: true });
        added.push(c.type);
      }
    return { ok: true, template: br.template, added };
  }

  if (rest === "/access") {
    const bd = bounds(br);
    if (method === "GET") {
      const mine = manages(br, role);
      const view: AccessView = {
        brainId: br.id,
        type: br.type,
        canManage: mine,
        publication: {
          mode: br.publication,
          allowed: bd.pub,
          forced: bd.pub.length === 1,
          reason: bd.pubReason,
        },
        everyone: { level: br.everyone, allowed: bd.every, reason: bd.everyReason },
        roles: ROLE_INFO,
        members: mine && br.type !== "personal" ? br.members : null,
      };
      return view;
    }
    if (method === "PUT") {
      need(br, role);
      if (body.publication !== undefined && !bd.pub.includes(body.publication as Publication))
        throw new ApiError(422, bd.pubReason ?? "That publication mode is not allowed here.", {
          error: "policy_bound",
        });
      if (body.everyone !== undefined && !bd.every.includes(body.everyone as Everyone))
        throw new ApiError(422, bd.everyReason ?? "That level is not allowed here.", {
          error: "policy_bound",
        });
      // Opening a brain to everyone needs a second person: the first request only asks.
      if (body.everyone && body.everyone !== "none" && body.everyone !== br.everyone) {
        if (br.openAsked !== body.everyone) {
          br.openAsked = body.everyone as Everyone;
          return { ok: true, status: "pending", needs: "second_person" };
        }
        br.openAsked = undefined;
      }
      if (body.publication) br.publication = body.publication as Publication;
      if (body.everyone) br.everyone = body.everyone as Everyone;
      return { ok: true, publication: br.publication, everyone: br.everyone };
    }
  }
  const mm = rest.match(/^\/access\/members\/([^/]+)$/);
  if (mm) {
    need(br, role);
    if (br.type === "personal")
      throw new ApiError(422, "A Personal Brain is never shared.", {
        error: "personal_not_shareable",
      });
    const pid = decodeURIComponent(mm[1] as string);
    if (pid === `u_${role}`)
      throw new ApiError(422, "Nobody changes their own role.", { error: "own_role" });
    const twoPerson = br.restricted || br.type === "account";
    if (method === "PUT") {
      const r = body.role as BrainRole;
      const cur = br.members.find((x) => x.principalId === pid);
      if (cur) cur.role = r;
      else
        br.members.push({
          principalId: pid,
          email: `${pid.replace(/^u_/, "")}@example.invalid`,
          role: r,
          state: twoPerson ? "pending" : "active",
        });
      if (twoPerson) {
        if (cur) cur.state = "pending";
        return {
          ok: true,
          status: "pending",
          changeId: `chg_${pid}`,
          member: { principalId: pid, role: r },
        };
      }
      return { ok: true, status: "applied", member: { principalId: pid, role: r } };
    }
    if (method === "DELETE") {
      const i = br.members.findIndex((x) => x.principalId === pid);
      if (i < 0) throw new ApiError(404, "Not found.");
      if (twoPerson) {
        (br.members[i] as Member).state = "pending";
        return {
          ok: true,
          status: "pending",
          changeId: `chg_rm_${pid}`,
          member: { principalId: pid, role: (br.members[i] as Member).role },
        };
      }
      const [gone] = br.members.splice(i, 1);
      return {
        ok: true,
        status: "applied",
        member: { principalId: pid, role: (gone as Member).role },
      };
    }
  }

  if (rest === "/fields") {
    if (method === "GET")
      return {
        fields: br.fields,
        types: ["text", "number", "date", "select", "email", "phone", "url"],
        sensitivities: ["none", "confidential", "personal"],
      };
    if (method === "PUT") {
      need(br, role);
      const fields = (body.fields as FieldDef[]) ?? [];
      if (br.type !== "personal" && fields.some((f) => f.sensitivity === "personal"))
        throw new ApiError(422, "Personal fields are not allowed in a shared brain.", {
          error: "personal_field_shared_brain",
        });
      br.fields = fields;
      return { ok: true };
    }
  }

  const vp = rest.match(/^\/pages\/([^/]+)\/versions(?:\/(\d+)\/(hide|restore))?$/);
  if (vp) {
    const pid = decodeURIComponent(vp[1] as string);
    const edit = manages(br, role) || ["reviewer", "head_bid", "acme_lead"].includes(role);
    if (method === "GET") return { versions: versionsOf(br.id, pid, edit) };
    if (method === "POST" && vp[2]) {
      if (!edit) throw new ApiError(403, "You need edit rights for this.", { error: "forbidden" });
      const list = versionsOf(br.id, pid, true);
      const v = list.find((x) => x.revision === Number(vp[2]));
      if (!v) throw new ApiError(404, "Not found.");
      if (vp[3] === "hide") {
        if (v === list[0])
          throw new ApiError(422, "The current revision cannot be hidden.", {
            error: "current_revision",
          });
        Object.assign(v, {
          hidden: true,
          hiddenAt: new Date(NOW).toISOString(),
          hiddenBy: label(role),
          reason: String(body.reason ?? ""),
        });
      } else {
        v.hidden = false;
        v.hiddenAt = undefined;
        v.hiddenBy = undefined;
        v.reason = undefined;
      }
      return { ok: true };
    }
  }

  if (rest === "/import" && method === "POST") {
    const fmt = search.get("format") as ImportFormat;
    if (!["okf", "obsidian", "outline"].includes(fmt))
      throw new ApiError(400, "Pick OKF, Obsidian or Outline.", { error: "invalid_format" });
    if (Number(body.size ?? 0) > 5 * 1024 * 1024)
      throw new ApiError(413, "The archive is larger than 5 MB.", { error: "too_large" });
    if (search.get("dryRun") === "1") return mockPreview(br, fmt, body);
    return mockImport(br, fmt, body);
  }

  if (rest === "/journal" && method === "GET") return { days: journalDays(br.id) };
  if (rest === "/journal/run" && method === "POST") {
    const date = String(body.date ?? day(1));
    if (date > day(0)) throw new ApiError(422, "A journal day cannot be in the future.");
    return { ok: true, pageId: `journal-${date}`, created: true };
  }

  if (rest === "/coach" && method === "GET") {
    need(br, role);
    return {
      brainId: br.id,
      questions: [
        {
          id: "role",
          prompt: "What is your role in this brain?",
          kind: "choice",
          options: ["Account lead", "Bid manager", "Practice lead", "Consultant"],
        },
        { id: "accounts", prompt: "Which accounts do you work on?", kind: "list" },
        { id: "recurring", prompt: "What work do you repeat every week?", kind: "list" },
        {
          id: "template",
          prompt: "Start from which template?",
          kind: "choice",
          options: COACH_TEMPLATES.map((t) => t.id),
        },
      ],
      templates: COACH_TEMPLATES,
      current: { template: br.template, collections: br.collections.map((c) => c.type) },
    } satisfies CoachView;
  }
  if (rest === "/coach/propose" && method === "POST") {
    need(br, role);
    const answers = (body.answers ?? {}) as { template?: string; role?: string };
    const tid = answers.template ?? br.template;
    const t = COACH_TEMPLATES.find((x) => x.id === tid);
    if (!t) throw new ApiError(400, "Unknown template.", { error: "invalid_template" });
    const have = new Set(br.collections.map((c) => c.type));
    const proposal: CoachProposal = {
      proposalId: `cp_${proposals.size + 1}`,
      hash: `h${"0".repeat(10)}${proposals.size + 1}`,
      template: t.id as Template,
      collections: t.collections.map((c) => ({ ...c, action: have.has(c.type) ? "keep" : "add" })),
      rationale: `Based on your answers, the ${t.label} fits${answers.role ? ` a ${answers.role.toLowerCase()}` : ""}. It keeps what you have and adds only the missing collections.`,
      expiresAt: new Date(NOW + 3_600_000).toISOString(),
    };
    proposals.set(proposal.proposalId, { brainId: br.id, hash: proposal.hash, p: proposal });
    return proposal;
  }
  if (rest === "/coach/apply" && method === "POST") {
    need(br, role);
    const pr = proposals.get(String(body.proposalId));
    if (!pr || pr.brainId !== br.id) throw new ApiError(404, "This proposal expired. Start again.");
    if (pr.hash !== body.hash) throw new ApiError(409, "The proposal changed. Start again.");
    const created: string[] = [];
    for (const c of pr.p.collections)
      if (c.action === "add" && !br.collections.some((x) => x.type === c.type)) {
        br.collections.push({ type: c.type, label: c.label, count: 0, expected: true });
        created.push(c.type);
      }
    br.template = pr.p.template;
    proposals.delete(pr.p.proposalId);
    return { ok: true, created };
  }
  return NOT_HANDLED;
}

export const v3Brains = BRAINS;
