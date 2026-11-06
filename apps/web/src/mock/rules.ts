// Dev mock for v7 Brain rules (docs/API-CONTRACT.md "v7 Brain rules"). Synthetic data only.
//
// Every endpoint of the contract, in memory (a page reload starts again from the five seed rules):
//   GET /v1/rules[?brain=]  GET|PUT|DELETE /v1/rules/:id  POST /v1/rules  POST /v1/rules/validate
//   POST /v1/rules/simulate  POST /v1/rules/:id/publish|rollback  GET|PUT /v1/rules/incident
//   GET /v1/rules/holds  POST /v1/rules/holds/:id/decide
// The rule model, validator, diff and simulator are the real ones from @secondary/policy, so a
// refusal names the same floor and the simulation counts are a true replay of the synthetic event
// list below. Who may see what follows the contract: the platform admin is the admin (configure),
// a person who manages a brain is its steward, anyone else gets 404.
//
// Two-person steps (publish of a rule that reaches an account, Global or restricted brain, every
// rollback, switching incident mode on): the dev mock has one person, so the second one is played
// with two localStorage keys, set before the step:
//   secondary.mock.rules.second = 1   the next such step counts as confirmed by a second person and
//                                     completes at once (the key is cleared when used).
//   secondary.mock.rules.other  = 1   the next such step is recorded as asked by someone else, so the
//                                     editor shows "Confirm publish vN+1" (cleared when used).
import {
  affectsProtectedBrains,
  diffRules,
  type FloorId,
  type RuleChange,
  type RuleDraft,
  type RuleEffect,
  type SimEvent,
  scopeReaches,
  simulateRules,
  validateRule,
  weakensRule,
} from "@secondary/policy";
import { ApiError } from "../api";
import type {
  HoldRow,
  IncidentState,
  PublishResult,
  RuleDetail,
  RuleRow,
  RulesList,
  SimulationView,
  VersionRow,
} from "../rules/types";
import { hash } from "./org";
import { NOT_HANDLED } from "./uxv2";
import { v3Brains } from "./v3";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const SECOND_KEY = "secondary.mock.rules.second";
const OTHER_KEY = "secondary.mock.rules.other";

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const iso = (ms: number) => new Date(ms).toISOString();
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function flag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function clearFlag(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* storage unavailable: the flag was never set */
  }
}

// ---------- who is who ----------

const BRAINS = v3Brains.filter((b) => b.type !== "personal");
const brainOf = (id: string) => BRAINS.find((b) => b.id === id);
const labelOf = (id: string) => brainOf(id)?.name ?? id;
const isProtected = (id: string) => {
  const b = brainOf(id);
  return !!b && (b.restricted || b.type === "account" || b.type === "global");
};

interface Viewer {
  role: string;
  admin: boolean;
  /** Brains this person may decide in (a steward's, or every brain for the admin). */
  brains: Set<string>;
  by: string;
}
const viewerOf = (role: string): Viewer => {
  const admin = role === "platform_admin";
  return {
    role,
    admin,
    brains: new Set(BRAINS.filter((b) => admin || b.manages.includes(role)).map((b) => b.id)),
    by: `u_${role}`,
  };
};

// ---------- stored rules ----------

interface Version {
  version: number;
  body: RuleDraft;
  by: string;
  at: number;
  rolledBackFrom?: number;
  changes: RuleChange[];
}
interface Stored {
  id: string;
  createdAt: number;
  versions: Version[];
  /** Unpublished edits. For a rule never published, its only body. */
  draft: RuleDraft | null;
  editedBy: string;
  editedAt: number;
  pending: {
    by: "you" | "other";
    at: number;
    kind: "publish" | "rollback";
    version: number;
  } | null;
}

const NOW0 = Date.now();
const THEN = "then" as const;
const body = (
  name: string,
  scope: RuleDraft["scope"],
  when: RuleDraft["when"],
  then: RuleDraft["then"],
  status: RuleDraft["status"],
  incident = false,
): RuleDraft => ({ name, scope, when, except: { incident }, status, [THEN]: then }) as RuleDraft;

