// Synthetic org used only by the dev mock adapter. Department, governance and region names follow
// the real Mantu structure (docs/API-CONTRACT.md). Accounts are fictional.
import type { Plane, Stage } from "../types";

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
const pick = <T>(arr: readonly T[], h: number): T => arr[h % arr.length] as T;
export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

export const GOVERNANCES: [id: string, label: string, group: "bl" | "cf", n: number][] = [
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

type CircleSrc = [id: string, label: string, restricted: 0 | 1, topics: string[]];
export const DEPARTMENTS: [id: string, label: string, group: "bl" | "cf", circles: CircleSrc[]][] =
  [
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
        [
          "c_pf_util",
          "Utilisation",
          0,
          ["Utilisation targets", "Bench handling", "Staffing rules"],
        ],
        ["c_pf_q", "Quality", 0, ["Quality reviews", "Client health checks", "Lessons registers"]],
      ],
    ],
    [
      "d_mkt",
      "Marketing & Communication",
      "cf",
      [
        [
          "c_mk_brand",
          "Brand & Content",
          0,
          ["Brand voice", "Case study kit", "Thought leadership"],
        ],
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

export const THEMES: [id: string, label: string, items: string[]][] = [
  [
    "th_methods",
    "Methods",
    ["Estimation method", "Red team method", "Programme cadence", "Evaluation method"],
  ],
  [
    "th_pricing",
    "Pricing",
    ["Pricing models", "Discount ranges", "Rate cards", "Margin decomposition"],
  ],
  [
    "th_ai",
    "AI use cases",
    ["Use case intake", "Value tracking", "Invoice flow automation", "Tool governance"],
  ],
  [
    "th_lessons",
    "Lessons learned",
    ["Win and loss reviews", "Lessons registers", "Close-out method", "Review rituals"],
  ],
  [
    "th_risk",
    "Risk and compliance",
    ["Access reviews", "Incident comms", "Data protection terms", "Revenue recognition"],
  ],
  ["th_ways", "Ways of working", ["Onboarding checklist", "Brand voice", "Disclosure calendar"]],
];

export const REGIONS: [id: string, label: string, countries: string[]][] = [
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

export interface AcctSrc {
  id: string;
  name: string;
  country: string;
  sector: string;
  status: string;
  bid?: boolean;
  nda?: boolean;
  eng: number;
  ai: "allowed" | "not allowed" | "unknown";
  perm?: boolean;
}
const A = (
  id: string,
  name: string,
  country: string,
  sector: string,
  status: string,
  eng: number,
  ai: AcctSrc["ai"],
  o: Partial<AcctSrc> = {},
): AcctSrc => ({ id, name, country, sector, status, eng, ai, ...o });

export const ACCOUNTS: AcctSrc[] = [
  A("a_acme", "Acme Synthetic SA", "France", "Retail", "Active", 3, "allowed", {
    bid: true,
    perm: true,
  }),
  A("a_ember", "Ember Sample SAS", "France", "Energy", "Renewal", 2, "unknown"),
  A("a_quartz", "Quartz Placeholder SA", "France", "Banking", "Active", 2, "allowed"),
  A("a_lumen", "Lumen Fictive SAS", "France", "Telecom", "Paused", 1, "not allowed"),
  A("a_solana", "Solana Demo SL", "Spain", "Retail", "Active", 2, "allowed", { perm: true }),
  A("a_ibero", "Ibero Mock SA", "Spain", "Insurance", "Onboarding", 1, "unknown", { bid: true }),
  A("a_calypso", "Calypso Demo Srl", "Italy", "Manufacturing", "Active", 2, "unknown", {
    nda: true,
  }),
  A("a_alpen", "Alpen Sample AG", "Switzerland", "Banking", "Active", 2, "not allowed"),
  A("a_flandre", "Flandre Fictive NV", "Belgium", "Logistics", "Renewal", 1, "allowed", {
    bid: true,
  }),
  A("a_kappa", "Kappa Demo SAS", "Colombia", "Banking", "Active", 2, "allowed", { perm: true }),
  A("a_andes", "Andes Fictive SAS", "Colombia", "Energy", "Onboarding", 1, "unknown", {
    bid: true,
  }),
  A("a_delta", "Delta Mock Ltda", "Brazil", "Telecom", "Active", 2, "allowed"),
  A("a_jaguar", "Jaguar Sample SA", "Brazil", "Mining", "Renewal", 1, "unknown"),
  A("a_pacifico", "Pacifico Example SpA", "Chile", "Mining", "Active", 1, "allowed"),
  A("a_borealis", "Borealis Fictive Inc", "Canada", "Banking", "Active", 3, "allowed", {
    perm: true,
  }),
  A("a_cedar", "Cedar Mock Corp", "Canada", "Public sector", "Active", 1, "not allowed", {
    bid: true,
  }),
  A("a_azteca", "Azteca Placeholder SA", "Mexico", "Retail", "Active", 1, "unknown"),
  A("a_lotus", "Lotus Placeholder JSC", "Vietnam", "Manufacturing", "Active", 2, "allowed"),
  A("a_mekong", "Mekong Sample Co", "Vietnam", "Retail", "Active", 1, "unknown"),
  A("a_merlion", "Merlion Demo Pte", "Singapore", "Insurance", "Renewal", 1, "allowed"),
  A("a_carthage", "Carthage Mock SARL", "Tunisia", "Telecom", "Active", 1, "allowed"),
];

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
const SHARE = [0.3, 0.25, 0.15, 0.15, 0.15];
export const STAGE_LIST: Stage[] = ["Discover", "In design", "Building", "Piloting", "Deployed"];

export interface Leaf {
  id: string;
  label: string;
  kind: string;
  plane: Plane;
  items: number;
  open: boolean;
  star: boolean;
  gap: boolean;
  fresh: number;
  evidence: "supported" | "partial" | "unsupported";
  stage?: Stage;
  // scope refs used by the mock policy
  dept?: string;
  circle?: string;
  gov?: string;
  account?: string;
  region?: string;
  restricted?: boolean;
  nda?: boolean;
  bid?: boolean;
  parent?: string;
  group?: "bl" | "cf";
}

function leaf(
  id: string,
  label: string,
  kind: string,
  plane: Plane,
  extra: Partial<Leaf> = {},
): Leaf {
  const h = hash(id);
  const fresh = (h >>> 5) % 125;
  const gap = fresh > 90 && h % 3 === 0;
  return {
    id,
    label,
    kind,
    plane,
    items: gap ? 1 + (h % 3) : 4 + (h % 37),
    open: !gap && (h >>> 9) % 6 === 0,
    star: !gap && (h >>> 13) % 8 === 0,
    gap,
    fresh,
    evidence: gap ? "unsupported" : (h >>> 4) % 10 < 7 ? "supported" : "partial",
    ...extra,
  };
}

export interface Org {
  nodes: Map<string, Leaf>;
  topicsOfCircle: Map<string, Leaf[]>;
  circlesOfDept: Map<string, Leaf[]>;
  useCasesOfGov: Map<string, Leaf[]>;
  itemsOfTheme: Map<string, Leaf[]>;
  accountsOfCountry: Map<string, Leaf[]>;
}

function build(): Org {
  const nodes = new Map<string, Leaf>();
  const add = (l: Leaf) => {
    nodes.set(l.id, l);
    return l;
  };
  const topicsOfCircle = new Map<string, Leaf[]>();
  const circlesOfDept = new Map<string, Leaf[]>();
  const useCasesOfGov = new Map<string, Leaf[]>();
  const itemsOfTheme = new Map<string, Leaf[]>();
  const accountsOfCountry = new Map<string, Leaf[]>();

  add(leaf("core", "Company Global", "core", "GLOBAL", { items: 120 }));
  for (const [did, dl, group, circles] of DEPARTMENTS) {
    add(leaf(did, dl, "department", "DEPARTMENT", { dept: did, group }));
    const cl: Leaf[] = [];
    for (const [cid, cl_, restricted, topics] of circles) {
      const c = add(
        leaf(cid, cl_, "circle", restricted ? "ACCOUNT_RESTRICTED" : "TEAM", {
          dept: did,
          circle: cid,
          restricted: !!restricted,
          parent: did,
          group,
        }),
      );
      cl.push(c);
      topicsOfCircle.set(
        cid,
        topics.map((t) =>
          add(
            leaf(`t_${cid}_${slug(t)}`, t, "topic", restricted ? "ACCOUNT_RESTRICTED" : "TEAM", {
              dept: did,
              circle: cid,
              restricted: !!restricted,
              parent: cid,
              group,
            }),
          ),
        ),
      );
    }
    circlesOfDept.set(did, cl);
  }
  for (const [gid, gl, group, n] of GOVERNANCES) {
    add(leaf(gid, gl, "governance", "GLOBAL", { gov: gid, group, items: n }));
    const list: Leaf[] = [];
    for (let i = 0; i < n; i++) {
      const id = `uc_${gid.slice(2)}_${String(i + 1).padStart(3, "0")}`;
      const h = hash(id);
      const r = (h % 1000) / 1000;
      let acc = 0;
      let stage: Stage = "Deployed";
      for (let s = 0; s < SHARE.length; s++) {
        acc += SHARE[s] as number;
        if (r < acc) {
          stage = STAGE_LIST[s] as Stage;
          break;
        }
      }
      const title = `${pick(UC_TITLES, h >>> 3)} ${String.fromCharCode(65 + ((h >>> 11) % 6))}${(i % 9) + 1}`;
      list.push(add(leaf(id, title, "usecase", "GLOBAL", { gov: gid, stage, parent: gid, group })));
    }
    useCasesOfGov.set(gid, list);
  }
  for (const [tid, tl, items] of THEMES) {
    add(leaf(tid, tl, "theme", "GLOBAL"));
    itemsOfTheme.set(
      tid,
      items.map((it) =>
        add(leaf(`ti_${tid.slice(3)}_${slug(it)}`, it, "themeitem", "GLOBAL", { parent: tid })),
      ),
    );
  }
  for (const [rid, rl, countries] of REGIONS) {
    add(leaf(rid, rl, "region", "ACCOUNT_RESTRICTED", { region: rid }));
    for (const cn of countries) {
      const kid = `k_${slug(cn)}`;
      add(leaf(kid, cn, "country", "ACCOUNT_RESTRICTED", { region: rid, parent: rid }));
      accountsOfCountry.set(
        kid,
        ACCOUNTS.filter((a) => a.country === cn).map((a) =>
          add(
            leaf(a.id, a.name, "account", "ACCOUNT_RESTRICTED", {
              account: a.id,
              region: rid,
              nda: a.nda,
              bid: a.bid,
              parent: kid,
              items: 6 + a.eng * 9,
              open: a.eng >= 2 && hash(a.id) % 2 === 0,
              star: !!a.perm || hash(a.id) % 5 === 0,
              gap: false,
              fresh: hash(a.id) % 40,
            }),
          ),
        ),
      );
    }
  }
  return { nodes, topicsOfCircle, circlesOfDept, useCasesOfGov, itemsOfTheme, accountsOfCountry };
}

export const ORG: Org = build();
