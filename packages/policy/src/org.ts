// Synthetic organisation, deterministic for a given seed. No I/O, no clock, no randomness.
// Structure and counts follow the real Mantu structure (5 business lines, 7 corporate
// functions, 12 governances with 433 use cases, 4 regions with 28 countries). Accounts,
// items, titles and people are fictional.

import { buildPersonalBrain } from "./personal.ts";
import { PERSONAS, TENANT_ID } from "./personas.ts";
import { ROLES } from "./roles.ts";
import { type Hasher, pick, type SynthOptions, seeded, slug, synthLeaf } from "./seed.ts";
import type { LeafData, NodeKind, Org, OrgLink, OrgNode, Plane, Role, ScopeRef } from "./types.ts";

export const DEFAULT_SEED = 20261104;
export const GROUP_LABEL = { bl: "Business lines", cf: "Corporate functions" } as const;
export const STAGES = ["Discover", "In design", "Building", "Piloting", "Deployed"] as const;
const STAGE_SHARE = [0.3, 0.25, 0.15, 0.15, 0.15];

type Group = "bl" | "cf";

/** Governances: [id, label, group, use case count]. Counts are real and sum to 433. */
export const GOVERNANCES: readonly [string, string, Group, number][] = [
  ["g_lbc", "LittleBig Connection", "bl", 92],
  ["g_eleven", "Eleven VMS", "bl", 88],
  ["g_hr", "HR, Legal and Hub Operations", "cf", 62],
  ["g_amaris", "Amaris", "bl", 55],
  ["g_af", "A&F", "cf", 40],
  ["g_it", "IT", "cf", 24],
  ["g_perf", "Performance", "cf", 19],
  ["g_recruit", "Recruitment", "bl", 19],
  ["g_mkt", "Marketing & Communication", "cf", 12],
  ["g_sia", "Strategy, Innovation & AI", "cf", 10],
  ["g_sus", "Sustainability", "cf", 8],
  ["g_ci", "Creative Intelligence", "bl", 4],
];

