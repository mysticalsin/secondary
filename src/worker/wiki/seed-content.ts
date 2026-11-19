// The synthetic brain of the dev environment: raw records per workspace, written as plain data. The
// wiki is built from them by the ordinary ingest (deterministic extractor), never typed in as pages.
// Everything is fictional and drawn from the synthetic org (accounts, circles, departments).
// Pure: no I/O, no clock (the caller passes `now`), no randomness.

import { GOVERNANCES, type Org, type OrgNode } from "@secondary/policy";
import { scopeOfNode } from "../scope.ts";
import type { SeedDoc } from "./store.ts";
import { slug } from "./text.ts";
import type { SchemaType } from "./types.ts";

/**
 * Bump when the seed gains content. A dev tenant that finished an older version runs the (idempotent)
 * seed again on its next request; records that already exist are kept as they are.
 */
export const WIKI_SEED_VERSION = 1;

/** Page types the seed adds to every workspace (the default types stay). Folders in the Brain tree. */
export const SEED_TYPES: Record<string, SchemaType> = {
  client: { label: "Clients", required: ["Summary"] },
  project: { label: "Projects", required: ["Summary"] },
  opportunity: { label: "Opportunities", required: ["Summary"] },
  bid: { label: "Bids", required: ["Summary"] },
  offer: { label: "Offers", required: ["Summary"] },
  expertise: { label: "Expertise", required: ["Summary"] },
  interaction: { label: "Interactions", required: ["Summary"] },
  entity: { label: "Entities", required: ["Summary"] },
  success_story: { label: "Success stories", required: ["Summary"] },
  contacts: { label: "Contacts (restricted)", required: ["Summary"] },
};

export type SeedWorkspace = { scope: string; plane: string; docs: SeedDoc[] };

const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
const pick = <T>(xs: readonly T[], key: string): T => xs[hash(key) % xs.length] as T;
const DAY = 86_400_000;
const day = (now: number, offset: number): string =>
  new Date(now + offset * DAY).toISOString().slice(0, 10);

type Sections = [heading: string, bullets: string[]][];

class Builder {
  readonly docs: SeedDoc[] = [];
  private readonly used = new Set<string>();
  readonly scope: string;
  private readonly now: number;
  constructor(scope: string, now: number) {
    this.scope = scope;
    this.now = now;
  }

  private id(kind: string, title: string): string {
    let n = 0;
    let id: string;
    do id = `seed:${this.scope}:${kind}:${slug(title)}${n ? `-${n}` : ""}`;
    while (this.used.has(id) && ++n);
    this.used.add(id);
    return id;
  }

  /** A reference page, as Markdown in a raw record. The ingest turns it into a cited wiki page. */
  page(
    type: string,
    title: string,
    sections: Sections,
    ageDays = 20,
    extraTags: string[] = [],
  ): string {
    const body = [
      `# ${title}`,
      "",
      ...sections.flatMap(([h, bullets]) => [`## ${h}`, ...bullets.map((b) => `- ${b}`), ""]),
    ].join("\n");
    this.docs.push({
      id: this.id("doc", title),
      label: title,
      kind: "record",
      status: "published",
      tags: [`page:${type}`, ...extraTags],
      body,
      ageDays,
    });
    return slug(title);
  }

  /** A decision, commitment or risk record: it yields dated facts, and the generated logs. */
  record(
    section: "dec" | "com" | "risk",
    title: string,
    status: string,
    ownerRole: string,
    ageDays: number,
    dueInDays?: number,
  ): void {
    this.docs.push({
      id: this.id(section, title),
      label: title,
      kind: "record",
      status,
      tags: [section],
      body: JSON.stringify({
        note: "",
        ownerRole,
        due: dueInDays === undefined ? null : day(this.now, dueInDays),
        story: null,
      }),
      ageDays,
    });
  }

