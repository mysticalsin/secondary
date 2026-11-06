// The enforcement point of brain rules (docs/DESIGN-V7-GOVERN-OPERATE.md section 1). Every action that a
// rule can name goes through `ruleGate` after the base policy has said yes, so a rule only ever adds:
// review, two approvers, a named group, a block, a notice or an expiry. The effect is written on the
// audit receipt as `ruleId@version`. A monitor rule never changes the outcome: it writes a would-match.

import {
  type BrainType,
  type ContentFlag,
  canDoInView,
  evaluateRules,
  needsApproval,
  type RuleAction,
  type RuleResult,
  type ViewNode,
} from "@secondary/policy";
import type { ReceiptMeta } from "../../../../packages/contracts/src/audit-receipt.ts";
import type { workspaceStub } from "../stubs.ts";
import { notifyRule } from "../ux/notify.ts";
import { audit, type C, sess } from "../ux/util.ts";
import { rulesClient } from "./client.ts";
import { actorOf, brainTypeFor, contractOf, flagsOf, tenantTime } from "./context.ts";

export interface GateBrain {
  nodeId: string;
  personal: boolean;
  vn: ViewNode | null;
  /** The caller's stored role in the brain, when known (feeds "Actor role"). */
  role?: string | null;
}

export interface GateInput {
  action: RuleAction;
  brain: GateBrain;
  /** Text the action carries. Read for flags only; it is never stored or logged. */
  text?: string;
  cites?: number;
  pages?: number | null;
  flags?: ContentFlag[];
  /** "stamp": the action makes a proposal, so an approval effect becomes approvals on it.
   *  "hold": no proposal exists (export, share), so an approval effect holds the call until approved.
   *  "route": nothing to stamp or hold; only block and notify apply. */
  mode: "stamp" | "hold" | "route";
  actor?: "connector";
}

