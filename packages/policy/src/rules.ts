// Brain rules (docs/DESIGN-V7-GOVERN-OPERATE.md section 1). Pure: no storage, no clock, no I/O.
//
// A rule is WHEN conditions (AND), a THEN effect, an optional EXCEPT and a lifecycle status. Rules
// compose AFTER the base policy: a base deny always wins and a rule can only tighten (add review,
// two approvers, a named approver group, a block, a notification or an expiry). Seven hard floors
// bound what a rule may do. A rule that would loosen one is refused at save with a reason
// (`validateRule`). The evaluator does NOT raise an effect to a floor at run time: the floors stay
// enforced by the base path, which stamps `Math.max(base required, rule required)` on every
// candidate. A caller must never read `RuleResult.effect` alone as the final answer.

import type { BrainType } from "./brains.ts";

// ---- vocabulary ----

export const RULE_ACTIONS = [
  "propose_page",
  "propose_change",
  "publish",
  "export",
  "promote_to_global",
  "import",
  "write_session_report",
  "share_view",
] as const;
export type RuleAction = (typeof RULE_ACTIONS)[number];

export const AGENT_HOSTS = ["claude", "chatgpt", "dust", "codex", "copilot"] as const;
export type AgentHost = (typeof AGENT_HOSTS)[number];
/** `agent` is any MCP host. `connector` is the SharePoint sync (a machine, never a person). */
export const ACTOR_VALUES = ["human", "agent", ...AGENT_HOSTS, "connector"] as const;
export type ActorValue = (typeof ACTOR_VALUES)[number];

export const CONTENT_FLAGS = [
  "personal_data",
  "client_name",
  "confidential_field",
  "unsupported_claim",
] as const;
export type ContentFlag = (typeof CONTENT_FLAGS)[number];

export const AI_CONTRACTS = ["allowed", "unknown", "not_allowed"] as const;
export type AiContract = (typeof AI_CONTRACTS)[number];

export const TIME_VALUES = ["weekdays", "weekend", "outside_business_hours"] as const;
export type TimeValue = (typeof TIME_VALUES)[number];

export const APPROVER_GROUPS = ["stewards", "privacy"] as const;
export type ApproverGroup = (typeof APPROVER_GROUPS)[number];

/** Brain roles and policy role ids a rule may name under "Actor role". */
export const ROLE_NAMES = [
  "reader",
  "contributor",
  "editor",
  "steward",
  "owner",
  "ceo",
  "head_bid",
  "acme_lead",
  "consultant",
  "reviewer",
  "platform_admin",
  "auditor",
] as const;

export const RULE_FIELDS = [
  "actor",
  "actor_role",
  "action",
  "brain",
  "brain_type",
  "content_flag",
  "size_pages",
  "ai_contract",
  "time",
] as const;
export type RuleField = (typeof RULE_FIELDS)[number];
export type RuleOp = "is_any_of" | "is_none_of" | "greater_than";

/** Which operators and values each field takes. The editor builds its selects from this. */
export const FIELD_SPEC: Record<
  RuleField,
  { ops: readonly RuleOp[]; values: readonly string[] | "brain_ids" | "number" }
> = {
  actor: { ops: ["is_any_of", "is_none_of"], values: ACTOR_VALUES },
  actor_role: { ops: ["is_any_of", "is_none_of"], values: ROLE_NAMES },
  action: { ops: ["is_any_of", "is_none_of"], values: RULE_ACTIONS },
  brain: { ops: ["is_any_of", "is_none_of"], values: "brain_ids" },
  brain_type: {
    ops: ["is_any_of", "is_none_of"],
    values: ["personal", "team", "account", "global"],
  },
  content_flag: { ops: ["is_any_of", "is_none_of"], values: CONTENT_FLAGS },
  size_pages: { ops: ["greater_than"], values: "number" },
  ai_contract: { ops: ["is_any_of", "is_none_of"], values: AI_CONTRACTS },
  time: { ops: ["is_any_of", "is_none_of"], values: TIME_VALUES },
};

export const RULE_EFFECTS = [
  "review",
  "two_approvers",
  "group",
  "block",
  "notify",
  "expire",
] as const;
export type RuleEffect = (typeof RULE_EFFECTS)[number];