  meeting(
    title: string,
    ageDays: number,
    notes: string,
    decisions: { title: string; status?: string; owner?: string }[],
    commitments: { title: string; owner?: string; dueInDays?: number; status?: string }[],
    risks: { title: string; severity?: string; status?: string }[],
  ): void {
    this.docs.push({
      id: this.id("mtg", title),
      label: title,
      kind: "meeting_record",
      status: "recorded",
      tags: ["meeting"],
      body: JSON.stringify({
        title,
        date: day(this.now, -ageDays),
        decisions,
        commitments: commitments.map(({ dueInDays, ...c }) => ({
          ...c,
          ...(dueInDays === undefined ? {} : { due: day(this.now, dueInDays) }),
        })),
        risks,
        notes,
      }),
      ageDays,
    });
  }
}

const link = (...titles: string[]): string => titles.map((t) => `[[${slug(t)}]]`).join(" ");

// ---- Company Global ----

const CORE_TEXT: Record<string, string[]> = {
  "mission-and-values": [
    "The firm helps clients run technology and talent with people who stay accountable for results.",
    "Four values guide daily choices: care for clients, craft, openness and ownership.",
  ],
  "operating-model": [
    "Work is organised in business lines, corporate functions and circles that own methods.",
    "Accounts are served by a lead, a delivery lead and, for bids, a bid manager.",
  ],
  "code-of-conduct": [
    "Everyone reports a conflict of interest to their lead before work starts.",
    "Client material is used only for the client's engagement and the firm's reviewed lessons.",
  ],
  "security-basics": [
    "Use the approved password manager and multi-factor sign-in on every system.",
    "Client data stays in the client's tenant or the account workspace, never in personal storage.",
    "Report a lost device or a suspicious message to Security Operations the same day.",
  ],
  "information-classification": [
    "Four classes exist: public, internal, restricted and client confidential.",
    "Restricted circles and NDA accounts keep their pages to named members.",
    "Contact details live in the account's Contacts space and nowhere else.",
  ],
  "client-engagement-principles": [
    "Agree scope, owners and cadence in writing at kickoff.",
    "Tell the client early when a risk moves from open to likely.",
    "External use of a client name, logo, quote or metric needs customer permission on record.",
  ],
  "quality-policy": [
    "Every deliverable passes a second pair of eyes before it reaches a client.",
    "The delivery quality gates set the checks at kickoff, design, release and close-out.",
  ],
  "travel-policy": [
    "Book through the approved tool and prefer rail for trips under four hours.",
    "Client-billable travel is agreed in the statement of work before booking.",
  ],
  "tooling-map": [
    "Each task has one approved tool: documents, tickets, source code, time and expenses.",
    "New tools go through vendor onboarding and a security review first.",
  ],
  "brand-principles": [
    "Short sentences, concrete proof and one clear ask in every client document.",
    "External material passes the brand review and the confidentiality check.",
  ],
  "org-chart": [
    "Five business lines and seven corporate functions form the group.",
    "Each department has circles; a circle owns a set of methods and topics.",
  ],
};

