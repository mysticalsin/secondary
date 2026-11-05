// Dev mock adapter. Loaded only when VITE_MOCK=1 (see src/api.ts). Synthetic data only.
import { ApiError } from "../api";
import { scanSensitive } from "../sensitive";
import type {
  AccountCard,
  AccountDetail,
  ActivityEntry,
  Candidate,
  Counts,
  GovernanceCard,
  Hub,
  Lens,
  MapNode,
  MapView,
  Me,
  NodeAction,
  NodeDetail,
  PersonalItem,
  ViewPlan,
} from "../types";
import { STAGES } from "../types";
import { ACCOUNTS, DEPARTMENTS, GOVERNANCES, hash, type Leaf, ORG, REGIONS, THEMES } from "./org";
import { canDo, ROLES, roleLabel, roleOf, vis } from "./policy";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pick = <T>(arr: readonly T[], h: number): T => arr[h % arr.length] as T;
const notNull = <T>(x: T | null): x is T => x !== null;

const zero = (): Counts => ({ items: 0, topics: 0, open: 0, gaps: 0, stars: 0 });

function sumCounts(kids: MapNode[]): Counts {
  return kids.reduce((a, k) => {
    if (!k.counts) return a;
    const own = k.children ? k.counts.topics : 1;
    return {
      items: a.items + k.counts.items,
      topics: a.topics + own,
      open: a.open + k.counts.open,
      gaps: a.gaps + k.counts.gaps,
      stars: a.stars + k.counts.stars,
    };
  }, zero());
}

function toNode(role: string, l: Leaf, kids?: MapNode[]): MapNode | null {
  const v = vis(role, l);
  if (v === "hidden") return null;
  const base = { id: l.id, label: l.label, kind: l.kind, plane: l.plane };
  if (v === "locked") {
    return {
      ...base,
      access: "locked",
      counts: null,
      freshnessDays: null,
      signals: { open: false, star: false, gap: false },
    };
  }
  const structure = v === "structure";
  const counts: Counts = kids?.length
    ? sumCounts(kids)
    : {
        items: l.items,
        topics: 0,
        open: l.open ? 1 : 0,
        gaps: l.gap ? 1 : 0,
        stars: l.star ? 1 : 0,
      };
  return {
    ...base,
    access: structure ? "partial" : "full",
    counts: structure ? null : counts,
    freshnessDays: structure ? null : l.fresh,
    signals: structure
      ? { open: false, star: false, gap: false }
      : { open: l.open || counts.open > 0, star: l.star, gap: l.gap },
    ...(kids ? { children: kids } : {}),
  };
}

function hubOf(
  role: string,
  l: Leaf,
  kind: Hub["kind"],
  group: string | undefined,
  kids: MapNode[],
): Hub | null {
  const v = vis(role, l);
  if (v === "hidden") return null;
  if (kids.length === 0 && (kind === "region" || kind === "theme")) return null;
  const allLocked = kids.length > 0 && kids.every((k) => k.access === "locked");
  if (allLocked && kind === "department") {
    return { id: l.id, label: l.label, kind, group, access: "locked", counts: null, children: [] };
  }
  const structure = v === "structure";
  const partial = kids.some((k) => k.access !== "full");
  return {
    id: l.id,
    label: l.label,
    kind,
    group,
    access: structure || partial ? "partial" : "full",
    counts: structure ? null : sumCounts(kids),
    children: kids,
  };
}

const GROUP = { bl: "Business line", cf: "Corporate function" } as const;