const SEEDS: { id: string; ageDays: number; ageMs?: number; body: RuleDraft }[] = [
  {
    id: "r_2",
    ageDays: 45,
    body: body(
      "A client name in a Global candidate is blocked",
      { kind: "brain_types", types: ["global"] },
      [
        { field: "content_flag", op: "is_any_of", values: ["client_name"] },
        { field: "action", op: "is_any_of", values: ["promote_to_global", "propose_page"] },
      ],
      { effect: "block", message: "Remove the client name, then send it again." },
      "enforced",
    ),
  },
  {
    id: "r_3",
    ageDays: 33,
    body: body(
      "Exports over 50 pages need approval",
      { kind: "tenant" },
      [
        { field: "action", op: "is_any_of", values: ["export"] },
        { field: "size_pages", op: "greater_than", values: ["50"] },
      ],
      { effect: "review" },
      "enforced",
      true,
    ),
  },
  {
    id: "r_4",
    ageDays: 9,
    body: body(
      "Account AI contract unknown blocks agent writes",
      { kind: "brain_types", types: ["account"] },
      [
        { field: "actor", op: "is_any_of", values: ["agent"] },
        { field: "ai_contract", op: "is_any_of", values: ["unknown"] },
        {
          field: "action",
          op: "is_any_of",
          values: ["propose_page", "propose_change", "write_session_report", "import"],
        },
      ],
      {
        effect: "block",
        message: "This account has no AI contract on file. Ask the account lead.",
      },
      "enforced",
    ),
  },
  {
    id: "r_5",
    ageDays: 0,
    ageMs: 2 * HOUR,
    body: body(
      "Weekend: agent writes to Bid & Pre-sales need two approvers",
      { kind: "brains", ids: ["c_bid"] },
      [
        { field: "actor", op: "is_any_of", values: ["agent"] },
        { field: "time", op: "is_any_of", values: ["weekend"] },
        { field: "action", op: "is_any_of", values: ["propose_page", "propose_change"] },
      ],
      { effect: "two_approvers" },
      "monitor",
    ),
  },
];

let rules: Stored[] = [];
let nextId = 6;
let holds: (Omit<HoldRow, "canDecide"> & { by: string })[] = [];
let incident: {
  on: boolean;
  since: number | null;
  until: number | null;
  pending: Stored["pending"];
} = {
  on: false,
  since: null,
  until: null,
  pending: null,
};

function reset(): void {
  nextId = 6;
  rules = SEEDS.map((s) => {
    const at = NOW0 - (s.ageMs ?? s.ageDays * DAY);
    return {
      id: s.id,
      createdAt: at,
      versions: [
        { version: 1, body: clone(s.body), by: "system", at, changes: diffRules(null, s.body) },
      ],
      draft: null,
      editedBy: "system",
      editedAt: at,
      pending: null,
    };
  });
  holds = [
    {
      id: "h_1",
      rule: "r_3@1",
      action: "export",
      brain: { id: "c_bid", label: labelOf("c_bid") },
      requestedAt: iso(NOW0 - 40 * MIN),
      required: 1,
      approvals: 0,
      group: [],
      mine: false,
      by: "u_consultant",
    },
    {
      id: "h_2",
      rule: "r_3@1",
      action: "export",
      brain: { id: "c_bid", label: labelOf("c_bid") },
      requestedAt: iso(NOW0 - 12 * MIN),
      required: 1,
      approvals: 0,
      group: [],
      mine: true,
      by: "me",
    },
  ];
  incident = { on: false, since: null, until: null, pending: null };
}
reset();
/** For tests: start again from the seed. */
export const resetRulesMock = reset;

const live = (r: Stored): Version | null => r.versions[r.versions.length - 1] ?? null;
const bodyOf = (r: Stored): RuleDraft => r.draft ?? (live(r) as Version).body;
const liveBody = (r: Stored): RuleDraft => live(r)?.body ?? (r.draft as RuleDraft);

function scopeLabel(s: RuleDraft["scope"]): string {
  if (s.kind === "tenant") return "Whole tenant";
  if (s.kind === "brain_types") {
    const n = s.types.map((t) => t[0]?.toUpperCase() + t.slice(1));
    return `${n.length > 1 ? `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}` : n[0]} brains`;
  }
  return s.ids.map(labelOf).join(", ");
}

const reaches = (r: Stored, brainId: string): boolean => {
  const b = brainOf(brainId);
  return !!b && scopeReaches(liveBody(r).scope, { id: b.id, type: b.type });
};
const editableBy = (r: Stored, v: Viewer): boolean => {
  if (v.admin) return true;
  const s = bodyOf(r).scope;
  return s.kind === "brains" && s.ids.length > 0 && s.ids.every((id) => v.brains.has(id));
};
const visibleTo = (r: Stored, v: Viewer): boolean =>
  v.admin || editableBy(r, v) || [...v.brains].some((id) => reaches(r, id));