function globalDocs(b: Builder, org: Org, now: number): void {
  const bid = "Bid playbook";
  const price = "Pricing method";
  const gono = "Go or no-go criteria";
  const gates = "Delivery quality gates";
  b.page("method", bid, [
    [
      "Summary",
      [
        "The bid playbook sets how Bid & Pre-sales qualifies, prices, writes and reviews a response.",
        "It applies to every public tender, private request for proposal and renewal bid.",
      ],
    ],
    [
      "Steps",
      [
        "Qualify within two working days using the go or no-go criteria.",
        "Name a bid manager and a second pricing reviewer before drafting starts.",
        "Build the response from the response library and the success stories approved for internal use.",
        "Hold a red team review at least two days before the submission date.",
        "Record the outcome and the lessons in the account workspace within a week of the decision.",
      ],
    ],
    ["Related", [link(price, gono, gates)]],
  ]);
  b.page("method", price, [
    [
      "Summary",
      [
        "Prices start from the rate cards and a margin floor set by Finance.",
        "Every fixed fee bid gets a second pair of eyes on scope, assumptions and risk allowance.",
      ],
    ],
    [
      "Steps",
      [
        "Estimate effort bottom up by role, then apply the rate card for the delivery country.",
        "Check the margin against the floor; anything below it goes to the pricing reviewer.",
        "Discounts above ten percent need approval from the head of Bid & Pre-sales and Finance.",
        "State assumptions and exclusions in the offer so a scope change has a price.",
        "Record the final price position as a decision in the account workspace.",
      ],
    ],
    ["Related", [link(bid, gono)]],
  ]);
  b.page("method", gono, [
    [
      "Summary",
      [
        "A bid goes ahead only when it clears these criteria; a no-go is a decision with a recorded reason.",
      ],
    ],
    [
      "Criteria",
      [
        "Fit: the work matches an offer or practice we can staff.",
        "Access: we know the buyer and can speak to the sponsor before submission.",
        "Capacity: named people are free for the first three months.",
        "Margin: the expected margin clears the floor in the pricing method.",
        "Risk: no clause remains that we cannot accept after legal review.",
        "AI work: the client contract says AI processing is allowed, or the bid excludes it.",
      ],
    ],
    ["Related", [link(bid, price)]],
  ]);
  b.page("method", gates, [
    ["Summary", ["Four gates keep delivery predictable: kickoff, design, release and close-out."]],
    [
      "Gates",
      [
        "Kickoff gate: scope, owners, cadence and risks are written down and agreed with the client.",
        "Design gate: a second engineer reviews the target design before build starts.",
        "Release gate: tests, runbook and rollback are checked before go-live.",
        "Close-out gate: handover accepted, lessons recorded and a success story considered.",
      ],
    ],
    [
      "Project handover",
      [
        "The delivery lead walks the run team through the runbook, open risks and contact references.",
        "Both sides sign the handover note, and open actions get an owner and a date.",
      ],
    ],
    ["Related", [link(bid)]],
  ]);
  b.page("topic", "AI usage policy", [
    [
      "Summary",
      [
        "AI processing is used only where the client contract says allowed; where it says unknown or not allowed, no model sees the material.",
        "The Personal Brain is never sent to a model.",
      ],
    ],
    [
      "Rules",
      [
        "Every AI answer carries citations, and a person reviews anything that leaves the firm.",
        "Use cases are registered in the AI programme and tracked from discovery to deployed.",
        "Incidents involving AI output are reported to Security Operations within one working day.",
      ],
    ],
  ]);
  b.page("method", "Onboarding handbook", [
    [
      "Summary",
      [
        "The first week gets a new colleague to a safe laptop, the right workspaces and a first task.",
      ],
    ],
    [
      "Steps",
      [
        "Day one: accounts, multi-factor sign-in and the tooling map.",
        "Day two: security basics and the information classification.",
        "Day three: meet the circle lead and read the circle's methods.",
        "End of week one: first deliverable reviewed by a second person.",
      ],
    ],
  ]);
  b.page(
    "topic",
    "AI use cases by governance",
    [
      [
        "Summary",
        [
          `The AI programme tracks ${GOVERNANCES.reduce((n, g) => n + g[3], 0)} use cases across ${GOVERNANCES.length} governances.`,
        ],
      ],
      ["Governances", GOVERNANCES.map(([, label, , n]) => `${label}: ${n} use cases.`)],
    ],
    14,
  );
  b.page("glossary", "Glossary", [
    [
      "Terms",
      [
        "Circle: a group that owns a set of methods and topics.",
        "Workspace: the place where one account, circle or department keeps its pages.",
        "Customer permission: the client's recorded yes to external use of a name, quote or metric.",
        "Go or no-go: the decision whether to bid.",
        "Red team: a review by people who are not on the bid.",
      ],
    ],
  ]);
  for (const t of org.nodes.values()) {
    if (t.kind !== "coretopic") continue;
    const key = slug(t.label);
    const text = CORE_TEXT[key];
    if (!text) continue;
    b.page("topic", t.label, [["Summary", text]]);
  }
  b.meeting(
    "Methods council, October",
    6,
    "The council reviewed the bid playbook and the pricing method.",
    [
      {
        title: "Require a second pricing reviewer on fixed fee bids",
        status: "decided",
        owner: "Bid manager",
      },
      {
        title: "Publish the bid playbook in Company Global",
        status: "decided",
        owner: "Knowledge reviewer",
      },
    ],
    [
      {
        title: "Refresh the response library",
        owner: "Knowledge reviewer",
        dueInDays: 21,
        status: "open",
      },
    ],
    [{ title: "Playbook drifts from practice", severity: "medium", status: "open" }],
  );
  b.record("dec", "Use rate cards as the pricing baseline", "decided", "Bid manager", 30);
}