/** Higher is tighter. `expire` is a grant time-limit: it adds no wait, so it ranks with nothing. */
export const EFFECT_RANK: Record<RuleEffect | "none", number> = {
  none: 0,
  expire: 1,
  notify: 2,
  review: 3,
  group: 4,
  two_approvers: 5,
  block: 6,
};
export const needsApproval = (e: RuleEffect | "none"): boolean =>
  e === "review" || e === "group" || e === "two_approvers";

export type RuleStatus = "draft" | "monitor" | "enforced";
export type RuleScope =
  | { kind: "tenant" }
  | { kind: "brain_types"; types: BrainType[] }
  | { kind: "brains"; ids: string[] };

export interface Condition {
  field: RuleField;
  op: RuleOp;
  values: string[];
}
export interface RuleThen {
  effect: RuleEffect;
  /** For `group`: the named approver groups. Optional note for `review` and `two_approvers`. */
  approvers?: ApproverGroup[];
  /** For `expire`: minutes an agent write grant lasts. */
  expiresAfterMin?: number;
  /** For `block`: shown to the person (and the agent) who is refused. */
  message?: string;
}
export interface RuleExcept {
  /** While incident mode is on, the effect becomes "allow and notify" (never below a floor). */
  incident: boolean;
}
/** What a person edits. `status` is the status the next publish will give. */
export interface RuleDraft {
  name: string;
  scope: RuleScope;
  when: Condition[];
  then: RuleThen;
  except: RuleExcept;
  status: RuleStatus;
}
/** A published version, as the evaluator reads it. */
export interface RuleDoc extends RuleDraft {
  id: string;
  version: number;
}

// ---- hard floors ----

export const FLOOR_IDS = [
  "personal_privacy",
  "nda_named_grants",
  "global_two_person",
  "every_change_seen",
  "everyone_ban",
  "ai_gate",
  "mcp_review",
] as const;
export type FloorId = (typeof FLOOR_IDS)[number];

export const FLOOR_REASON: Record<FloorId, string> = {
  personal_privacy: "Personal Brains stay private: a rule cannot apply to them.",
  nda_named_grants: "NDA access stays with named grants: a rule cannot grant access.",
  global_two_person: "A release to Global always needs two approvers: a rule cannot lower that.",
  every_change_seen: "Every change must be seen before it is approved: a rule cannot skip that.",
  everyone_ban: "Account brains are never open to Everyone at Mantu: a rule cannot open them.",
  ai_gate: "The AI gate stays closed where the account contract does not allow AI.",
  mcp_review: "Agent writes in a shared brain always go through review: a rule cannot lower that.",
};

const WRITE_ACTIONS: readonly RuleAction[] = [
  "propose_page",
  "propose_change",
  "write_session_report",
  "import",
  "promote_to_global",
];
const SHARED: readonly BrainType[] = ["team", "account", "global"];

/** What the situation at run time looks like to the floors. */
export interface FloorSituation {
  action: RuleAction;
  actor: ActorValue;
  brainType: BrainType;
  contract: AiContract | null;
}

/** The weakest effect a rule may leave standing in this situation, and the floor that says so. */
export function floorMin(s: FloorSituation): { rank: number; floor: FloorId | null } {
  let best: { rank: number; floor: FloorId | null } = { rank: 0, floor: null };
  const take = (rank: number, floor: FloorId) => {
    if (rank > best.rank) best = { rank, floor };
  };
  const isAgent = s.actor !== "human" && s.actor !== "connector";
  if (s.action === "promote_to_global" || (s.brainType === "global" && s.action === "publish"))
    take(EFFECT_RANK.two_approvers, "global_two_person");
  if (s.action === "publish" && SHARED.includes(s.brainType))
    take(EFFECT_RANK.review, "every_change_seen");
  if (isAgent && s.contract === "not_allowed") take(EFFECT_RANK.block, "ai_gate");
  if (isAgent && SHARED.includes(s.brainType) && WRITE_ACTIONS.includes(s.action))
    take(EFFECT_RANK.review, "mcp_review");
  return best;
}

/** Effect kinds a caller might send that would loosen something. Each maps to the floor it breaks. */
const LOOSENING: Record<string, FloorId | "tighten_only"> = {
  allow: "tighten_only",
  skip_review: "mcp_review",
  bypass_review: "mcp_review",
  auto_approve: "every_change_seen",
  skip_seen: "every_change_seen",
  grant_access: "nda_named_grants",
  open_to_everyone: "everyone_ban",
  bypass_ai_gate: "ai_gate",
};

// ---- context and evaluation ----