function buildMap(role: string, lens: Lens): MapView {
  const hubs: Hub[] = [];
  if (lens === "departments") {
    for (const [did, , group] of DEPARTMENTS) {
      const d = ORG.nodes.get(did) as Leaf;
      const circles = (ORG.circlesOfDept.get(did) ?? [])
        .map((c) => {
          if (vis(role, c) === "locked") return toNode(role, c);
          const topics = (ORG.topicsOfCircle.get(c.id) ?? [])
            .map((t) => toNode(role, t))
            .filter(notNull);
          return toNode(role, c, topics);
        })
        .filter(notNull);
      const h = hubOf(role, d, "department", GROUP[group], circles);
      if (h) hubs.push(h);
    }
  } else if (lens === "governances") {
    for (const [gid, , group] of GOVERNANCES) {
      const gl = ORG.nodes.get(gid) as Leaf;
      if (vis(role, gl) === "locked") {
        hubs.push({
          id: gid,
          label: gl.label,
          kind: "governance",
          group: GROUP[group],
          access: "locked",
          counts: null,
          children: [],
        });
        continue;
      }
      const ucs = (ORG.useCasesOfGov.get(gid) ?? []).map((u) => toNode(role, u)).filter(notNull);
      const h = hubOf(role, gl, "governance", GROUP[group], ucs);
      if (h) hubs.push(h);
    }
  } else if (lens === "topics") {
    for (const [tid] of THEMES) {
      const t = ORG.nodes.get(tid) as Leaf;
      const items = (ORG.itemsOfTheme.get(tid) ?? []).map((i) => toNode(role, i)).filter(notNull);
      const h = hubOf(role, t, "theme", undefined, items);
      if (h) hubs.push(h);
    }
  } else {
    for (const [rid] of REGIONS) {
      const r = ORG.nodes.get(rid) as Leaf;
      const countries: MapNode[] = [];
      for (const [kid, list] of ORG.accountsOfCountry) {
        const k = ORG.nodes.get(kid) as Leaf;
        if (k.region !== rid) continue;
        const accs = list.map((a) => toNode(role, a)).filter(notNull);
        if (accs.length === 0) continue;
        const cn = toNode(role, k, accs);
        if (cn) countries.push(cn);
      }
      const h = hubOf(role, r, "region", undefined, countries);
      if (h) hubs.push(h);
    }
  }
  return {
    lens,
    viewerScopeHash: `${role}:${lens}`.slice(0, 12),
    core: { id: "core", label: "Company Global", topicCount: 14 },
    hubs,
    links: [
      { from: "k_brazil", to: "k_colombia", label: "Deployed in Brazil, replication in design" },
    ],
  };
}

const SUFFIX = [
  "guidance page",
  "decision record",
  "working template",
  "lessons summary",
  "review notes",
  "checklist",
];
const SRC = [
  "Wiki page",
  "Decision log",
  "Document store",
  "Meeting capture",
  "Policy repository",
  "Ticket export",
];
const OWNERS = [
  "Steward",
  "Practice lead",
  "Delivery manager",
  "Analyst",
  "Function head",
  "Reviewer",
];
const GONE = "This record does not exist, or it is outside your scope.";

function nodeDetail(role: string, id: string): NodeDetail {
  const l = ORG.nodes.get(id);
  if (!l) throw new ApiError(404, GONE);
  const v = vis(role, l);
  if (v === "hidden") throw new ApiError(404, GONE);
  const kids =
    l.kind === "circle"
      ? ORG.topicsOfCircle.get(l.id)
      : l.kind === "department"
        ? ORG.circlesOfDept.get(l.id)
        : l.kind === "governance"
          ? ORG.useCasesOfGov.get(l.id)
          : undefined;
  const kidNodes =
    kids && v === "full" ? kids.map((k) => toNode(role, k)).filter(notNull) : undefined;
  const node = toNode(role, l, kidNodes) as MapNode;
  const h = hash(l.id);
  const facts: Record<string, string> = { Type: l.kind };
  const badges: string[] = [];
  if (l.restricted) badges.push("Restricted");
  if (l.nda) badges.push("NDA");
  if (v === "locked") badges.push("Locked");
  if (v === "full") {
    facts.Status = pick(["approved", "approved", "approved", "candidate", "draft"], h);
    facts.Revision = `r${1 + ((h >>> 14) % 9)}`;
    facts.Evidence = l.evidence;
    facts["Owner role"] = pick(OWNERS, h >>> 9);
    facts["Source lineage"] =
      `${pick(SRC, h >>> 7)} > ${(l.parent && ORG.nodes.get(l.parent)?.label) || "Company"}`;
    if (l.stage) facts["Maturity stage"] = l.stage;
    const a = ACCOUNTS.find((x) => x.id === l.id);
    if (a) {
      facts.Sector = a.sector;
      facts.Country = a.country;
      facts["AI processing"] = a.ai;
    }
  }
  const items =
    v === "full"
      ? [0, 1, 2, 3].map((i) => {
          const gh = hash(l.id + i);
          return {
            title: `${l.label}: ${pick(SUFFIX, gh >>> 3)}`,
            source: pick(SRC, gh >>> 6),
            ownerRole: pick(OWNERS, gh >>> 9),
            revision: `r${1 + ((gh >>> 12) % 9)}`,
            evidence: l.gap
              ? ("unsupported" as const)
              : pick(["supported", "supported", "partial"] as const, gh),
            plane: l.plane,
            reviewedBy2: l.plane === "GLOBAL" && i < 2,
          };
        })
      : [];
  const backlinks: NodeDetail["backlinks"] = [];
  if (v === "full") {
    const p = l.parent ? ORG.nodes.get(l.parent) : undefined;
    if (p && vis(role, p) !== "hidden") backlinks.push({ id: p.id, label: p.label, type: p.kind });
    for (const [tid, tl] of THEMES) {
      if ((ORG.itemsOfTheme.get(tid) ?? []).some((i) => i.label === l.label) && tid !== l.parent) {
        backlinks.push({ id: tid, label: tl, type: "theme" });
      }
    }
  }
  const defs: [NodeAction["action"], string, NodeAction["group"]][] = [
    ["comment", "Comment", "Collaborate"],
    ["contribute", "Contribute", "Collaborate"],
    ["edit", "Edit", "Collaborate"],
    ["review", "Review", "Govern"],
    ["approve_release", "Approve release", "Govern"],
    ["manage_members", "Manage members", "Govern"],
    ["configure", "Configure", "Admin"],
  ];
  const actions: NodeAction[] = defs.map(([action, label, group]) =>
    v === "locked"
      ? {
          action,
          label,
          group,
          allowed: false,
          reason: "This scope is locked for your role. Request access to see inside.",
        }
      : { action, label, group, ...canDo(role, l, action) },
  );
  if (v === "locked") {
    actions.push({
      action: "request_access",
      label: "Request access",
      group: "Collaborate",
      allowed: true,
      reason: "Sends a request to the scope steward.",
    });
  }
  return { node: { ...node, facts, badges }, items, backlinks, actions };
}