// ---- departments and circles ----

const TOPIC_TEXT: Record<string, string[]> = {
  "response-library": [
    "The response library holds approved answers, case studies and CVs for bids.",
    "Each entry names an owner and a review date.",
    "Entries older than twelve months are reviewed before reuse.",
  ],
  "pricing-models": [
    "Pricing models cover time and materials, fixed fee and retainer.",
    "Retainers are priced per month with a volume band.",
    "Fixed fee bids need the second pricing reviewer.",
  ],
  "win-themes": [
    "A win theme is one sentence that links the buyer's goal to our proof.",
    "Each bid carries at most three themes, repeated in the summary, the price and the close.",
  ],
  "red-team-method": [
    "A red team of three people who are not on the bid reads the response as the buyer would.",
    "They score fit, clarity, proof and price, and list the five changes that matter.",
    "The bid manager answers every point before submission.",
  ],
  "kickoff-checklist": [
    "Confirm scope, owners, cadence and the first risks with the client in writing.",
    "Set up the account workspace, the status report and the first review date.",
  ],
  "status-reporting": [
    "A status report goes out every week: progress, next steps, risks and decisions needed.",
    "A risk that moves from open to likely is raised with the client in the same week.",
  ],
  "quality-gates": [
    "Quality gates apply at kickoff, design, release and close-out.",
    "A gate passes only when a second person has checked the listed items.",
  ],
  "close-out-method": [
    "Hand over the runbook, open risks and contact references to the run team.",
    "Record lessons and consider a success story, internal only until the client agrees.",
  ],
  "account-planning": [
    "Each key account has a plan with goals, stakeholders by role and the next three moves.",
    "The plan is reviewed every quarter with the delivery lead.",
  ],
  "renewal-motions": [
    "Start the renewal conversation six months before the contract end.",
    "Bring results, risks and a proposal for the next phase.",
  ],
  "win-and-loss-reviews": [
    "Hold a review within two weeks of every bid decision.",
    "Record what worked, what did not and what changes in the playbook.",
  ],
  "stakeholder-maps": [
    "Map stakeholders by role and influence, using contact references, never personal details.",
    "Update the map after every steering meeting.",
  ],
  "use-case-intake": [
    "Any colleague can propose an AI use case through one short form.",
    "The AI programme triages each proposal within five working days.",
  ],
  "prioritisation-scoring": [
    "Use cases are scored on value, feasibility and risk, then ranked per governance.",
  ],
  "value-tracking": [
    "Each deployed use case reports hours saved or revenue protected every quarter.",
  ],
  "model-risk-checks": [
    "Before a pilot, the model risk check covers data, bias, security and a human review step.",
  ],
  "alert-triage": [
    "Alerts are classified in fifteen minutes and routed to an owner.",
    "A confirmed incident follows the incident runbook and is reported to the CISO office.",
  ],
  "access-reviews": ["Access to client systems is reviewed every quarter by the system owner."],
  "month-end-close": [
    "The close runs on a fixed calendar with owners per ledger.",
    "Open items older than thirty days are escalated to the head of Controls & Close.",
  ],
  "expense-policy": ["Expenses are filed within thirty days with a receipt and a client code."],
  "rate-cards": [
    "Rate cards are set per role and country and reviewed each January.",
    "Exceptions need Finance approval.",
  ],
  "onboarding-checklist": [
    "The checklist covers contract, equipment, access and the first-week plan.",
  ],
  "brand-voice": ["Write short sentences with a concrete result and a single call to action."],
  "case-study-kit": [
    "A case study needs a result, a lesson and customer permission before it goes external.",
  ],
};