export interface RuleContext {
  /** What the base policy decided. A deny always wins: the rules add nothing. */
  base: "allow" | "deny";
  action: RuleAction;
  actor: { kind: "human" | "agent" | "connector"; host?: AgentHost | null; roles: string[] };
  brain: { id: string; type: BrainType };
  flags: ContentFlag[];
  pages?: number | null;
  contract?: AiContract | null;
  /** The moment, already in the tenant time zone: 0 is Sunday. */
  time: { weekday: number; hour: number };
  incident: boolean;
  rules: RuleDoc[];
  /** The save-time floor check asks about one literal action, not the action as a promotion too. */
  literalAction?: boolean;
}

export interface RuleMatch {
  ruleId: string;
  version: number;
  effect: RuleEffect;
  mode: "enforced" | "monitor";
}
export interface RuleResult {
  /** The tightest enforced effect that matched, or "none". */
  effect: RuleEffect | "none";
  ruleId: string | null;
  version: number | null;
  /** `ruleId@version` of the deciding rule, for the audit receipt. */
  tag: string | null;
  message: string | null;
  approvers: ApproverGroup[];
  /** Approvals a proposal needs because of the rule (0 when the rules add none). */
  requiredApprovals: number;
  /** Smallest `expire` limit among enforced matches, in minutes. */
  expiresAfterMin: number | null;
  /** Monitor-mode rules that matched: logged, never enforced. */
  would: RuleMatch[];
  /** Set when the base policy denied: nothing was evaluated. */
  baseDenied: boolean;
  /** A floor raised or held the effect (an EXCEPT or an old rule could not lower it). */
  floor: FloorId | null;
}

const NONE: RuleResult = {
  effect: "none",
  ruleId: null,
  version: null,
  tag: null,
  message: null,
  approvers: [],
  requiredApprovals: 0,
  expiresAfterMin: null,
  would: [],
  baseDenied: false,
  floor: null,
};

export const ruleTag = (id: string, version: number): string => `${id}@${version}`;

export const isWeekend = (weekday: number): boolean => weekday === 0 || weekday === 6;
const BUSINESS_FROM = 8;
const BUSINESS_TO = 18;
export const isOutsideBusinessHours = (t: { weekday: number; hour: number }): boolean =>
  isWeekend(t.weekday) || t.hour < BUSINESS_FROM || t.hour >= BUSINESS_TO;

const actorValues = (a: RuleContext["actor"]): string[] =>
  a.kind === "human"
    ? ["human"]
    : a.kind === "connector"
      ? ["connector"]
      : ["agent", ...(a.host ? [a.host] : [])];

const timeValues = (t: RuleContext["time"]): string[] => [
  isWeekend(t.weekday) ? "weekend" : "weekdays",
  ...(isOutsideBusinessHours(t) ? ["outside_business_hours"] : []),
];

/** Writes and releases that put content into a brain. Into Company Global each one is also a promotion. */
const INTO_GLOBAL: ReadonlySet<RuleAction> = new Set([
  "propose_page",
  "propose_change",
  "write_session_report",
  "import",
  "publish",
]);

/**
 * The action names a rule may match for this action. One place decides it, so every path into
 * Company Global (wiki, push, import, engine, release) meets a rule written for `promote_to_global`
 * whatever the caller called its action.
 */
export function actionsOf(action: RuleAction, brainType: BrainType): RuleAction[] {
  return brainType === "global" && INTO_GLOBAL.has(action)
    ? [action, "promote_to_global"]
    : [action];
}

/** True when one condition holds in the context. A missing value never matches "is any of". */
export function conditionHolds(c: Condition, ctx: Omit<RuleContext, "rules" | "base">): boolean {
  if (c.field === "size_pages") {
    const n = Number(c.values[0]);
    return ctx.pages != null && Number.isFinite(n) && ctx.pages > n;
  }
  let have: string[];
  switch (c.field) {
    case "actor":
      have = actorValues(ctx.actor);
      break;
    case "actor_role":
      have = ctx.actor.roles;
      break;
    case "action":
      have = ctx.literalAction ? [ctx.action] : actionsOf(ctx.action, ctx.brain.type);
      break;
    case "brain":
      have = [ctx.brain.id];
      break;
    case "brain_type":
      have = [ctx.brain.type];
      break;
    case "content_flag":
      have = ctx.flags;
      break;
    case "ai_contract":
      have = ctx.contract ? [ctx.contract] : [];
      break;
    default:
      have = timeValues(ctx.time);
  }
  const hit = have.some((v) => c.values.includes(v));
  return c.op === "is_none_of" ? !hit : hit;
}