function rowOf(r: Stored, v: Viewer): RuleRow {
  const published = live(r);
  const shown = published ? published.body : (r.draft as RuleDraft);
  return {
    id: r.id,
    name: shown.name,
    scope: clone(shown.scope),
    scopeLabel: scopeLabel(shown.scope),
    status: published ? published.body.status : "draft",
    version: published?.version ?? 0,
    effect: shown.then.effect,
    updatedAt: iso(r.editedAt),
    updatedBy: r.editedBy,
    hasDraft: !!r.draft && (!published || !same(r.draft, published.body)),
    editable: editableBy(r, v),
  };
}

function floorRow(): RuleRow {
  return {
    id: "floor:mcp_review",
    name: "Agent proposals in shared brains need review",
    scope: { kind: "tenant" },
    scopeLabel: "Whole tenant",
    status: "enforced",
    version: 0,
    effect: "review",
    updatedAt: iso(NOW0 - 90 * DAY),
    updatedBy: "system",
    hasDraft: false,
    editable: false,
    readOnly: true,
    floor: "mcp_review" as FloorId,
  };
}

/** A short hash of a draft, as the API hands it out: publishing names the draft that was reviewed. */
function hashOf(d: RuleDraft): string {
  const text = JSON.stringify(d);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h.toString(16);
}

/** Same rule as the API: the live scope or the new one reaches a protected brain, or the change weakens a live rule. */
function needsTwo(live: RuleDraft | null, next: RuleDraft): boolean {
  return (
    affectsProtectedBrains(next.scope, isProtected) ||
    (live !== null && affectsProtectedBrains(live.scope, isProtected)) ||
    weakensRule(live, next)
  );
}

function detailOf(r: Stored, v: Viewer): RuleDetail {
  const published = live(r);
  const draft = bodyOf(r);
  const history: VersionRow[] = [...r.versions]
    .sort((a, b) => b.version - a.version)
    .map((x) => ({
      version: x.version,
      status: x.body.status,
      by: x.by,
      at: iso(x.at),
      ...(x.rolledBackFrom != null ? { rolledBackFrom: x.rolledBackFrom } : {}),
      changes: clone(x.changes),
    }));
  return {
    ...rowOf(r, v),
    draft: clone(draft),
    published: published ? clone(published.body) : null,
    nextVersion: (published?.version ?? 0) + 1,
    editedBy: r.editedBy,
    editedAt: iso(r.editedAt),
    needsSecond: needsTwo(published?.body ?? null, draft),
    draftHash: hashOf(draft),
    pending: r.pending
      ? {
          by: r.pending.by,
          at: iso(r.pending.at),
          kind: r.pending.kind,
          version: r.pending.version,
        }
      : null,
    history,
  };
}

// ---------- the synthetic receipts the simulator replays ----------