const PRIORITIES = [
  "Keep methods short enough to use on a live bid.",
  "Move reviews earlier so fewer changes land near a deadline.",
  "Reuse approved material before writing new text.",
  "Make owners and review dates visible on every method.",
];

function circleDocs(b: Builder, org: Org, circle: OrgNode, dept: OrgNode, now: number): void {
  const topics = circle.childIds
    .map((id) => org.nodes.get(id))
    .filter((n): n is OrgNode => !!n && n.kind === "topic");
  const restricted = circle.restricted === true;
  const titles = topics.map((t) => t.label);
  for (const t of topics) {
    const key = slug(t.label);
    const text = TOPIC_TEXT[key] ?? [
      `${t.label} is owned by the ${circle.label} circle of ${dept.label}.`,
      `It describes how ${dept.label} handles ${t.label.toLowerCase()} across engagements.`,
      `The circle lead reviews it every quarter and records changes in the log.`,
    ];
    b.page("method", t.label, [
      ["Summary", text],
      [
        "Review",
        [`Owner: the ${circle.label} circle. Last review: ${day(now, -((hash(t.id) % 40) + 5))}.`],
      ],
    ]);
  }
  b.page("topic", `${circle.label} charter`, [
    [
      "Summary",
      [
        `The ${circle.label} circle is part of ${dept.label} and owns ${titles.length} methods.`,
        restricted
          ? "This circle is restricted: its pages are open to named members only."
          : "The circle is open to its department; others see the methods once released.",
      ],
    ],
    ["Methods", [link(...titles)]],
    ["Priority", [pick(PRIORITIES, circle.id)]],
  ]);
  if (circle.id === "c_bid") {
    b.page("offer", "Analytics retainer offer", [
      [
        "Summary",
        [
          "A monthly retainer for dashboards, data quality checks and a weekly digest.",
          "Price bands: three tiers, set by scope and the number of data sources.",
        ],
      ],
      ["Proof", ["Two success stories approved for internal use back the offer."]],
    ]);
    b.page("offer", "Data platform health check", [
      [
        "Summary",
        [
          "A two-week review of a client's data platform: quality, cost, security and ownership.",
          "The output is a ranked list of ten actions with owners and effort.",
        ],
      ],
    ]);
    b.page("topic", "Proof points for bids", [
      [
        "Summary",
        [
          "Proof points come from success stories approved for internal use.",
          "External use of a client name, logo, quote or metric needs customer permission on record.",
        ],
      ],
    ]);
  }
  if (circle.id === "c_sia_ai") {
    b.page("expertise", "Data governance practice", [
      [
        "Summary",
        [
          "The practice offers a data catalogue, quality rules and a stewardship model.",
          "It works with client data owners to name who decides what.",
        ],
      ],
    ]);
  }
  if (circle.id === "c_delivery") {
    b.page("method", "Project handover method", [
      [
        "Summary",
        ["A handover moves a finished project to the run team with nothing left implicit."],
      ],
      [
        "Steps",
        [
          "The delivery lead schedules the handover session two weeks before the end.",
          "Walk through the runbook, open risks and contact references.",
          "Both sides sign the handover note and agree the first thirty days of support.",
        ],
      ],
    ]);
    b.page("topic", "Delivery handbook", [
      ["Summary", ["Each delivery step has one owner."]],
      [
        "Owners",
        [
          "Kickoff: the delivery lead.",
          "Design review: a second engineer.",
          "Release: the release manager.",
          "Close-out and handover: the account lead with the delivery lead.",
        ],
      ],
    ]);
  }
  b.meeting(
    `${circle.label} sync`,
    4 + (hash(circle.id) % 8),
    `The circle reviewed ${titles[0] ?? "its methods"} and open actions.`,
    [
      {
        title: `Keep ${titles[0] ?? "the methods"} as the circle's first priority`,
        status: "decided",
        owner: "Knowledge reviewer",
      },
    ],
    [
      {
        title: `Review ${titles[1] ?? titles[0] ?? "the methods"} with the circle`,
        owner: "Delivery lead",
        dueInDays: 10 + (hash(circle.id) % 20),
        status: "open",
      },
    ],
    [{ title: `${circle.label} methods go stale`, severity: "low", status: "open" }],
  );
}