/** Does the rule's scope reach this brain? A rule never reaches a Personal Brain. */
export function scopeReaches(scope: RuleScope, brain: { id: string; type: BrainType }): boolean {
  if (brain.type === "personal") return false;
  if (scope.kind === "tenant") return true;
  if (scope.kind === "brain_types") return scope.types.includes(brain.type);
  return scope.ids.includes(brain.id);
}

export const ruleMatches = (r: RuleDraft, ctx: Omit<RuleContext, "rules" | "base">): boolean =>
  scopeReaches(r.scope, ctx.brain) && r.when.every((c) => conditionHolds(c, ctx));

const actorForFloor = (a: RuleContext["actor"]): ActorValue =>
  a.kind === "human" ? "human" : a.kind === "connector" ? "connector" : (a.host ?? "agent");

/**
 * Evaluate the published rules for one action. Composed after the base policy: a base deny returns
 * "none" with `baseDenied` (the caller keeps the deny). The tightest matching enforced effect wins;
 * ties go to the lower rule id so the answer never depends on storage order. A monitor rule that
 * matches is listed in `would` and changes nothing.
 */
export function evaluateRules(ctx: RuleContext): RuleResult {
  if (ctx.base === "deny") return { ...NONE, baseDenied: true, would: [] };
  const situation: FloorSituation = {
    action: ctx.action,
    actor: actorForFloor(ctx.actor),
    brainType: ctx.brain.type,
    contract: ctx.contract ?? null,
  };
  const floor = floorMin(situation);
  const would: RuleMatch[] = [];
  let win: { doc: RuleDoc; effect: RuleEffect; held: boolean } | null = null;
  let expiry: number | null = null;
  // Every enforced rule that asks for approval adds to the ask: approver groups are united and the
  // number of approvals is the highest, so a tighter rule never drops another rule's group.
  const approvers = new Set<ApproverGroup>();
  let required = 0;
  for (const doc of [...ctx.rules].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (doc.status === "draft" || !ruleMatches(doc, ctx)) continue;
    let effect = doc.then.effect;
    let held = false;
    if (ctx.incident && doc.except.incident) {
      // The exception never takes a rule below a floor.
      if (EFFECT_RANK.notify >= floor.rank) effect = "notify";
      else held = true;
    }
    if (doc.status === "monitor") {
      would.push({ ruleId: doc.id, version: doc.version, effect, mode: "monitor" });
      continue;
    }
    if (effect === "expire" && doc.then.expiresAfterMin != null)
      expiry =
        expiry === null ? doc.then.expiresAfterMin : Math.min(expiry, doc.then.expiresAfterMin);
    if (needsApproval(effect)) {
      required = Math.max(required, effect === "two_approvers" ? 2 : 1);
      for (const g of doc.then.approvers ?? []) if (effect === "group") approvers.add(g);
    }
    if (!win || EFFECT_RANK[effect] > EFFECT_RANK[win.effect]) win = { doc, effect, held };
  }
  if (!win) return { ...NONE, would };
  const { doc, effect } = win;
  return {
    effect,
    ruleId: doc.id,
    version: doc.version,
    tag: ruleTag(doc.id, doc.version),
    message: effect === "block" ? (doc.then.message ?? null) : null,
    approvers: needsApproval(effect) ? [...approvers] : [],
    requiredApprovals: needsApproval(effect) ? required : 0,
    expiresAfterMin: expiry,
    would,
    baseDenied: false,
    floor: win.held ? floor.floor : null,
  };
}

// ---- validation ----

export interface RuleIssue {
  code: string;
  /** Dot path of the part of the rule at fault. */
  path: string;
  message: string;
  /** Set when the rule was refused because it would loosen this floor. */
  floor?: FloorId;
}
export type RuleValidation = { ok: true; rule: RuleDraft } | { ok: false; issues: RuleIssue[] };

const MAX_CONDITIONS = 8;
const MAX_VALUES = 20;
const BRAIN_ID = /^[a-z0-9][a-z0-9_.:-]{0,127}$/;
export const isPersonalBrainId = (id: string): boolean => id === "me" || id.startsWith("pb:");

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const strs = (v: unknown): string[] | null =>
  Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null;