/** [id, label, group, circles: [id, label, restricted, topics]] */
const DEPARTMENTS: readonly [string, string, Group, [string, string, 0 | 1, string[]][]][] = [
  [
    "d_amaris",
    "Amaris",
    "bl",
    [
      [
        "c_sales",
        "Sales & Accounts",
        0,
        ["Account planning", "Renewal motions", "Win and loss reviews", "Stakeholder maps"],
      ],
      [
        "c_bid",
        "Bid & Pre-sales",
        0,
        [
          "Response library",
          "Pricing models",
          "Win themes",
          "Go or no-go criteria",
          "Red team method",
        ],
      ],
      [
        "c_delivery",
        "Delivery",
        0,
        ["Kickoff checklist", "Status reporting", "Quality gates", "Close-out method"],
      ],
      [
        "c_eng",
        "Engineering Practices",
        0,
        ["Code review norms", "Test strategy", "Release runbooks"],
      ],
      [
        "c_escal",
        "Delivery Escalations",
        1,
        ["Escalation paths", "Recovery plans", "Client health signals"],
      ],
    ],
  ],
  [
    "d_lbc",
    "LittleBig Connection",
    "bl",
    [
      [
        "c_lbc_prog",
        "Programme Delivery",
        0,
        ["Programme cadence", "Risk registers", "Stakeholder reporting"],
      ],
      [
        "c_lbc_cx",
        "Client Experience",
        0,
        ["Onboarding journeys", "Service reviews", "Feedback loops"],
      ],
    ],
  ],
  [
    "d_eleven",
    "Eleven VMS",
    "bl",
    [
      [
        "c_ev_ops",
        "Platform Operations",
        0,
        ["Vendor onboarding", "Spend controls", "Invoice flows"],
      ],
      [
        "c_ev_net",
        "Supplier Network",
        0,
        ["Supplier scoring", "Compliance packs", "Rate benchmarks"],
      ],
    ],
  ],
  [
    "d_recruit",
    "Recruitment",
    "bl",
    [
      ["c_rc_src", "Sourcing", 0, ["Talent pools", "Search playbooks", "Outreach cadences"]],
      [
        "c_rc_plc",
        "Placement Quality",
        0,
        ["Interview guides", "Offer handling", "Retention signals"],
      ],
    ],
  ],
  [
    "d_ci",
    "Creative Intelligence",
    "bl",
    [
      ["c_ci_studio", "Studio", 0, ["Concept method", "Storyboard kit", "Review rituals"]],
      ["c_ci_lab", "Insight Lab", 0, ["Research synthesis", "Trend briefs", "Audience models"]],
    ],
  ],
  [
    "d_hr",
    "HR, Legal and Hub Operations",
    "cf",
    [
      [
        "c_hr_pp",
        "People Partners",
        1,
        ["Case handling method", "Calibration process", "Policy exceptions"],
      ],
      [
        "c_hr_legal",
        "Legal & Contracts",
        0,
        ["Clause library", "NDA handling", "Data protection terms"],
      ],
      [
        "c_hr_hub",
        "Hub Operations",
        0,
        ["Onboarding checklist", "Mobility rules", "Workplace standards"],
      ],
    ],
  ],
  [
    "d_af",
    "A&F",
    "cf",
    [
      [
        "c_af_close",
        "Controls & Close",
        0,
        ["Month-end close", "Expense policy", "Revenue recognition"],
      ],
      [
        "c_af_price",
        "Pricing & Margin",
        0,
        ["Rate cards", "Margin decomposition", "Invoicing rules"],
      ],
    ],
  ],
  [
    "d_it",
    "IT",
    "cf",
    [
      [
        "c_it_sec",
        "Security Operations",
        0,
        ["Alert triage", "Vulnerability handling", "Access reviews"],
      ],
      [
        "c_it_wp",
        "Workplace Technology",
        0,
        ["Device onboarding", "Software catalogue", "Offboarding checklist"],
      ],
    ],
  ],
  [
    "d_perf",
    "Performance",
    "cf",
    [
      ["c_pf_util", "Utilisation", 0, ["Utilisation targets", "Bench handling", "Staffing rules"]],
      ["c_pf_q", "Quality", 0, ["Quality reviews", "Client health checks", "Lessons registers"]],
    ],
  ],
  [
    "d_mkt",
    "Marketing & Communication",
    "cf",
    [
      ["c_mk_brand", "Brand & Content", 0, ["Brand voice", "Case study kit", "Thought leadership"]],
      [
        "c_mk_dem",
        "Demand Generation",
        0,
        ["Campaign playbooks", "Lead scoring", "Event follow-up"],
      ],
    ],
  ],
  [
    "d_sia",
    "Strategy, Innovation & AI",
    "cf",
    [
      [
        "c_sia_ai",
        "AI Programme",
        0,
        ["Use case intake", "Prioritisation scoring", "Value tracking", "Model risk checks"],
      ],
      [
        "c_sia_str",
        "Strategy Office",
        0,
        ["Portfolio reviews", "Market scans", "Investment cases"],
      ],
    ],
  ],
  [
    "d_sus",
    "Sustainability",
    "cf",
    [
      ["c_su_rep", "Reporting", 0, ["Emissions method", "Disclosure calendar", "Supplier data"]],
      ["c_su_ini", "Initiatives", 0, ["Programme catalogue", "Client offers", "Impact stories"]],
    ],
  ],
];

const CORE_TOPICS = [
  "Mission and values",
  "Operating model",
  "Code of conduct",
  "Security basics",
  "Glossary",
  "Org chart",
  "Brand principles",
  "Travel policy",
  "Tooling map",
  "Client engagement principles",
  "Quality policy",
  "AI usage policy",
  "Onboarding handbook",
  "Information classification",
];