function departmentDocs(b: Builder, org: Org, dept: OrgNode, now: number): void {
  const circles = dept.childIds.map((id) => org.nodes.get(id)).filter((n): n is OrgNode => !!n);
  const names = circles.map((c) => c.label);
  b.page("topic", `${dept.label} at a glance`, [
    [
      "Summary",
      [
        `${dept.label} belongs to the ${dept.group === "bl" ? "business lines" : "corporate functions"}.`,
        `Circles: ${names.join(", ")}.`,
        circles.some((c) => c.restricted)
          ? "Restricted circles keep their pages to named members."
          : "All circles are open to the department.",
      ],
    ],
    ["Priority", [pick(PRIORITIES, dept.id)]],
  ]);
  b.meeting(
    `${dept.label} quarterly review`,
    8 + (hash(dept.id) % 10),
    `The department reviewed its methods and the open commitments of its circles.`,
    [
      {
        title: `Keep ${names[0] ?? "the first circle"} as owner of the shared methods`,
        status: "decided",
        owner: "Knowledge reviewer",
      },
    ],
    [
      {
        title: `Publish one method per circle this quarter`,
        owner: "Delivery lead",
        dueInDays: 30,
        status: "open",
      },
    ],
    [{ title: `Methods owned by one person only`, severity: "medium", status: "open" }],
  );
  void now;
}

// ---- accounts ----

const STAKEHOLDER_ROLES = [
  "Executive sponsor",
  "Programme owner",
  "Finance partner",
  "Security lead",
  "Procurement lead",
  "Business owner",
];
const MILESTONES = [
  "Design sign-off with the steering group",
  "First release to a pilot team",
  "Data migration rehearsal",
  "Go-live readiness review",
  "Handover to the run team",
];
const HEALTH = ["on track", "on track", "at risk, with a recovery plan", "ahead of plan"];
const LESSONS = [
  "Agree the success measure at kickoff, not at the end.",
  "Name a client owner for every deliverable.",
  "Rehearse the cut-over before the real date.",
  "Keep the steering group short and decisions written.",
];