export interface GateOut {
  /** Set when the caller must answer with this and stop (blocked, or held for approval). */
  response: Response | null;
  result: RuleResult;
  /** Spread into the action's own audit receipt. */
  rx: { rule: string | null; ruleMode: "enforced" | null; meta: ReceiptMeta | null };
  /** Call once the proposal or candidate exists: records what the rule asked on it. */
  stamp: (stub: ReturnType<typeof workspaceStub>, itemId: string) => Promise<void>;
  /** True when the rules require review, so a direct publish must become a candidate. */
  forceReview: boolean;
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

const passthrough = (meta: ReceiptMeta | null): GateOut => ({
  response: null,
  result: NONE,
  rx: { rule: null, ruleMode: null, meta },
  stamp: async () => {},
  forceReview: false,
});

/** The replayable metadata of one action: enumerated labels, ids and counts, never content. */
function metaOf(
  i: GateInput,
  type: BrainType,
  actor: ReturnType<typeof actorOf>,
  flags: ContentFlag[],
  contract: ReceiptMeta["contract"],
  expiresAfterMin: number | null,
): ReceiptMeta {
  return {
    action: i.action,
    actor: i.actor === "connector" ? "connector" : actor.kind === "agent" ? "agent" : "human",
    host: actor.kind === "agent" ? (actor.host ?? null) : null,
    brainId: i.brain.nodeId,
    brainType: type,
    flags,
    pages: i.pages ?? null,
    contract,
    expiresAfterMin,
  };
}

export async function ruleGate(c: C, i: GateInput): Promise<GateOut> {
  const s = sess(c);
  const type = brainTypeFor(i.brain);
  // A rule never reaches a Personal Brain, and a node that is no brain carries no rule.
  if (!type || type === "personal") return passthrough(null);
  const actor =
    i.actor === "connector"
      ? { kind: "connector" as const, host: null, roles: [] as string[] }
      : actorOf(s);
  const roles = [...(s.principal.roleIds ?? []), ...(i.brain.role ? [i.brain.role] : [])];
  const flags = [
    ...new Set<ContentFlag>([
      ...(i.flags ?? []),
      ...(i.text !== undefined ? flagsOf(i.text, s.org, i.cites ?? 0) : []),
    ]),
  ];
  const contract = contractOf(i.brain.vn);
  const state = await rulesClient(c.env, s.tenantId).state(s.ctx.now);
  const result = evaluateRules({
    base: "allow",
    action: i.action,
    actor: { ...actor, roles },
    brain: { id: i.brain.nodeId, type },
    flags,
    pages: i.pages ?? null,
    contract,
    time: tenantTime(c.env, s.ctx.now),
    incident: state.incident,
    rules: state.docs,
  });
  const meta = metaOf(i, type, actor, flags, contract, result.expiresAfterMin);

  // Monitor mode: log what would have matched, change nothing.
  for (const w of result.would)
    await audit(c, {
      action: "rule.would_match",
      nodeId: i.brain.nodeId,
      scopeId: null,
      revision: null,
      reason: `would ${w.effect}`,
      rule: `${w.ruleId}@${w.version}`,
      ruleMode: "monitor",
      meta,
    });
  if (result.effect === "none" && result.expiresAfterMin === null) return passthrough(meta);

  const tag = result.tag;
  const rx = { rule: tag, ruleMode: "enforced" as const, meta };
  const base: GateOut = {
    response: null,
    result,
    rx,
    forceReview: needsApproval(result.effect),
    stamp: async (stub, itemId) => {
      if (needsApproval(result.effect) || result.expiresAfterMin !== null)
        await stub.brainRuleStamp(itemId, {
          required: result.requiredApprovals,
          group: result.approvers,
          tag: tag ?? "",
          expiresAfterMin: result.expiresAfterMin,
        });
    },
  };

  if (result.effect === "block") {
    const ok = await audit(c, {
      action: "rule.block",
      nodeId: i.brain.nodeId,
      scopeId: null,
      revision: null,
      decision: "deny",
      reason: "blocked by rule",
      ...rx,
    });
    if (!ok) return { ...base, response: c.json({ error: "audit_unavailable" }, 503) };
    return {
      ...base,
      response: c.json(
        { error: "blocked_by_rule", rule: tag, message: result.message ?? "Blocked by a rule" },
        403,
      ),
    };
  }

  if (needsApproval(result.effect) && i.mode === "hold") {
    const tenant = rulesClient(c.env, s.tenantId);
    const given = c.req.header("X-Rule-Hold");
    if (given) {
      const used = await tenant.holdUse(given, s.principal.id, i.action, i.brain.nodeId, s.ctx.now);
      if (!used.ok)
        return { ...base, response: c.json({ error: used.code, reason: used.message }, 409) };
      return base;
    }
    const id = await tenant.holdCreate({
      rule: tag ?? "",
      action: i.action,
      brainId: i.brain.nodeId,
      requestedBy: s.principal.id,
      required: result.requiredApprovals,
      group: result.approvers,
      now: s.ctx.now,
    });
    const ok = await audit(c, {
      action: "rule.hold",
      nodeId: i.brain.nodeId,
      scopeId: null,
      revision: null,
      decision: "deny",
      reason: "held for approval",
      ...rx,
    });
    if (!ok) return { ...base, response: c.json({ error: "audit_unavailable" }, 503) };
    await notifyRule(c, i.brain.nodeId, "An action is waiting for approval under a rule", id);
    return {
      ...base,
      response: c.json(
        {
          status: "needs_approval",
          holdId: id,
          rule: tag,
          required: result.requiredApprovals,
          group: result.approvers,
        },
        202,
      ),
    };
  }

  if (result.effect === "notify")
    await notifyRule(
      c,
      i.brain.nodeId,
      "A rule allowed an action here and asked to tell you",
      tag ?? "",
    );
  return base;
}

/** Is the approver in at least one of the rule's named groups? */
export async function approverInGroup(
  c: C,
  groups: readonly string[],
  nodeId: string,
  view: Parameters<typeof canDoInView>[0],
): Promise<boolean> {
  if (!groups.length) return true;
  const s = sess(c);
  if (
    groups.includes("stewards") &&
    canDoInView(view, s.principal, nodeId, "approve_release").allowed
  )
    return true;
  if (groups.includes("privacy")) {
    const members = await rulesClient(c.env, s.tenantId).groupGet();
    if (members.includes(s.principal.id)) return true;
  }
  return false;
}

/**
 * Before an approval: a rule published after the proposal can still block the publish or ask for more
 * approvals, and a rule's approver group limits who may approve. Returns the answer to give (or null)
 * and what to write on the decision's receipt.
 */
export async function ruleDecideGuard(
  c: C,
  w: {
    stub: ReturnType<typeof workspaceStub>;
    nodeId: string;
    personal: boolean;
    vn: ViewNode | null;
    view: Parameters<typeof canDoInView>[0];
  },
  itemId: string,
): Promise<{ response: Response | null; rx: GateOut["rx"] }> {
  const none = { response: null, rx: { rule: null, ruleMode: null, meta: null } };
  if (w.personal) return none;
  const g = await ruleGate(c, {
    action: "publish",
    brain: { nodeId: w.nodeId, personal: false, vn: w.vn },
    mode: "stamp",
  });
  if (g.response) return { response: g.response, rx: g.rx };
  await g.stamp(w.stub, itemId);
  const stamped = await w.stub.brainRuleOf(itemId);
  const groups = [...new Set([...(stamped?.group ?? []), ...g.result.approvers])];
  const rx = stamped
    ? { ...g.rx, rule: g.rx.rule ?? stamped.tag, ruleMode: "enforced" as const }
    : g.rx;
  if (groups.length && !(await approverInGroup(c, groups, w.nodeId, w.view)))
    return {
      response: c.json(
        { error: "approver_group_required", reason: "A rule limits who may approve this", groups },
        403,
      ),
      rx,
    };
  return { response: null, rx };
}