/** [id, label, [[deptId, items]]] */
const THEMES: readonly [string, string, [string, string[]][]][] = [
  [
    "th_methods",
    "Methods",
    [
      ["d_amaris", ["Estimation method", "Red team method"]],
      ["d_lbc", ["Programme cadence"]],
      ["d_sia", ["Evaluation method"]],
    ],
  ],
  [
    "th_pricing",
    "Pricing",
    [
      ["d_amaris", ["Pricing models", "Discount ranges"]],
      ["d_af", ["Rate cards", "Margin decomposition"]],
    ],
  ],
  [
    "th_ai",
    "AI use cases",
    [
      ["d_sia", ["Use case intake", "Value tracking"]],
      ["d_eleven", ["Invoice flow automation"]],
      ["d_it", ["Tool governance"]],
    ],
  ],
  [
    "th_lessons",
    "Lessons learned",
    [
      ["d_amaris", ["Win and loss reviews"]],
      ["d_perf", ["Lessons registers", "Close-out method"]],
      ["d_ci", ["Review rituals"]],
    ],
  ],
  [
    "th_risk",
    "Risk and compliance",
    [
      ["d_it", ["Access reviews", "Incident comms"]],
      ["d_hr", ["Data protection terms"]],
      ["d_af", ["Revenue recognition"]],
    ],
  ],
  [
    "th_ways",
    "Ways of working",
    [
      ["d_hr", ["Onboarding checklist"]],
      ["d_mkt", ["Brand voice"]],
      ["d_sus", ["Disclosure calendar"]],
    ],
  ],
];

const REGIONS: readonly [string, string, string[]][] = [
  [
    "r_eu",
    "Europe",
    [
      "France",
      "Spain",
      "Italy",
      "Switzerland",
      "Belgium",
      "Turkey",
      "Portugal",
      "Netherlands",
      "Serbia",
      "Poland",
      "Luxembourg",
      "Austria",
      "Czech Republic",
      "Sweden",
    ],
  ],
  ["r_am", "Americas", ["Colombia", "Brazil", "Chile", "Canada", "Peru", "Mexico"]],
  ["r_af", "Africa & Middle East", ["Tunisia", "Ivory Coast", "South Africa"]],
  ["r_ap", "APAC", ["Vietnam", "China", "Japan", "Thailand", "Singapore"]],
];

/**
 * Short names clients are called by (all synthetic: the initials of each fictional name). Anything that
 * must not carry a client name into another brain matches these as well as the full label, on word
 * boundaries, ignoring case and accents.
 */
export const CLIENT_ALIASES: Readonly<Record<string, readonly string[]>> = {
  a_acme: ["ASA"],
  a_ember: ["ESS"],
  a_quartz: ["QPS"],
  a_lumen: ["LFS"],
  a_solana: ["SDS"],
  a_ibero: ["IMS"],
  a_calypso: ["CDS"],
  a_alpen: ["ASA"],
  a_flandre: ["FFN"],
  a_kappa: ["KDS"],
  a_andes: ["AFS"],
  a_delta: ["DML"],
  a_jaguar: ["JSS"],
  a_pacifico: ["PES"],
  a_borealis: ["BFI"],
  a_cedar: ["CMC"],
  a_azteca: ["APS"],
  a_lotus: ["LPJ"],
  a_mekong: ["MSC"],
  a_merlion: ["MDP"],
  a_carthage: ["CMS"],
};