function accountDocs(b: Builder, org: Org, acct: OrgNode, now: number): void {
  const aid = acct.id;
  const kids = (suffix: string): string[] =>
    (org.nodes.get(`${aid}:${suffix}`)?.childIds ?? [])
      .map((id) => org.nodes.get(id)?.label)
      .filter((l): l is string => !!l);
  const f = acct.facts;
  const engagements = kids("eng");
  const projects = kids("prj");
  const decisions = kids("dec");
  const commitments = kids("com");
  const risks = kids("risk");
  const stories = kids("out");
  const contactRefs = kids("con");
  const meetings = (org.nodes.get(aid)?.childIds ?? [])
    .map((id) => org.nodes.get(id))
    .filter((n): n is OrgNode => !!n && n.kind === "meeting")
    .map((n) => n.label);
  const bids = (org.nodes.get(aid)?.childIds ?? [])
    .map((id) => org.nodes.get(id))
    .filter((n): n is OrgNode => !!n && n.kind === "bid")
    .map((n) => n.label);
  const permission = f["Customer permission"] === "Yes";
  const sector = f.Sector ?? "";
  const oppTitle = `${f.Status === "Renewal" ? "Renewal of" : "Expansion of"} ${engagements[0] ?? "the main engagement"}`;

  b.page("client", acct.label, [
    [
      "Summary",
      [
        `${acct.label} is a ${sector.toLowerCase()} client in ${f.Country}. The account status is ${f.Status?.toLowerCase()}.`,
        `Engagements: ${engagements.join(", ") || "none yet"}.`,
        `AI processing with this client: ${f["AI use with client"]}. Customer permission for external use: ${permission ? "on record" : "not on record"}.`,
      ],
    ],
    [
      "Related",
      [link(...projects, ...(f.Status === "Paused" ? [] : [oppTitle]), ...bids, ...meetings)],
    ],
  ]);
  for (const p of projects) {
    const key = `${aid}:${p}`;
    b.page("project", p, [
      [
        "Summary",
        [
          `${p} runs under ${engagements[hash(key) % Math.max(engagements.length, 1)] ?? "the main engagement"} for ${acct.label}.`,
          `Status: ${pick(HEALTH, key)}.`,
        ],
      ],
      [
        "Next",
        [
          `Next milestone: ${pick(MILESTONES, key)}, planned for ${day(now, 7 + (hash(key) % 40))}.`,
        ],
      ],
      ["Related", [link(acct.label)]],
    ]);
  }
  if (f.Status !== "Paused") {
    b.page("opportunity", oppTitle, [
      [
        "Summary",
        [
          `${oppTitle} is an open opportunity with ${acct.label}.`,
          `Stage: ${pick(["qualified", "proposal drafted", "in negotiation"], aid)}. Size: ${pick(["small", "medium", "large"], `${aid}o`)} band.`,
        ],
      ],
      [
        "Next",
        [
          `Next step: review the proposal with the account lead by ${day(now, 10 + (hash(aid) % 14))}.`,
        ],
      ],
      ["Related", [link(acct.label)]],
    ]);
  }
  for (const t of bids) {
    b.page("bid", t, [
      [
        "Summary",
        [
          `${t} is a bid for ${acct.label} that cleared the go or no-go criteria.`,
          `Submission date: ${day(now, 5 + (hash(t) % 25))}. A bid manager and a second pricing reviewer are named.`,
        ],
      ],
      ["Review", ["The red team review is planned two days before submission."]],
      ["Related", [link(acct.label)]],
    ]);
  }
  for (const s of stories) {
    b.page("success_story", `${s} at ${acct.label}`, [
      [
        "Summary",
        [
          `${s}: the result was delivered with ${acct.label} and reviewed by the delivery lead.`,
          `Lesson: ${pick(LESSONS, `${aid}${s}`)}`,
        ],
      ],
      [
        "Use",
        [
          permission
            ? "Internal use is approved. Customer permission is on record for the approved external text only."
            : "Internal use only. No customer permission is on record, so the client name stays out of external material.",
        ],
      ],
    ]);
  }
  b.page("entity", `Sector: ${sector}`, [
    [
      "Summary",
      [
        `${acct.label} operates in ${sector.toLowerCase()}, where contracts follow a yearly budget cycle.`,
        "Renewal talks start about six months before the contract end.",
      ],
    ],
  ]);
  b.page(
    "contacts",
    "Contact references",
    [
      [
        "Summary",
        contactRefs.map(
          (ref, i) =>
            `${ref}: ${pick(STAKEHOLDER_ROLES, `${aid}${i}`)}, last contact ${day(now, -(3 + i * 4))}.`,
        ),
      ],
    ],
    10,
    ["contacts"],
  );
  meetings.forEach((m, i) => {
    b.meeting(
      m,
      2 + i * 6 + (hash(m) % 3),
      `Steering and delivery review for ${acct.label}.`,
      [
        {
          title: `Confirm ${pick(["the next release date", "the scope of the next phase", "the reporting cadence"], m)}`,
          status: "decided",
          owner: "Account lead",
        },
      ],
      [
        {
          title: `Send the updated plan to ${acct.label}`,
          owner: "Delivery lead",
          dueInDays: 5 + i * 7,
          status: "open",
        },
      ],
      i === 0
        ? [{ title: `Dependency on one client owner`, severity: "medium", status: "open" }]
        : [],
    );
  });
  decisions.forEach((t, i) => {
    b.record("dec", t, i === 0 ? "decided" : "open", "Account lead", 12 + i * 9);
  });
  commitments.forEach((t, i) => {
    b.record("com", t, i === 0 ? "in progress" : "open", "Delivery lead", 9 + i * 5, 6 + i * 9);
  });
  risks.forEach((t, i) => {
    b.record("risk", t, i === 0 ? "mitigating" : "open", "Delivery lead", 15 + i * 6);
  });
}

