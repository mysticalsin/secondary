// The rule check for work no person is waiting on: the SharePoint connector and the wiki engine's
// jobs. They have no session, so there is no request to answer. The verdict says what the caller must
// do: stop, or carry on (and, for a proposal, mark it for the approvals the rules ask for). It FAILS
// CLOSED: if the rules cannot be read the verdict is "stop", and the work is retried later.

import {
  brainTypeOf,
  evaluateRules,
  needsApproval,
  type RuleAction,
  type ViewNode,
} from "@secondary/policy";
import { appendReceipt, newReceiptId } from "../audit.ts";
import { getOrg } from "../org.ts";
import { tenantStub } from "../stubs.ts";
import { rulesClient } from "./client.ts";
import { contractOf, flagsOf, tenantTime } from "./context.ts";

export interface ServiceCheck {
  tenantId: string;
  /** Receipt actor id. */
  principalId: string;
  scopeId: string | null;
  nodeId: string;
  action: RuleAction;
  actor: "connector" | "agent";
  /** Read for content flags only; never stored or logged. */
  text?: string;
  cites?: number;
  pages: number;
  /** "hold": an approval effect stops the work (nobody can approve a batch). "stamp": it asks for approvals on the proposal. */
  approval: "hold" | "stamp";
}

export type ServiceVerdict =
  | { stop: true; rule: string | null }
  | {
      stop: false;
      /** An approval effect applies: the proposal must not be accepted at once. */
      review: boolean;
      stamp: {
        required: number;
        group: string[];
        tag: string;
        expiresAfterMin: number | null;
      } | null;
    };

export async function ruleServiceCheck(
  env: Env,
  i: ServiceCheck,
  now = Date.now(),
): Promise<ServiceVerdict> {
  try {
    const config = await tenantStub(env, i.tenantId).getConfig();
    const org = config ? getOrg(config) : null;
    const node =
      org?.nodes.get(i.nodeId.split(":")[0] ?? i.nodeId) ?? org?.nodes.get(i.nodeId) ?? null;
    if (!org || !node) return { stop: true, rule: null }; // fail closed: a node nobody can place
    const type = brainTypeOf(node.kind);
    if (!type) return { stop: true, rule: null };
    if (type === "personal") return { stop: false, review: false, stamp: null };
    const state = await rulesClient(env, i.tenantId).state(now);
    const contract = contractOf(node as unknown as ViewNode);
    const flags = i.text !== undefined ? flagsOf(i.text, org, i.cites ?? 0) : [];
    const r = evaluateRules({
      base: "allow",
      action: i.action,
      actor: { kind: i.actor, host: null, roles: [] },
      brain: { id: node.id, type },
      flags,
      pages: i.pages,
      contract,
      time: tenantTime(env, now),
      incident: state.incident,
      rules: state.docs,
    });
    const asks = needsApproval(r.effect);
    if (r.effect === "block" || (asks && i.approval === "hold")) {
      const ok = await appendReceipt(env, {
        receiptId: newReceiptId(),
        at: new Date(now).toISOString(),
        tenantId: i.tenantId,
        principalId: i.principalId,
        action: "rule.block",
        nodeId: node.id,
        scopeId: i.scopeId,
        decision: "deny",
        reason: i.actor === "connector" ? "sync held by rule" : "held by rule",
        revision: null,
        requestId: null,
        clientId: null,
        tool: null,
        rule: r.tag ?? "",
        ruleMode: "enforced",
        meta: {
          action: i.action,
          actor: i.actor,
          host: null,
          brainId: node.id,
          brainType: type,
          flags,
          pages: i.pages,
          contract,
          expiresAfterMin: null,
        },
      });
      void ok; // the work is stopped either way; the receipt is best effort here
      return { stop: true, rule: r.tag ?? "" };
    }
    if (asks || r.expiresAfterMin !== null)
      return {
        stop: false,
        review: asks,
        stamp: {
          required: r.requiredApprovals,
          group: r.approvers,
          tag: r.tag ?? "",
          expiresAfterMin: r.expiresAfterMin,
        },
      };
    return { stop: false, review: false, stamp: null };
  } catch {
    return { stop: true, rule: null };
  }
}