interface AcctOpts {
  bid?: 1;
  nda?: 1;
  eng: number;
  ai: string;
  perm?: 1;
}
/** [id, label, country, sector, status, opts]. All fictional. */
const ACCOUNTS: readonly [string, string, string, string, string, AcctOpts][] = [
  [
    "a_acme",
    "Acme Synthetic SA",
    "France",
    "Retail",
    "Active",
    { bid: 1, eng: 3, ai: "allowed", perm: 1 },
  ],
  ["a_ember", "Ember Sample SAS", "France", "Energy", "Renewal", { eng: 2, ai: "unknown" }],
  ["a_quartz", "Quartz Placeholder SA", "France", "Banking", "Active", { eng: 2, ai: "allowed" }],
  ["a_lumen", "Lumen Fictive SAS", "France", "Telecom", "Paused", { eng: 1, ai: "not allowed" }],
  ["a_solana", "Solana Demo SL", "Spain", "Retail", "Active", { eng: 2, ai: "allowed", perm: 1 }],
  [
    "a_ibero",
    "Ibero Mock SA",
    "Spain",
    "Insurance",
    "Onboarding",
    { bid: 1, eng: 1, ai: "unknown" },
  ],
  [
    "a_calypso",
    "Calypso Demo Srl",
    "Italy",
    "Manufacturing",
    "Active",
    { nda: 1, eng: 2, ai: "unknown" },
  ],
  ["a_alpen", "Alpen Sample AG", "Switzerland", "Banking", "Active", { eng: 2, ai: "not allowed" }],
  [
    "a_flandre",
    "Flandre Fictive NV",
    "Belgium",
    "Logistics",
    "Renewal",
    { bid: 1, eng: 1, ai: "allowed" },
  ],
  [
    "a_kappa",
    "Kappa Demo SAS",
    "Colombia",
    "Banking",
    "Active",
    { eng: 2, ai: "allowed", perm: 1 },
  ],
  [
    "a_andes",
    "Andes Fictive SAS",
    "Colombia",
    "Energy",
    "Onboarding",
    { bid: 1, eng: 1, ai: "unknown" },
  ],
  ["a_delta", "Delta Mock Ltda", "Brazil", "Telecom", "Active", { eng: 2, ai: "allowed" }],
  ["a_jaguar", "Jaguar Sample SA", "Brazil", "Mining", "Renewal", { eng: 1, ai: "unknown" }],
  ["a_pacifico", "Pacifico Example SpA", "Chile", "Mining", "Active", { eng: 1, ai: "allowed" }],
  [
    "a_borealis",
    "Borealis Fictive Inc",
    "Canada",
    "Banking",
    "Active",
    { eng: 3, ai: "allowed", perm: 1 },
  ],
  [
    "a_cedar",
    "Cedar Mock Corp",
    "Canada",
    "Public sector",
    "Active",
    { bid: 1, eng: 1, ai: "not allowed" },
  ],
  ["a_azteca", "Azteca Placeholder SA", "Mexico", "Retail", "Active", { eng: 1, ai: "unknown" }],
  [
    "a_lotus",
    "Lotus Placeholder JSC",
    "Vietnam",
    "Manufacturing",
    "Active",
    { eng: 2, ai: "allowed" },
  ],
  ["a_mekong", "Mekong Sample Co", "Vietnam", "Retail", "Active", { eng: 1, ai: "unknown" }],
  ["a_merlion", "Merlion Demo Pte", "Singapore", "Insurance", "Renewal", { eng: 1, ai: "allowed" }],
  ["a_carthage", "Carthage Mock SARL", "Tunisia", "Telecom", "Active", { eng: 1, ai: "allowed" }],
];

/** Contributions awaiting release: node id to the principal who contributed it. */
const PENDING: Record<string, string> = {
  "c_bid:pricing-models": PERSONAS.head_bid.id,
  "c_delivery:quality-gates": PERSONAS.consultant.id,
};

const UC_TITLES = [
  "Invoice triage",
  "Clause extraction",
  "Candidate shortlisting",
  "Ticket routing",
  "Forecast narrative",
  "Proposal first draft",
  "Meeting minutes",
  "Knowledge search",
  "Compliance check",
  "Timesheet anomalies",
  "Onboarding assistant",
  "Quality review",
  "Skills matching",
  "Report summariser",
  "Policy Q&A",
];