// ---- Personal Brain ----

const FOCUS: Record<string, string[]> = {
  ceo: ["Review the pipeline and the accounts at risk.", "Prepare the board update on bids."],
  head_bid: ["Run the red team for the next bid.", "Agree the pricing position with Finance."],
  acme_lead: [
    "Prepare the quarterly review for the Acme account.",
    "Confirm the next phase scope.",
  ],
  consultant: ["Finish the handover note for the current project.", "Update the runbook."],
  reviewer: ["Clear the review queue for Company Global.", "Check the freshness of two methods."],
  platform_admin: [
    "Check connector health and access reviews.",
    "Review the kill switch settings.",
  ],
  auditor: ["Sample receipts for the monthly review.", "Check that exports left a receipt."],
};

function personalDocs(b: Builder, role: string, now: number): void {
  const focus = FOCUS[role] ?? ["Plan the week."];
  b.docs.push(
    ...(
      [
        [
          "Weekly focus",
          [
            ...focus.map((x) => `${x}`),
            `Commitment: Close the open actions from last week (owner: me, due: ${day(now, 4)})`,
          ],
          3,
        ],
        [
          "Open questions",
          [
            "Which pages in the brain are older than six months and still used?",
            "Decision: Keep notes short and cite the source record.",
          ],
          5,
        ],
        [
          "How I run my week",
          [
            "Monday: plan the three outcomes that matter.",
            "Thursday: review what changed in the accounts and circles I follow.",
            "Friday: write down what I decided and what I owe.",
          ],
          9,
        ],
      ] as [string, string[], number][]
    ).map(([title, bullets, age]) => ({
      id: `seed:personal:${role}:${slug(title)}`,
      label: title,
      kind: "personalitem" as const,
      status: "draft",
      tags: ["note", "page:topic"],
      body: [`# ${title}`, "", "## Summary", ...bullets.map((x) => `- ${x}`)].join("\n"),
      ageDays: age,
    })),
  );
}

// ---- the plan ----

const PLANE_OF: Record<string, string> = {
  core: "GLOBAL_NONPERSONAL",
  department: "TEAM_RESTRICTED",
  circle: "TEAM_RESTRICTED",
  account: "ACCOUNT_RESTRICTED",
};

/**
 * The raw records for every workspace that carries a wiki: Company Global, each department and circle,
 * each account, and a few notes in each persona's own Personal Brain. `personal` maps a role to its
 * principal id. Each workspace gets only records about itself.
 */
export function planWikiSeed(
  org: Org,
  personal: { role: string; principalId: string }[],
  now: number,
): SeedWorkspace[] {
  const out: SeedWorkspace[] = [];
  for (const n of org.nodes.values()) {
    if (!(n.kind in PLANE_OF)) continue;
    const scope = scopeOfNode(n);
    if (!scope) continue;
    const b = new Builder(scope, now);
    if (n.kind === "core") globalDocs(b, org, now);
    else if (n.kind === "department") departmentDocs(b, org, n, now);
    else if (n.kind === "circle") {
      const dept = org.nodes.get(n.parentId ?? "");
      if (!dept) continue;
      circleDocs(b, org, n, dept, now);
    } else accountDocs(b, org, n, now);
    out.push({ scope, plane: PLANE_OF[n.kind] as string, docs: b.docs });
  }
  for (const p of personal) {
    const scope = `personal:${p.principalId}`;
    const b = new Builder(scope, now);
    personalDocs(b, p.role, now);
    out.push({ scope, plane: "PERSONAL_HOSTED", docs: b.docs });
  }
  return out;
}