function parseScope(v: unknown, issues: RuleIssue[]): RuleScope | null {
  const o = obj(v);
  if (!o) {
    issues.push({ code: "invalid_scope", path: "scope", message: "Choose where the rule applies" });
    return null;
  }
  if (o.kind === "tenant") return { kind: "tenant" };
  if (o.kind === "brain_types") {
    const t = strs(o.types);
    const ok = ["personal", "team", "account", "global"];
    if (!t?.length || !t.every((x) => ok.includes(x))) {
      issues.push({ code: "invalid_scope", path: "scope.types", message: "Choose brain types" });
      return null;
    }
    if (t.includes("personal")) {
      issues.push({
        code: "floor",
        path: "scope.types",
        message: FLOOR_REASON.personal_privacy,
        floor: "personal_privacy",
      });
      return null;
    }
    return { kind: "brain_types", types: [...new Set(t)] as BrainType[] };
  }
  if (o.kind === "brains") {
    const ids = strs(o.ids);
    if (
      !ids?.length ||
      ids.length > MAX_VALUES ||
      !ids.every((x) => BRAIN_ID.test(x) || isPersonalBrainId(x))
    ) {
      issues.push({
        code: "invalid_scope",
        path: "scope.ids",
        message: "Choose one or more brains",
      });
      return null;
    }
    if (ids.some(isPersonalBrainId)) {
      issues.push({
        code: "floor",
        path: "scope.ids",
        message: FLOOR_REASON.personal_privacy,
        floor: "personal_privacy",
      });
      return null;
    }
    return { kind: "brains", ids: [...new Set(ids)] };
  }
  issues.push({ code: "invalid_scope", path: "scope", message: "Choose where the rule applies" });
  return null;
}

function parseCondition(v: unknown, i: number, issues: RuleIssue[]): Condition | null {
  const path = `when.${i}`;
  const o = obj(v);
  const field = o?.field;
  if (!o || typeof field !== "string" || !(RULE_FIELDS as readonly string[]).includes(field)) {
    issues.push({ code: "invalid_condition", path, message: "Choose what to check" });
    return null;
  }
  const spec = FIELD_SPEC[field as RuleField];
  if (typeof o.op !== "string" || !(spec.ops as readonly string[]).includes(o.op)) {
    issues.push({
      code: "invalid_operator",
      path: `${path}.op`,
      message: "That check does not fit this field",
    });
    return null;
  }
  const values = strs(o.values);
  if (!values?.length || values.length > MAX_VALUES) {
    issues.push({
      code: "invalid_values",
      path: `${path}.values`,
      message: "Add at least one value",
    });
    return null;
  }
  const clean = [...new Set(values.map((x) => x.trim()).filter(Boolean))];
  if (spec.values === "number") {
    const n = Number(clean[0]);
    if (clean.length !== 1 || !Number.isInteger(n) || n < 0 || n > 100_000) {
      issues.push({
        code: "invalid_values",
        path: `${path}.values`,
        message: "Enter a whole number of pages",
      });
      return null;
    }
  } else if (spec.values === "brain_ids") {
    if (!clean.length || !clean.every((x) => BRAIN_ID.test(x) || isPersonalBrainId(x))) {
      issues.push({ code: "invalid_values", path: `${path}.values`, message: "Choose brains" });
      return null;
    }
  } else if (!clean.length || !clean.every((x) => (spec.values as readonly string[]).includes(x))) {
    issues.push({
      code: "invalid_values",
      path: `${path}.values`,
      message: "That value does not fit this field",
    });
    return null;
  }
  return { field: field as RuleField, op: o.op as RuleOp, values: clean };
}