const BRANCHES: readonly [string, string, string, string[]][] = [
  [
    "eng",
    "Engagements",
    "Engagement",
    ["Platform renewal", "Advisory retainer", "Run support", "Transformation programme"],
  ],
  [
    "prj",
    "Projects",
    "Project",
    ["Migration wave 1", "Data foundation", "Service desk redesign", "Reporting rebuild"],
  ],
  [
    "dec",
    "Decisions",
    "Decision",
    ["Vendor shortlist", "Scope change", "Architecture choice", "Pricing position"],
  ],
  [
    "com",
    "Commitments & actions",
    "Commitment",
    ["Quarterly review actions", "SLA remediation plan", "Training commitments", "Handover tasks"],
  ],
  [
    "del",
    "Deliverables",
    "Deliverable",
    ["Target design", "Status pack", "Runbook set", "Business case"],
  ],
  [
    "out",
    "Outcomes & success stories",
    "Success story",
    ["Cost reduction result", "Adoption milestone", "Time to value story"],
  ],
  [
    "risk",
    "Risks",
    "Risk",
    ["Key person dependency", "Budget freeze", "Integration delay", "Contract renewal exposure"],
  ],
];

const GLOBAL: Plane = "GLOBAL_NONPERSONAL";
const TEAM: Plane = "TEAM_RESTRICTED";
const ACCT: Plane = "ACCOUNT_RESTRICTED";

export interface BuildOrgOptions {
  seed?: number;
  roles?: Readonly<Record<string, Role>>;
  /** Principal ids that own a Personal Brain. Defaults to the seven personas. */
  personalOwners?: string[];
}

const leafFacts = (l: LeafData): Record<string, string> => ({
  Type: l.type,
  Status: l.status,
  "Owner role": l.ownerRole,
  Revision: String(l.revision),
  Lineage: l.lineage,
});