// ---- review queue (in-memory) ----
interface MockCandidate extends Candidate {
  authorRole: string;
  visibleTo: string[];
  approvedBy: string[];
}
const okAction = { allowed: true, reason: "" };
const candidates: MockCandidate[] = [
  {
    id: "cand_1",
    nodeId: "t_c_bid_pricing_models",
    title: "Pricing models: discount ranges",
    scopeLabel: "Bid & Pre-sales",
    plane: "TEAM",
    author: "Consultant, Delivery",
    authorRole: "consultant",
    revision: "r4",
    previousRevision: "r3",
    submittedAt: "2026-11-02T14:10:00Z",
    visibleTo: ["head_bid", "reviewer"],
    approvedBy: [],
    diff: [
      { type: "same", text: "Discount ranges follow the rate card bands." },
      { type: "del", text: "Volume discounts above 12% need the Head of Bid sign-off." },
      {
        type: "add",
        text: "Volume discounts above 10% need the Head of Bid sign-off, and above 15% a second approver.",
      },
      { type: "same", text: "Every exception is logged with the bid reference." },
    ],
    flags: [],
    twoPerson: { required: true, approvals: 1, needed: 2 },
    approve: okAction,
    requestChanges: okAction,
  },
  {
    id: "cand_2",
    nodeId: "t_c_delivery_quality_gates",
    title: "Quality gates: release checklist",
    scopeLabel: "Delivery",
    plane: "TEAM",
    author: "Knowledge reviewer",
    authorRole: "reviewer",
    revision: "r2",
    previousRevision: "r1",
    submittedAt: "2026-11-03T09:40:00Z",
    visibleTo: ["reviewer"],
    approvedBy: [],
    diff: [
      { type: "same", text: "Gate 1: scope and acceptance criteria agreed in writing." },
      { type: "add", text: "Gate 2: test evidence attached before the demo, not after." },
      { type: "same", text: "Gate 3: client sign-off recorded in the account workspace." },
    ],
    flags: [],
    twoPerson: { required: false, approvals: 0, needed: 1 },
    approve: okAction,
    requestChanges: okAction,
  },
  {
    id: "cand_3",
    nodeId: "t_c_bid_win_themes",
    title: "Win themes: retail renewals (from My Secondary)",
    scopeLabel: "Bid & Pre-sales",
    plane: "TEAM",
    author: "Head of Bid & Pre-sales",
    authorRole: "head_bid",
    revision: "r1",
    previousRevision: null,
    submittedAt: "2026-11-03T16:25:00Z",
    visibleTo: ["head_bid", "reviewer"],
    approvedBy: [],
    diff: [
      { type: "add", text: "Lead with run-cost savings, then the transition plan." },
      {
        type: "add",
        text: "Reference value: EUR 120,000 saved per year at a retail client, under NDA.",
      },
      { type: "add", text: "Contact for the story: sample.contact@example.invalid" },
    ],
    flags: [],
    twoPerson: { required: true, approvals: 0, needed: 2 },
    approve: okAction,
    requestChanges: okAction,
  },
  {
    id: "cand_4",
    nodeId: "a_acme",
    title: "Acme Synthetic SA: renewal risk summary",
    scopeLabel: "Acme Synthetic SA",
    plane: "ACCOUNT_RESTRICTED",
    author: "Consultant, Delivery",
    authorRole: "consultant",
    revision: "r3",
    previousRevision: "r2",
    submittedAt: "2026-11-01T11:05:00Z",
    visibleTo: ["acme_lead"],
    approvedBy: [],
    diff: [
      { type: "same", text: "Renewal window opens in Q1." },
      { type: "del", text: "Risk: key person dependency on the platform owner." },
      {
        type: "add",
        text: "Risk: key person dependency on the platform owner, mitigation agreed in the last steering.",
      },
    ],
    flags: [],
    twoPerson: { required: false, approvals: 0, needed: 1 },
    approve: okAction,
    requestChanges: okAction,
  },
];
for (const c of candidates) {
  c.flags = scanSensitive(
    c.diff
      .filter((d) => d.type !== "del")
      .map((d) => d.text)
      .join("\n"),
  ).map(({ kind, span, reason }) => ({ kind, span, reason }));
}