function parseThen(v: unknown, issues: RuleIssue[]): RuleThen | null {
  const o = obj(v);
  const effect = o?.effect;
  if (!o || typeof effect !== "string") {
    issues.push({ code: "invalid_effect", path: "then.effect", message: "Choose what happens" });
    return null;
  }
  const loose = Object.hasOwn(LOOSENING, effect) ? LOOSENING[effect] : undefined;
  if (loose) {
    issues.push({
      code: loose === "tighten_only" ? "loosens_policy" : "floor",
      path: "then.effect",
      message:
        loose === "tighten_only"
          ? "A rule can only tighten the policy: it cannot allow something the policy denies."
          : FLOOR_REASON[loose],
      ...(loose === "tighten_only" ? {} : { floor: loose }),
    });
    return null;
  }
  if (!(RULE_EFFECTS as readonly string[]).includes(effect)) {
    issues.push({ code: "invalid_effect", path: "then.effect", message: "Choose what happens" });
    return null;
  }
  const then: RuleThen = { effect: effect as RuleEffect };
  if (effect === "group") {
    const g = strs(o.approvers);
    if (!g?.length || !g.every((x) => (APPROVER_GROUPS as readonly string[]).includes(x))) {
      issues.push({
        code: "invalid_approvers",
        path: "then.approvers",
        message: "Choose an approver group",
      });
      return null;
    }
    then.approvers = [...new Set(g)] as ApproverGroup[];
  }
  if (effect === "expire") {
    const n = o.expiresAfterMin;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 1440) {
      issues.push({
        code: "invalid_expiry",
        path: "then.expiresAfterMin",
        message: "Enter minutes, 1 to 1440",
      });
      return null;
    }
    then.expiresAfterMin = n;
  }
  if (effect === "block") {
    const m = typeof o.message === "string" ? o.message.trim() : "";
    if (!m || m.length > 200) {
      issues.push({
        code: "invalid_message",
        path: "then.message",
        message: "Write the message people will see (200 characters)",
      });
      return null;
    }
    then.message = m;
  }
  return then;
}

/** Every context shape the floors can tell apart, for the static check. Roles and brain ids are free. */
const SIM_ACTORS: RuleContext["actor"][] = [
  { kind: "human", roles: [] },
  ...AGENT_HOSTS.map((host) => ({ kind: "agent" as const, host, roles: [] })),
  { kind: "connector", roles: [] },
];
const SIM_BRAIN_TYPES: BrainType[] = ["team", "account", "global"];
const SIM_CONTRACTS: (AiContract | null)[] = [null, "allowed", "unknown", "not_allowed"];
const SIM_TIMES = [
  { weekday: 2, hour: 10 },
  { weekday: 2, hour: 22 },
  { weekday: 6, hour: 12 },
];
const SIM_FLAGS: ContentFlag[][] = Array.from({ length: 1 << CONTENT_FLAGS.length }, (_, m) =>
  CONTENT_FLAGS.filter((_f, i) => m & (1 << i)),
);

/**
 * Could this rule, in any situation it can match, leave an effect weaker than a floor allows? Roles and
 * a named brain are not knowable here, so a condition on them is assumed to hold (the cautious reading).
 */
function weakensFloor(r: RuleDraft): { floor: FloorId; action: RuleAction } | null {
  const conds = r.when.filter((c) => c.field !== "actor_role" && c.field !== "brain");
  const types = r.scope.kind === "brain_types" ? r.scope.types : SIM_BRAIN_TYPES;
  // A rule is refused when every situation it can match sits under a floor and its effect is weaker
  // than that floor asks: it is about the floor and lowers it. A broad rule that merely reaches into a
  // floor is accepted, because the evaluator never lets an effect (or the incident exception) take
  // a situation below its floor. `expire` is a time limit, never a decision. The incident exception
  // turns the effect into "allow and notify", so it is held to the same test.
  function allBelow(rank: number): { floor: FloorId; action: RuleAction } | null {
    let first: { floor: FloorId; action: RuleAction } | null = null;
    for (const actor of SIM_ACTORS)
      for (const action of RULE_ACTIONS)
        for (const type of types)
          for (const contract of SIM_CONTRACTS)
            for (const time of SIM_TIMES)
              for (const flags of SIM_FLAGS)
                for (const pages of [0, 100_000]) {
                  const ctx = {
                    action,
                    actor,
                    brain: { id: "x", type },
                    flags,
                    pages,
                    contract,
                    time,
                    incident: false,
                    literalAction: true,
                  };
                  if (!conds.every((c) => conditionHolds(c, ctx))) continue;
                  const f = floorMin({
                    action,
                    actor: actorForFloor(actor),
                    brainType: type,
                    contract,
                  });
                  if (!f.floor || rank >= f.rank) return null;
                  first ??= { floor: f.floor, action };
                }
    return first;
  }
  if (r.then.effect !== "expire") {
    const hit = allBelow(EFFECT_RANK[r.then.effect]);
    if (hit) return hit;
  }
  return r.except.incident ? allBelow(EFFECT_RANK.notify) : null;
}

/**
 * Check a rule a person sent. Returns the cleaned rule, or every reason it was refused. A rule that
 * would loosen a hard floor is refused with the floor named. Status and name are checked too.
 */