export function buildOrg(opts: BuildOrgOptions = {}): Org {
  const seed = opts.seed ?? DEFAULT_SEED;
  const h: Hasher = seeded(seed);
  const nodes = new Map<string, OrgNode>();
  const roots: string[] = [];
  const links: OrgLink[] = [];

  type NewNode = ScopeRef & {
    id: string;
    label: string;
    kind: NodeKind;
    plane: Plane;
    parent?: string;
    group?: Group;
    facts?: Record<string, string>;
    leaf?: LeafData;
  };
  const add = ({ parent, facts, leaf, ...n }: NewNode): OrgNode => {
    if (nodes.has(n.id)) throw new Error(`duplicate node id ${n.id}`);
    const node: OrgNode = {
      ...n,
      parentId: parent ?? null,
      childIds: [],
      facts: leaf ? { ...leafFacts(leaf), ...facts } : (facts ?? {}),
      leaf: leaf ?? null,
    };
    nodes.set(node.id, node);
    if (parent) (nodes.get(parent) as OrgNode).childIds.push(node.id);
    else roots.push(node.id);
    return node;
  };

  // Company Global
  add({ id: "core", label: "Company Global", kind: "core", plane: GLOBAL });
  for (const t of CORE_TOPICS) {
    const id = `core:${slug(t)}`;
    add({
      id,
      label: t,
      kind: "coretopic",
      plane: GLOBAL,
      parent: "core",
      leaf: synthLeaf(h, id, t, {
        plane: GLOBAL,
        group: "Company Global",
        fresh: true,
        status: "approved",
        star: false,
      }),
    });
  }

  // Departments > circles > topics
  for (const [did, dlabel, group, circles] of DEPARTMENTS) {
    add({
      id: did,
      label: dlabel,
      kind: "department",
      plane: TEAM,
      dept: did,
      group,
      facts: { Group: GROUP_LABEL[group] },
    });
    for (const [cid, clabel, restr, topics] of circles) {
      add({
        id: cid,
        label: clabel,
        kind: "circle",
        plane: TEAM,
        parent: did,
        dept: did,
        circle: cid,
        restricted: !!restr,
        facts: { Department: dlabel, Restricted: restr ? "Yes" : "No" },
      });
      for (const t of topics) {
        const id = `${cid}:${slug(t)}`;
        const authorId = PENDING[id] ?? null;
        add({
          id,
          label: t,
          kind: "topic",
          plane: TEAM,
          parent: cid,
          dept: did,
          circle: cid,
          restricted: !!restr,
          leaf: synthLeaf(h, id, t, {
            plane: TEAM,
            group: clabel,
            authorId,
            ...(authorId ? { status: "candidate" } : {}),
          }),
        });
      }
    }
  }

  // Themes > department slices > items
  for (const [tid, tlabel, slices] of THEMES) {
    add({ id: tid, label: tlabel, kind: "theme", plane: GLOBAL });
    for (const [did, items] of slices) {
      const dept = DEPARTMENTS.find((d) => d[0] === did);
      if (!dept) throw new Error(`unknown department ${did}`);
      const sid = `${tid}:${did}`;
      add({ id: sid, label: dept[1], kind: "themedept", plane: GLOBAL, parent: tid });
      for (const t of items) {
        const id = `${sid}:${slug(t)}`;
        add({
          id,
          label: t,
          kind: "themeitem",
          plane: GLOBAL,
          parent: sid,
          leaf: synthLeaf(h, id, t, {
            plane: GLOBAL,
            group: "Company Global",
            fresh: true,
            status: "approved",
            star: false,
          }),
        });
      }
    }
  }

  // Governances > maturity clusters > use cases
  for (const [gid, glabel, group, n] of GOVERNANCES) {
    add({
      id: gid,
      label: glabel,
      kind: "governance",
      plane: GLOBAL,
      group,
      facts: { Group: GROUP_LABEL[group] },
    });
    const cnt = STAGE_SHARE.map((s) => Math.floor(n * s));
    cnt[0] = (cnt[0] as number) + n - cnt.reduce((a, b) => a + b, 0);
    const seq: number[] = [];
    cnt.forEach((c, si) => {
      for (let k = 0; k < c; k++) seq.push(si);
    });
    const shuffled = seq
      .map((st, i) => ({ st, k: h(`${gid}#${i}`) }))
      .sort((x, y) => x.k - y.k)
      .map((x) => x.st);
    const abbr = gid.replace("g_", "").toUpperCase();
    const ucs = shuffled.map((st, i) => {
      const code = `UC-${abbr}-${String(i + 1).padStart(2, "0")}`;
      return { st, code, id: `${gid}:${slug(code)}` };
    });
    const firstDeployed = gid === "g_lbc" ? ucs.find((u) => u.st === 4) : undefined;
    STAGES.forEach((stage, si) => {
      const inStage = ucs.filter((u) => u.st === si);
      if (!inStage.length) return;
      const cid = `${gid}:c:${slug(stage)}`;
      add({
        id: cid,
        label: stage,
        kind: "cluster",
        plane: GLOBAL,
        parent: gid,
        facts: { Stage: stage, Governance: glabel },
      });
      for (const u of inStage) {
        const label = `${pick(UC_TITLES, h(u.id) >>> 3)} (${u.code}, synthetic)`;
        const leaf = synthLeaf(h, u.id, label, {
          plane: GLOBAL,
          group: glabel,
          type: "Use case",
          star: false,
          status: stage,
        });
        leaf.stage = si;
        if (u === firstDeployed) {
          leaf.note = "Deployed in Brazil, replication in design";
          leaf.tags = [...leaf.tags, "replication"];
        }
        add({
          id: u.id,
          label,
          kind: "usecase",
          plane: GLOBAL,
          parent: cid,
          leaf,
          facts: { Stage: stage },
        });
      }
    });
    if (firstDeployed) {
      links.push({
        from: "k_brazil",
        to: "k_colombia",
        kind: "replication",
        label: "Deployed in Brazil, replication in design",
        via: firstDeployed.id,
      });
    }
  }

  // Regions > countries > accounts
  for (const [rid, rlabel, countries] of REGIONS) {
    add({ id: rid, label: rlabel, kind: "region", plane: ACCT, region: rid });
    for (const country of countries) {
      const kid = `k_${slug(country).replace(/-/g, "_")}`;
      add({
        id: kid,
        label: country,
        kind: "country",
        plane: ACCT,
        parent: rid,
        region: rid,
        facts: { Region: rlabel },
      });
      for (const [aid, alabel, , sector, status, o] of ACCOUNTS.filter((a) => a[2] === country)) {
        addAccount(aid, alabel, country, sector, status, o, rid, kid);
      }
    }
  }

  function addAccount(
    aid: string,
    alabel: string,
    country: string,
    sector: string,
    status: string,
    o: AcctOpts,
    rid: string,
    kid: string,
  ): void {
    const base: ScopeRef = { account: aid, region: rid, nda: !!o.nda, bid: !!o.bid };
    add({
      ...base,
      id: aid,
      label: alabel,
      kind: "account",
      plane: ACCT,
      parent: kid,
      facts: {
        Country: country,
        Sector: sector,
        Status: status,
        "AI use with client": o.ai,
        "Customer permission": o.perm ? "Yes" : "No",
      },
    });
    const leaf = (id: string, label: string, extra: Partial<SynthOptions>): LeafData =>
      synthLeaf(h, id, label, {
        plane: ACCT,
        group: "Account team",
        sector,
        perm: !!o.perm,
        ...extra,
      });

    for (const [k, blabel, ty, pool] of BRANCHES) {
      const bid = `${aid}:${k}`;
      const hh = h(bid);
      add({ ...base, id: bid, label: blabel, kind: "branch", plane: ACCT, parent: aid });
      const n = k === "eng" ? o.eng : 2 + (hh % 2);
      for (let i = 0; i < n; i++) {
        const id = `${bid}:${i}`;
        const label = pick(pool, hh + i);
        add({
          ...base,
          id,
          label,
          kind: "accleaf",
          plane: ACCT,
          parent: bid,
          leaf: leaf(id, label, {
            type: ty,
            star: k === "out",
            fresh: k === "out",
            ...(k === "dec" || k === "com" || k === "risk" ? {} : { open: false }),
          }),
        });
      }
    }
    // Contacts subspace: references only, members of the account only.
    const cid = `${aid}:con`;
    add({
      ...base,
      id: cid,
      label: "Contacts",
      kind: "branch",
      plane: ACCT,
      parent: aid,
      contacts: true,
      restricted: true,
    });
    for (let i = 0; i < 3; i++) {
      const id = `${cid}:${i}`;
      const label = `CT-${1000 + (h(aid + i) % 9000)}`;
      add({
        ...base,
        id,
        label,
        kind: "accleaf",
        plane: ACCT,
        parent: cid,
        contacts: true,
        restricted: true,
        leaf: leaf(id, label, {
          type: "Contact ref",
          status: "approved",
          fresh: true,
          star: false,
          open: false,
        }),
      });
    }
    for (let i = 0; i < 2 + (h(aid) % 2); i++) {
      const id = `${aid}:m${i}`;
      const label = `Meeting M-${200 + (h(`${aid}m${i}`) % 700)}`;
      add({
        ...base,
        id,
        label,
        kind: "meeting",
        plane: ACCT,
        parent: aid,
        leaf: leaf(id, label, { type: "Meeting", star: false, open: false, fresh: true }),
      });
    }
    if (o.bid) {
      for (let i = 0; i < 1 + (h(aid) % 2); i++) {
        const id = `${aid}:b${i}`;
        const label = `Bid BID-26-${String(10 + (h(`${aid}b${i}`) % 80))}`;
        add({
          ...base,
          id,
          label,
          kind: "bid",
          plane: ACCT,
          parent: aid,
          leaf: leaf(id, label, { type: "Bid", star: false, fresh: true }),
        });
      }
    }
    add({
      ...base,
      id: `${aid}:sector`,
      label: `Sector: ${sector}`,
      kind: "sector",
      plane: ACCT,
      parent: aid,
      facts: { Sector: sector },
    });
  }

  // Personal Brains: one per owner, outside every company scope.
  for (const ownerId of opts.personalOwners ?? Object.values(PERSONAS).map((p) => p.id)) {
    for (const n of buildPersonalBrain(h, ownerId)) {
      add({ ...n, parent: n.parentId ?? undefined, leaf: n.leaf ?? undefined });
    }
  }

  return {
    tenantId: TENANT_ID,
    seed,
    nodes,
    roots,
    links,
    roles: new Map(Object.entries(opts.roles ?? ROLES)),
  };
}