const activity: ActivityEntry[] = [
  {
    id: "act_1",
    title: "Response library: security questionnaire answers",
    scopeLabel: "Bid & Pre-sales",
    revision: "r7",
    at: "2026-11-03T10:00:00Z",
    nodeId: "t_c_bid_response_library",
  },
  {
    id: "act_2",
    title: "Kickoff checklist: week one",
    scopeLabel: "Delivery",
    revision: "r5",
    at: "2026-11-02T15:30:00Z",
    nodeId: "t_c_delivery_kickoff_checklist",
  },
  {
    id: "act_3",
    title: "Use case intake: scoring sheet",
    scopeLabel: "Strategy, Innovation & AI",
    revision: "r3",
    at: "2026-11-02T09:15:00Z",
    nodeId: "t_c_sia_ai_use_case_intake",
  },
];

function reviewFor(role: string): Candidate[] {
  return candidates
    .filter((c) => c.visibleTo.includes(role))
    .map((c) => {
      const self = c.authorRole === role;
      const dup = c.approvedBy.includes(role);
      const node = ORG.nodes.get(c.nodeId);
      const canReview = node ? canDo(role, node, "review").allowed : false;
      const out: Candidate = { ...c };
      out.approve = self
        ? { allowed: false, reason: "You contributed this revision. Self-approval is blocked." }
        : dup
          ? { allowed: false, reason: "You already approved this exact revision." }
          : canReview
            ? okAction
            : { allowed: false, reason: "Your role cannot approve in this scope." };
      out.requestChanges = self
        ? {
            allowed: false,
            reason: "You contributed this revision. Ask another reviewer to respond.",
          }
        : canReview
          ? okAction
          : { allowed: false, reason: "Your role cannot review in this scope." };
      return out;
    });
}

// ---- personal brain (in-memory, per role) ----
const personal = new Map<string, PersonalItem[]>();
function personalFor(role: string): PersonalItem[] {
  let list = personal.get(role);
  if (!list) {
    list = [
      {
        id: `p_${role}_1`,
        kind: "note",
        title: "Retail renewal talking points",
        updatedAt: "2026-11-03T18:20:00Z",
        body: "Lead with run-cost savings, then the transition plan.\nReference value: EUR 120,000 saved per year, under NDA.\nContact for the story: sample.contact@example.invalid",
      },
      {
        id: `p_${role}_2`,
        kind: "brief",
        title: "Monday brief (private)",
        updatedAt: "2026-11-02T07:45:00Z",
        body: "Three things for the week: close the pricing review, confirm the quality gate wording, draft the lessons note.",
      },
      {
        id: `p_${role}_3`,
        kind: "draft",
        title: "Lessons from the last handover",
        updatedAt: "2026-10-30T13:00:00Z",
        body: "What worked: a one-page runbook before go-live.\nWhat did not: sign-off by email after the demo.",
      },
    ];
    personal.set(role, list);
  }
  return list;
}