export function validateRule(input: unknown): RuleValidation {
  const issues: RuleIssue[] = [];
  const o = obj(input);
  if (!o)
    return { ok: false, issues: [{ code: "invalid_rule", path: "", message: "Send a rule" }] };
  const name = typeof o.name === "string" ? o.name.trim().replace(/\s+/g, " ") : "";
  if (name.length < 3 || name.length > 80)
    issues.push({
      code: "invalid_name",
      path: "name",
      message: "Name the rule in 3 to 80 characters",
    });
  const status = o.status ?? "draft";
  if (status !== "draft" && status !== "monitor" && status !== "enforced")
    issues.push({
      code: "invalid_status",
      path: "status",
      message: "Status is draft, monitor or enforced",
    });
  const scope = parseScope(o.scope, issues);
  const when: Condition[] = [];
  if (!Array.isArray(o.when) || o.when.length < 1 || o.when.length > MAX_CONDITIONS)
    issues.push({
      code: "invalid_when",
      path: "when",
      message: `Add 1 to ${MAX_CONDITIONS} conditions`,
    });
  else
    o.when.forEach((c, i) => {
      const p = parseCondition(c, i, issues);
      if (p) when.push(p);
    });
  const then = parseThen(o.then, issues);
  const ex = obj(o.except);
  if (o.except !== undefined && (!ex || typeof ex.incident !== "boolean"))
    issues.push({ code: "invalid_except", path: "except", message: "Except is on or off" });
  const except: RuleExcept = { incident: ex?.incident === true };
  // A condition on the brain type that only names Personal Brains makes the rule personal: refuse.
  for (const [i, c] of when.entries()) {
    if (
      (c.field === "brain_type" || c.field === "brain") &&
      c.op === "is_any_of" &&
      c.values.every((v) => (c.field === "brain_type" ? v === "personal" : isPersonalBrainId(v)))
    )
      issues.push({
        code: "floor",
        path: `when.${i}`,
        message: FLOOR_REASON.personal_privacy,
        floor: "personal_privacy",
      });
  }
  if (issues.length || !scope || !then) return { ok: false, issues };
  const rule: RuleDraft = { name, scope, when, then, except, status: status as RuleStatus };
  const weak = weakensFloor(rule);
  if (weak)
    return {
      ok: false,
      issues: [
        {
          code: "floor",
          path:
            except.incident && EFFECT_RANK[then.effect] > EFFECT_RANK.notify
              ? "except"
              : "then.effect",
          message: FLOOR_REASON[weak.floor],
          floor: weak.floor,
        },
      ],
    };
  return { ok: true, rule };
}

/** Can this rule touch an account, restricted or Global brain? Then publishing it needs a second person. */
export function affectsProtectedBrains(
  scope: RuleScope,
  isProtected: (brainId: string) => boolean,
): boolean {
  if (scope.kind === "tenant") return true;
  if (scope.kind === "brain_types")
    return scope.types.some((t) => t === "account" || t === "global");
  return scope.ids.some(isProtected);
}

/** Statuses from loosest to tightest. */
const STATUS_RANK: Record<RuleStatus, number> = { draft: 0, monitor: 1, enforced: 2 };

/**
 * Does publishing `next` over the currently enforced `published` loosen, narrow, disable or withdraw
 * it? Conservative: any change to the conditions, a scope that is not the same or the whole tenant,
 * an approver or expiry change at the same strength, a lower effect, a lower status or turning the
 * incident exception on counts. Only a rule that was enforcing or monitoring can be weakened.
 */
export function weakensRule(published: RuleDraft | null, next: RuleDraft): boolean {
  if (!published || published.status === "draft") return false;
  if (STATUS_RANK[next.status] < STATUS_RANK[published.status]) return true;
  const was = EFFECT_RANK[published.then.effect];
  const now = EFFECT_RANK[next.then.effect];
  if (now < was) return true;
  if (now === was && JSON.stringify(next.then) !== JSON.stringify(published.then)) return true;
  if (next.except.incident && !published.except.incident) return true;
  // Dropping a named approver group is weakening whatever the new effect ranks.
  const kept = next.then.approvers ?? [];
  if ((published.then.approvers ?? []).some((g) => !kept.includes(g))) return true;
  if (JSON.stringify(next.when) !== JSON.stringify(published.when)) return true;
  if (
    next.scope.kind !== "tenant" &&
    JSON.stringify(next.scope) !== JSON.stringify(published.scope)
  )
    return true;
  return false;
}

// ---- diff between two versions ----

export interface RuleChange {
  part: "name" | "scope" | "when" | "then" | "except" | "status";
  from: string;
  to: string;
}