const ANCHOR = Date.UTC(2026, 10, 6, 15, 0); // Friday 10:00 in Toronto
const TZ = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Toronto",
  weekday: "short",
  hour: "2-digit",
  hourCycle: "h23",
});
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function torontoParts(ms: number): { weekday: number; hour: number } {
  const parts = TZ.formatToParts(new Date(ms));
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const hr = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  return { weekday: Math.max(0, WEEKDAY.indexOf(wd)), hour: hr % 24 };
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const weighted = <T>(r: () => number, items: readonly (readonly [T, number])[]): T => {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let x = r() * total;
  for (const [v, w] of items) {
    x -= w;
    if (x < 0) return v;
  }
  return items[0]?.[0] as T;
};

interface MockEvent extends SimEvent {
  /** How long ago, in ms, relative to the moment the app loaded. */
  age: number;
}
function genEvents(): MockEvent[] {
  const r = mulberry32(hash("v7-rules-events"));
  const out: MockEvent[] = [];
  for (let h = 0; h < 30 * 24; h++) {
    const slot = ANCHOR - h * HOUR;
    const tp = torontoParts(slot);
    const business = tp.weekday >= 1 && tp.weekday <= 5 && tp.hour >= 8 && tp.hour < 18;
    const weekend = tp.weekday === 0 || tp.weekday === 6;
    const n = Math.floor(r() * (business ? 6.4 : weekend ? 1.6 : 1.2));
    for (let i = 0; i < n; i++) {
      const offset = Math.floor(r() * HOUR);
      const brain = weighted(r, [
        ["c_bid", 36],
        ["core", 14],
        ["a_acme", 20],
        ["c_delivery", 20],
        ["c_sales", 10],
      ] as const);
      const b = brainOf(brain);
      if (!b) continue;
      const kind = weighted(r, [
        ["human", 55],
        ["agent", 40],
        ["connector", 5],
      ] as const);
      const host =
        kind === "agent"
          ? weighted(r, [
              ["claude", 45],
              ["chatgpt", 15],
              ["dust", 20],
              ["codex", 10],
              ["copilot", 10],
            ] as const)
          : null;
      const action = weighted(r, [
        ["propose_page", 25],
        ["propose_change", 20],
        ["publish", 12],
        ["export", 10],
        ["promote_to_global", brain === "core" ? 6 : 0],
        ["import", 6],
        ["write_session_report", 14],
        ["share_view", 10],
      ] as const);
      const pick = (p: number) => r() < p;
      const flags = (
        [
          ["personal_data", 0.06],
          ["client_name", 0.08],
          ["confidential_field", 0.05],
          ["unsupported_claim", 0.07],
        ] as const
      )
        .filter(([, p]) => pick(p))
        .map(([f]) => f);
      const pages = action === "export" ? 1 + Math.floor(r() * 130) : 1 + Math.floor(r() * 40);
      const contract =
        b.type === "account"
          ? weighted(r, [
              ["allowed", 50],
              ["unknown", 30],
              ["not_allowed", 20],
            ] as const)
          : null;
      out.push({
        at: 0,
        age: ANCHOR - slot + offset,
        actor: { kind, host, roles: [] },
        action,
        brain: { id: b.id, type: b.type },
        flags,
        pages,
        contract,
        time: torontoParts(slot - offset),
        baseDenied: pick(0.03),
      });
    }
  }
  return out;
}
let events: MockEvent[] | null = null;

function simulate(draft: RuleDraft, days: 7 | 30, v: Viewer): SimulationView {
  events ??= genEvents();
  const now = Date.now();
  const window = events
    .filter((e) => e.age < days * DAY && v.brains.has(e.brain.id))
    .map((e) => ({ ...e, at: now - e.age }));
  const res = simulateRules(draft, window, { days, sampleSize: 5 });
  return {
    days,
    total: res.total,
    matches: res.matches,
    split: res.split,
    samples: res.samples.map((s) => ({
      at: iso(s.at),
      actor: { kind: s.actor.kind, host: s.actor.host ?? null },
      action: s.action,
      brain: v.brains.has(s.brainId)
        ? { id: s.brainId, label: labelOf(s.brainId) }
        : { id: "restricted", label: "" },
      effect: s.effect as RuleEffect,
    })),
    addedWaitMin: res.addedWaitMin,
    approvalsPerDay: res.approvalsPerDay,
    estimate: true,
  };
}

// ---------- the handler ----------

const refused = (issues: unknown) =>
  new ApiError(422, "The rule was refused.", { error: "rule_refused", issues });
const notFound = () => new ApiError(404, "Not found.", { error: "not_found" });

function cleanDraft(input: unknown): RuleDraft {
  const r = validateRule(input);
  if (!r.ok) throw refused(r.issues);
  return r.rule;
}
function mayWrite(r: Stored | null, scope: RuleDraft["scope"], v: Viewer): void {
  if (r && !editableBy(r, v))
    throw new ApiError(403, "You cannot change this rule.", { error: "forbidden" });
  if (!v.admin && !(scope.kind === "brains" && scope.ids.every((id) => v.brains.has(id))))
    throw new ApiError(403, "You may only set rules for brains you steward.", {
      error: "scope_not_allowed",
    });
}

/** The two-person step. "done" completes it; otherwise the pending state is recorded and returned. */
function secondPerson(
  holder: { pending: Stored["pending"] },
  kind: "publish" | "rollback",
  version: number,
): "done" | { sameActor: boolean } {
  const p =
    holder.pending && holder.pending.kind === kind && holder.pending.version === version
      ? holder.pending
      : null;
  if (p?.by === "other") return "done";
  if (flag(SECOND_KEY)) {
    clearFlag(SECOND_KEY);
    return "done";
  }
  if (p?.by === "you") return { sameActor: true };
  const by = flag(OTHER_KEY) ? "other" : "you";
  if (by === "other") clearFlag(OTHER_KEY);
  holder.pending = { by, at: Date.now(), kind, version };
  return { sameActor: false };
}

function counts(visible: Stored[]): RulesList["counts"] {
  const since = NOW0 - 30 * DAY;
  const st = (r: Stored) => (live(r) ? (live(r) as Version).body.status : "draft");
  return {
    total: visible.length,
    enforced: visible.filter((r) => st(r) === "enforced").length,
    monitor: visible.filter((r) => st(r) === "monitor").length,
    draft: visible.filter((r) => st(r) === "draft").length,
    new: visible.filter((r) => r.createdAt >= since).length,
    since: iso(since),
  };
}

function incidentState(): IncidentState {
  if (incident.on && incident.until && Date.now() > incident.until)
    incident = { on: false, since: null, until: null, pending: null };
  return {
    on: incident.on,
    since: incident.since ? iso(incident.since) : null,
    until: incident.until ? iso(incident.until) : null,
    ...(incident.pending ? { by: incident.pending.by } : {}),
    pending: !!incident.pending,
  };
}

function holdsFor(v: Viewer): HoldRow[] {
  return holds
    .filter((h) => v.admin || v.brains.has(h.brain.id))
    .map(({ by: _by, ...h }) => ({
      ...h,
      canDecide: !h.mine && (v.admin || v.brains.has(h.brain.id)),
    }));
}

export function handleRules(
  method: "GET" | "POST" | "PUT" | "DELETE",
  p: string,
  search: URLSearchParams,
  b: Record<string, unknown>,
  role: string,
): unknown {
  if (p !== "/v1/rules" && !p.startsWith("/v1/rules/")) return NOT_HANDLED;
  const v = viewerOf(role);
  // A person who is neither an admin nor a steward of any brain: the surface does not exist.
  if (!v.admin && v.brains.size === 0) throw notFound();
  const rest = p.slice("/v1/rules".length).replace(/^\//, "");

  if (rest === "" && method === "GET") {
    const brain = search.get("brain");
    if (brain && (!brainOf(brain) || !v.brains.has(brain))) throw notFound();
    const visible = rules
      .filter((r) => (brain ? reaches(r, brain) : visibleTo(r, v)))
      .sort((a, c) => Number(a.id.slice(2)) - Number(c.id.slice(2)));
    return {
      canEdit: true,
      brain: brain ? { id: brain, label: labelOf(brain) } : null,
      rules: [floorRow(), ...visible.map((r) => rowOf(r, v))],
      counts: counts(visible),
      incident: incidentState(),
      holds: holdsFor(v),
    } satisfies RulesList;
  }
  if (rest === "" && method === "POST") {
    const draft = cleanDraft(b);
    mayWrite(null, draft.scope, v);
    const now = Date.now();
    const r: Stored = {
      id: `r_${nextId++}`,
      createdAt: now,
      versions: [],
      draft,
      editedBy: v.by,
      editedAt: now,
      pending: null,
    };
    rules.push(r);
    return detailOf(r, v);
  }
  if (rest === "validate" && method === "POST") {
    const draft = cleanDraft(b);
    return { ok: true, needsSecond: affectsProtectedBrains(draft.scope, isProtected) };
  }
  if (rest === "simulate" && method === "POST") {
    const draft = cleanDraft(b.rule);
    return simulate(draft, b.days === 30 ? 30 : 7, v);
  }

  if (rest === "incident") {
    if (method === "GET") return incidentState();
    if (method === "PUT") {
      if (!v.admin)
        throw new ApiError(403, "Only admins change incident mode.", { error: "forbidden" });
      if (b.on === false) {
        incident = { on: false, since: null, until: null, pending: null };
        return incidentState();
      }
      const step = secondPerson(incident, "publish", 0);
      if (step === "done") {
        const now = Date.now();
        incident = { on: true, since: now, until: now + DAY, pending: null };
      }
      return incidentState();
    }
  }
  if (rest === "holds" && method === "GET") return holdsFor(v);
  const hold = /^holds\/([^/]+)\/decide$/.exec(rest);
  if (hold && method === "POST") {
    const h = holds.find((x) => x.id === decodeURIComponent(hold[1] ?? ""));
    if (!h || !(v.admin || v.brains.has(h.brain.id))) throw notFound();
    if (h.mine)
      throw new ApiError(403, "Someone else must decide your request.", { error: "forbidden" });
    if (b.decision === "reject") {
      holds = holds.filter((x) => x !== h);
      return { status: "rejected", approvals: h.approvals, required: h.required };
    }
    h.approvals += 1;
    if (h.approvals >= h.required) {
      holds = holds.filter((x) => x !== h);
      return { status: "approved", approvals: h.approvals, required: h.required };
    }
    return { status: "pending", approvals: h.approvals, required: h.required };
  }

  const m = /^([^/]+)(?:\/(publish|rollback))?$/.exec(rest);
  if (!m) return NOT_HANDLED;
  const r = rules.find((x) => x.id === decodeURIComponent(m[1] ?? ""));
  if (!r || !visibleTo(r, v)) throw notFound();
  const action = m[2];

  if (!action) {
    if (method === "GET") return detailOf(r, v);
    if (method === "PUT") {
      const draft = cleanDraft(b);
      mayWrite(r, draft.scope, v);
      const published = live(r);
      r.draft = published && same(draft, published.body) ? null : draft;
      r.editedBy = v.by;
      r.editedAt = Date.now();
      r.pending = null;
      return detailOf(r, v);
    }
    if (method === "DELETE") {
      mayWrite(r, bodyOf(r).scope, v);
      if (live(r))
        throw new ApiError(409, "A published rule cannot be deleted.", { error: "published" });
      rules = rules.filter((x) => x !== r);
      return null;
    }
  }

  if (action === "publish" && method === "POST") {
    mayWrite(r, bodyOf(r).scope, v);
    if (typeof b.expectedHash !== "string")
      throw new ApiError(400, "Name the draft you reviewed.", { error: "expected_hash_required" });
    if (b.expectedHash !== hashOf(bodyOf(r)))
      throw new ApiError(409, "The draft changed since you opened it. Review it again.", {
        error: "draft_changed",
      });
    const wanted = (b.status as string | undefined) ?? bodyOf(r).status;
    if (wanted !== "monitor" && wanted !== "enforced")
      throw new ApiError(400, "Choose Monitor or Enforced to publish.", { error: "choose_status" });
    const next = cleanDraft({ ...bodyOf(r), status: wanted });
    const version = (live(r)?.version ?? 0) + 1;
    const needs = needsTwo(live(r)?.body ?? null, next);
    if (needs) {
      const step = secondPerson(r, "publish", version);
      if (step !== "done") {
        return {
          status: "pending",
          needs: "second_person",
          rule: detailOf(r, v),
          ...(step.sameActor ? { sameActor: true } : {}),
        } satisfies PublishResult;
      }
    }
    const now = Date.now();
    r.versions.push({
      version,
      body: next,
      by: v.by,
      at: now,
      changes: diffRules(live(r)?.body ?? null, next),
    });
    r.draft = null;
    r.pending = null;
    r.editedBy = v.by;
    r.editedAt = now;
    return { status: "published", version, rule: detailOf(r, v) } satisfies PublishResult;
  }

  if (action === "rollback" && method === "POST") {
    mayWrite(r, liveBody(r).scope, v);
    const to = Number(b.toVersion);
    const old = r.versions.find((x) => x.version === to);
    if (!old || to === live(r)?.version)
      throw new ApiError(400, "Pick an older version.", { error: "bad_version" });
    const step = secondPerson(r, "rollback", to);
    if (step !== "done")
      return {
        status: "pending",
        needs: "second_person",
        rule: detailOf(r, v),
        ...(step.sameActor ? { sameActor: true } : {}),
      } satisfies PublishResult;
    const version = (live(r)?.version ?? 0) + 1;
    const now = Date.now();
    r.versions.push({
      version,
      body: clone(old.body),
      by: v.by,
      at: now,
      rolledBackFrom: to,
      changes: diffRules(live(r)?.body ?? null, old.body),
    });
    r.draft = null;
    r.pending = null;
    r.editedBy = v.by;
    r.editedAt = now;
    return { status: "published", version, rule: detailOf(r, v) } satisfies PublishResult;
  }
  return NOT_HANDLED;
}