// ---- GenUI planner (deterministic, like the B1 rule-based planner) ----
function plan(body: { prompt?: string; nodeId?: string }): ViewPlan {
  const p = (body.prompt ?? "").toLowerCase();
  if (body.nodeId) {
    return {
      version: 1,
      title: "This node",
      components: [
        { type: "NodeCard", props: { nodeId: body.nodeId } },
        { type: "ItemList", props: { nodeId: body.nodeId, limit: 4 } },
      ],
    };
  }
  if (/acme|account|renewal/.test(p)) {
    return {
      version: 1,
      title: "Acme Synthetic SA",
      components: [
        { type: "AccountSummary", props: { accountId: "a_acme" } },
        { type: "ItemList", props: { nodeId: "a_acme", limit: 4 } },
        {
          type: "Callout",
          props: {
            tone: "info",
            text: "Contacts stay with the account team. This view shows structure and records you can already open.",
          },
        },
      ],
    };
  }
  if (/govern|use case|\bai\b|stage|pilot/.test(p)) {
    return {
      version: 1,
      title: "AI use cases by governance",
      components: [
        { type: "KpiRow", props: { lens: "governances" } },
        { type: "StageBoard", props: { governanceId: "g_sia" } },
        { type: "Table", props: { lens: "governances" } },
      ],
    };
  }
  if (/review|approve|waiting/.test(p)) {
    return {
      version: 1,
      title: "Waiting on you",
      components: [
        {
          type: "Callout",
          props: {
            tone: "attention",
            text: "Reviews open in the Review view. Approval applies to the exact revision you open.",
          },
        },
        { type: "Table", props: { lens: "departments" } },
      ],
    };
  }
  return {
    version: 1,
    title: "Company map at a glance",
    components: [
      { type: "KpiRow", props: { lens: "departments" } },
      { type: "MapMini", props: { lens: "departments" } },
      { type: "Hologram", props: { note: "Unknown types are dropped by the renderer." } },
      { type: "Table", props: { lens: "departments" } },
    ],
  };
}

function card(a: (typeof ACCOUNTS)[number], l: Leaf): AccountCard {
  return {
    id: a.id,
    name: a.name,
    country: a.country,
    region: REGIONS.find((r) => r[2].includes(a.country))?.[1] ?? "",
    sector: a.sector,
    status: a.status,
    aiProcessing: a.ai,
    openItems: l.open ? 1 + (hash(a.id) % 4) : 0,
    stars: l.star ? 1 + (hash(a.id) % 2) : 0,
    plane: l.plane,
  };
}