const scopeText = (s: RuleScope): string =>
  s.kind === "tenant"
    ? "whole tenant"
    : s.kind === "brain_types"
      ? `types ${s.types.join(", ")}`
      : `brains ${s.ids.join(", ")}`;
const condText = (c: Condition): string =>
  `${c.field} ${c.op.replace(/_/g, " ")} ${c.values.join(", ")}`;
const thenText = (t: RuleThen): string =>
  [
    t.effect,
    t.approvers?.join("+"),
    t.expiresAfterMin != null ? `${t.expiresAfterMin} min` : null,
    t.message ? `"${t.message}"` : null,
  ]
    .filter(Boolean)
    .join(" ");

/** The parts that differ, as short strings. Content-free by construction. */
export function diffRules(a: RuleDraft | null, b: RuleDraft): RuleChange[] {
  const out: RuleChange[] = [];
  const add = (part: RuleChange["part"], from: string, to: string) => {
    if (from !== to) out.push({ part, from, to });
  };
  add("name", a?.name ?? "", b.name);
  add("scope", a ? scopeText(a.scope) : "", scopeText(b.scope));
  add("when", a ? a.when.map(condText).join(" AND ") : "", b.when.map(condText).join(" AND "));
  add("then", a ? thenText(a.then) : "", thenText(b.then));
  add("except", a ? String(a.except.incident) : "", String(b.except.incident));
  add("status", a?.status ?? "", b.status);
  return out;
}

// ---- simulation ----

/** One past action, ids and metadata only. */
export interface SimEvent {
  at: number;
  actor: RuleContext["actor"];
  action: RuleAction;
  brain: { id: string; type: BrainType };
  flags: ContentFlag[];
  pages?: number | null;
  contract?: AiContract | null;
  time: { weekday: number; hour: number };
  /** The base policy already refused it. Counted nowhere. */
  baseDenied?: boolean;
}
export interface SimSample {
  at: number;
  actor: RuleContext["actor"];
  action: RuleAction;
  brainId: string;
  effect: RuleEffect;
}
export interface SimResult {
  total: number;
  matches: number;
  split: { approval: number; blocked: number; allowed: number };
  samples: SimSample[];
  /** Estimated extra wait per approval, in minutes, and how many approvals a day that is. */
  addedWaitMin: number;
  approvalsPerDay: number;
  days: number;
}
/** Minutes a first approval typically takes, per effect. An estimate until the tenant has enough decisions. */
export const WAIT_ESTIMATE_MIN: Record<"review" | "group" | "two_approvers", number> = {
  review: 90,
  group: 150,
  two_approvers: 240,
};

/**
 * Replay past events against a draft. `others` are the other published rules: the draft counts an
 * event only when its own conditions match, so the number answers "what would THIS rule catch".
 */
export function simulateRules(
  draft: RuleDraft,
  events: readonly SimEvent[],
  opts: { days: number; incident?: boolean; sampleSize?: number } = { days: 7 },
): SimResult {
  const split = { approval: 0, blocked: 0, allowed: 0 };
  const samples: SimSample[] = [];
  let matches = 0;
  let wait = 0;
  const doc: RuleDoc = { ...draft, status: "enforced", id: "draft", version: 0 };
  const ordered = [...events].sort((a, b) => b.at - a.at);
  for (const e of ordered) {
    if (e.baseDenied) continue;
    const r = evaluateRules({
      base: "allow",
      action: e.action,
      actor: e.actor,
      brain: e.brain,
      flags: e.flags,
      pages: e.pages ?? null,
      contract: e.contract ?? null,
      time: e.time,
      incident: opts.incident === true,
      rules: [doc],
    });
    if (r.effect === "none") continue;
    matches++;
    if (r.effect === "block") split.blocked++;
    else if (needsApproval(r.effect)) {
      split.approval++;
      wait += WAIT_ESTIMATE_MIN[r.effect as "review" | "group" | "two_approvers"];
    } else split.allowed++;
    if (samples.length < (opts.sampleSize ?? 5))
      samples.push({
        at: e.at,
        actor: e.actor,
        action: e.action,
        brainId: e.brain.id,
        effect: r.effect,
      });
  }
  return {
    total: events.length,
    matches,
    split,
    samples,
    addedWaitMin: split.approval ? Math.round(wait / split.approval) : 0,
    approvalsPerDay: Math.round((split.approval / Math.max(1, opts.days)) * 10) / 10,
    days: opts.days,
  };
}