function accountDetail(role: string, id: string): AccountDetail {
  const a = ACCOUNTS.find((x) => x.id === id);
  const leaf = ORG.nodes.get(id);
  if (!a || !leaf || vis(role, leaf) === "hidden")
    throw new ApiError(404, "This account does not exist, or it is outside your scope.");
  if (vis(role, leaf) === "locked")
    throw new ApiError(403, "This workspace is under NDA. A named grant is needed.");
  const h = hash(id);
  const mk = (key: string, label: string, titles: string[], status: string[]) => ({
    key,
    label,
    items: titles.map((t, i) => ({
      id: `${id}/${key}/${i}`,
      title: t,
      status: pick(status, h >>> i),
      revision: `r${1 + ((h >>> (i + 3)) % 6)}`,
    })),
  });
  const sections = [
    mk(
      "overview",
      "Overview",
      ["Account plan 2027", "Stakeholder map", "Relationship health"],
      ["approved", "approved", "candidate"],
    ),
    mk(
      "engagements",
      "Engagements",
      ["Platform renewal", "Advisory retainer", "Run support"].slice(0, a.eng),
      ["active", "active", "renewal"],
    ),
    mk(
      "projects",
      "Projects",
      ["Migration wave 1", "Data foundation", "Reporting rebuild"],
      ["in progress", "in progress", "done"],
    ),
    mk(
      "decisions",
      "Decisions",
      ["Vendor shortlist", "Scope change", "Architecture choice"],
      ["open", "decided", "decided"],
    ),
    mk(
      "commitments",
      "Commitments & actions",
      ["Quarterly review actions", "SLA remediation plan", "Handover tasks"],
      ["open", "overdue", "done"],
    ),
    mk(
      "deliverables",
      "Deliverables",
      ["Target design", "Status pack", "Runbook set"],
      ["approved", "candidate", "approved"],
    ),
    {
      key: "outcomes",
      label: "Outcomes & stories",
      items: ["Cost reduction result", "Time to value story"].map((t, i) => ({
        id: `${id}/out/${i}`,
        title: t,
        status: "approved",
        revision: `r${i + 2}`,
        story: {
          internal: true,
          lesson: i === 0,
          external:
            a.perm && i === 0
              ? { available: true, reason: "Customer permission on file." }
              : { available: false, reason: "Locked: no customer permission recorded." },
        },
      })),
    },
    mk(
      "risks",
      "Risks",
      ["Key person dependency", "Budget freeze", "Contract renewal exposure"],
      ["open", "watch", "open"],
    ),
    mk(
      "meetings",
      "Meetings",
      ["Steering committee notes", "Quarterly business review"],
      ["captured", "captured"],
    ),
    {
      key: "contacts",
      label: "Contacts",
      items: ["Contact ref 01", "Contact ref 02"].map((t, i) => ({
        id: `${id}/con/${i}`,
        title: t,
        status: "members only",
        revision: "r1",
        note: "Opaque reference. Names stay in the source system.",
      })),
    },
  ];
  return {
    account: card(a, leaf),
    members:
      role === "acme_lead" || role === "ceo"
        ? ["Account lead role", "Delivery lead role", "Bid support role"]
        : null,
    sections,
  };
}

function govCard(role: string, id: string, label: string, group: "bl" | "cf"): GovernanceCard {
  const gl = ORG.nodes.get(id) as Leaf;
  const locked = vis(role, gl) === "locked";
  const stages = Object.fromEntries(STAGES.map((s) => [s, 0])) as GovernanceCard["stages"];
  const ucs = locked ? [] : (ORG.useCasesOfGov.get(id) ?? []);
  for (const u of ucs) if (u.stage) stages[u.stage] += 1;
  return {
    id,
    label,
    group: group === "bl" ? "Business line" : "Corporate function",
    useCases: ucs.length,
    stages,
  };
}

function me(role: string): Me {
  const r = ROLES[role] as (typeof ROLES)[string];
  const structureOnly = role === "platform_admin" || role === "auditor";
  const see = structureOnly
    ? [
        "Company structure: departments, governances, regions and circles",
        "Names and shapes only. Counts and content stay hidden.",
      ]
    : [
        "Company Global",
        ...r.grants
          .filter((g) => g.scope_type !== "global")
          .map((g) => {
            const name =
              g.scope_id === "*"
                ? `All ${g.scope_type}s`
                : (ORG.nodes.get(g.scope_id)?.label ?? g.scope_id);
            return `${name}: ${g.actions.includes("view_content") ? "structure and content" : "structure only"}`;
          }),
      ];
  const can = [
    ...new Set(r.grants.flatMap((g) => g.actions.filter((a) => !a.startsWith("view")))),
  ].map((a) => a.replace("_", " "));
  return {
    principal: { id: `u_${role}`, email: `${role}@example.invalid`, roleIds: [role] },
    persona: role,
    env: "dev",
    describe: {
      see,
      do: can.length ? can : ["Read only"],
      never: [...r.never, "Read anyone's Personal Brain"],
    },
    capabilities: {
      configure: role === "platform_admin",
      review: r.grants.some((g) => g.actions.includes("review")),
    },
  };
}

const rid = (s: string) => `rcpt_${String(hash(s) % 10000).padStart(4, "0")}`;

export async function handle(
  method: "GET" | "POST",
  path: string,
  body: unknown,
  persona: string | null,
): Promise<unknown> {
  await sleep(50);
  const role = roleOf(persona);
  const url = new URL(path, "http://mock.invalid");
  const p = url.pathname;
  const b = (body ?? {}) as Record<string, unknown>;

  if (method === "GET") {
    if (p === "/v1/health") return { ok: true, env: "dev", version: "mock" };
    if (p === "/v1/me") return me(role);
    if (p === "/v1/map")
      return buildMap(role, (url.searchParams.get("lens") ?? "departments") as Lens);
    if (p.startsWith("/v1/nodes/")) return nodeDetail(role, decodeURIComponent(p.slice(10)));
    if (p === "/v1/search") {
      const term = (url.searchParams.get("q") ?? "").toLowerCase().trim();
      if (!term) return { results: [] };
      const all = [...ORG.nodes.values()].filter(
        (n) => n.label.toLowerCase().includes(term) && vis(role, n) !== "hidden",
      );
      const rank = (n: Leaf) => (n.kind === "usecase" ? 1 : 0);
      return {
        results: all
          .sort((x, y) => rank(x) - rank(y))
          .slice(0, 12)
          .map((n) => ({ id: n.id, label: n.label, kind: n.kind, plane: n.plane })),
      };
    }
    if (p === "/v1/accounts") {
      return {
        accounts: ACCOUNTS.map((a) => ({ a, l: ORG.nodes.get(a.id) as Leaf }))
          .filter(({ l }) => vis(role, l) !== "hidden")
          .map(({ a, l }) => card(a, l)),
      };
    }
    if (p.startsWith("/v1/accounts/")) return accountDetail(role, decodeURIComponent(p.slice(13)));
    if (p === "/v1/governances") {
      return {
        governances: GOVERNANCES.map(([id, label, group]) => govCard(role, id, label, group)),
      };
    }
    if (p.startsWith("/v1/governances/")) {
      const id = decodeURIComponent(p.slice(16));
      const gdef = GOVERNANCES.find((x) => x[0] === id);
      const gl = ORG.nodes.get(id);
      if (!gdef || !gl) throw new ApiError(404, "Unknown governance.");
      if (vis(role, gl) === "locked")
        throw new ApiError(403, "This governance is locked for your role.");
      return {
        governance: govCard(role, id, gdef[1], gdef[2]),
        useCases: (ORG.useCasesOfGov.get(id) ?? []).map((u) => ({
          id: u.id,
          title: u.label,
          stage: u.stage,
          evidence: u.evidence,
        })),
      };
    }
    if (p === "/v1/review") return { candidates: reviewFor(role) };
    if (p === "/v1/activity") return { entries: activity.slice(0, 4) };
    if (p === "/v1/personal/items") {
      return {
        items: [...personalFor(role)].sort((x, y) => y.updatedAt.localeCompare(x.updatedAt)),
      };
    }
    if (p === "/v1/admin/roles") {
      if (role !== "platform_admin") throw new ApiError(403, "Admin needs the configure grant.");
      return { structureOnly: true, roles: Object.values(ROLES) };
    }
    if (p === "/v1/admin/audit") {
      if (role !== "platform_admin") throw new ApiError(403, "Admin needs the configure grant.");
      return {
        receipts: [
          {
            id: "rcpt_0412",
            at: "2026-11-04T09:12:00Z",
            actor: "Knowledge reviewer",
            action: "approve_release",
            scope: "c_bid",
            result: "ok",
          },
          {
            id: "rcpt_0411",
            at: "2026-11-04T08:40:00Z",
            actor: "Head of Bid & Pre-sales",
            action: "approve_release",
            scope: "c_bid",
            result: "denied: self-approval",
          },
          {
            id: "rcpt_0410",
            at: "2026-11-03T17:02:00Z",
            actor: "Consultant, Delivery",
            action: "contribute",
            scope: "c_delivery",
            result: "ok",
          },
          {
            id: "rcpt_0409",
            at: "2026-11-03T15:21:00Z",
            actor: "CEO",
            action: "view_content",
            scope: "a_calypso",
            result: "denied: NDA grant needed",
          },
          {
            id: "rcpt_0408",
            at: "2026-11-03T10:00:00Z",
            actor: "Platform admin",
            action: "configure",
            scope: "policy",
            result: "ok",
          },
        ],
      };
    }
    throw new ApiError(404, `No mock for GET ${p}`);
  }

  if (p === "/v1/actions") {
    const nodeId = String(b.nodeId ?? "");
    const action = String(b.action ?? "") as NodeAction["action"];
    const cand = candidates.find((c) => c.nodeId === nodeId && c.visibleTo.includes(role));
    if (cand && (action === "approve_release" || action === "review")) {
      const view = reviewFor(role).find((c) => c.id === cand.id) as Candidate;
      const payload = (b.payload as { decision?: string; comment?: string } | undefined) ?? {};
      if (action === "approve_release") {
        if (b.revision !== cand.revision) {
          throw new ApiError(
            409,
            `Revision changed. You approved ${String(b.revision)}, current is ${cand.revision}. Reopen it.`,
          );
        }
        if (!view.approve.allowed) throw new ApiError(403, view.approve.reason);
        cand.approvedBy.push(role);
        cand.twoPerson.approvals += 1;
        if (cand.twoPerson.approvals >= cand.twoPerson.needed) {
          candidates.splice(candidates.indexOf(cand), 1);
          activity.unshift({
            id: `act_${Date.now()}`,
            title: cand.title,
            scopeLabel: cand.scopeLabel,
            revision: cand.revision,
            at: new Date().toISOString(),
            nodeId: cand.nodeId,
          });
        }
        return { ok: true, receiptId: rid(`${cand.id}${role}${cand.twoPerson.approvals}`) };
      }
      if (payload.decision === "request_changes") {
        if (!view.requestChanges.allowed) throw new ApiError(403, view.requestChanges.reason);
        if (!payload.comment?.trim())
          throw new ApiError(422, "Say what needs to change. The author sees this text.");
        candidates.splice(candidates.indexOf(cand), 1);
        return { ok: true, receiptId: rid(`${cand.id}rc`) };
      }
    }
    const node = ORG.nodes.get(nodeId);
    if (!node) throw new ApiError(404, "Unknown record.");
    if (action === "request_access") return { ok: true, receiptId: rid(nodeId + role) };
    const r = canDo(role, node, action);
    if (!r.allowed) throw new ApiError(403, r.reason);
    return { ok: true, receiptId: rid(nodeId + action + role) };
  }

  if (p === "/v1/personal/items") {
    const list = personalFor(role);
    const id = typeof b.id === "string" ? b.id : null;
    const now = new Date().toISOString();
    const title = String(b.title ?? "").trim() || "Untitled";
    const kind = (
      ["note", "brief", "view", "draft"].includes(String(b.kind)) ? b.kind : "note"
    ) as PersonalItem["kind"];
    const found = id ? list.find((i) => i.id === id) : undefined;
    if (found) {
      found.title = title;
      found.body = String(b.body ?? "");
      found.kind = kind;
      found.updatedAt = now;
      return { item: { ...found } };
    }
    const item: PersonalItem = {
      id: `p_${role}_${Date.now()}`,
      title,
      body: String(b.body ?? ""),
      kind,
      updatedAt: now,
    };
    list.push(item);
    return { item: { ...item } };
  }

  const m = p.match(/^\/v1\/personal\/items\/([^/]+)\/contribute$/);
  if (m) {
    const item = personalFor(role).find((i) => i.id === decodeURIComponent(m[1] as string));
    if (!item) throw new ApiError(404, "Not found. Only the owner can contribute a personal item.");
    const target = ORG.nodes.get(String(b.targetScopeId ?? ""));
    if (!target || vis(role, target) !== "full")
      throw new ApiError(403, "You cannot contribute to that scope.");
    const can = canDo(role, target, "contribute");
    if (!can.allowed) throw new ApiError(403, can.reason);
    const cid = `cand_p${candidates.length + 1}`;
    candidates.push({
      id: cid,
      nodeId: target.id,
      title: `${item.title} (from My Secondary)`,
      scopeLabel: target.label,
      plane: target.plane,
      author: roleLabel(role),
      authorRole: role,
      revision: "r1",
      previousRevision: null,
      submittedAt: new Date().toISOString(),
      visibleTo: ["reviewer", "head_bid"].filter((r) => r !== role),
      approvedBy: [],
      diff: item.body.split("\n").map((text) => ({ type: "add" as const, text })),
      flags: scanSensitive(item.body).map(({ kind, span, reason }) => ({ kind, span, reason })),
      twoPerson: { required: true, approvals: 0, needed: 2 },
      approve: okAction,
      requestChanges: okAction,
    });
    item.contributedTo = [
      ...(item.contributedTo ?? []),
      { scopeId: target.id, candidateId: cid, at: new Date().toISOString() },
    ];
    return { ok: true, candidateId: cid, receiptId: rid(cid) };
  }

  if (p === "/v1/genui/plan") return plan(b as { prompt?: string; nodeId?: string });
  throw new ApiError(404, `No mock for POST ${p}`);
}
