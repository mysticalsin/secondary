// The review of a landing page, shared by POST /v1/lp/:id/approve and the Questions inbox (kind release).
// Rule: the approver holds approve_release on Company Global through the policy, is not the author or an
// editor (by principal id, by address, or as the same human under another id), and names the exact
// revision hash they read. Approving one revision does not carry to the next.

import { canDoInView } from "@secondary/policy";
import { viewOf } from "../auth.ts";
import { humanIdsOf } from "../human.ts";
import type { C } from "../ux/util.ts";
import { audit, sess } from "../ux/util.ts";
import { lpStub } from "./stub.ts";
import type { PageRecord } from "./types.ts";
import { revisionHashOf } from "./types.ts";

/** The node a page release is decided on. Pages go out under the firm's name, so Company Global. */
export const RELEASE_NODE = "core";

export type ReviewOutcome =
  | { ok: true; status: "approved" | "draft"; approvals: number; required: number }
  | { ok: false; status: 400 | 403 | 404 | 409 | 503; body: Record<string, unknown> };

/** May this caller decide this page: the policy decides, never the page. Null means yes. */
export function mayDecide(c: C, rec: PageRecord): { allowed: boolean; reason: string } {
  const s = sess(c);
  return canDoInView(viewOf(s), s.principal, RELEASE_NODE, "approve_release", s.ctx, {
    authorId: rec.owner,
    status: "candidate",
    revision: rec.revision,
  });
}

export async function approvePage(
  c: C,
  rec: PageRecord,
  revisionHash: string | undefined,
): Promise<ReviewOutcome> {
  const s = sess(c);
  if (s.internal)
    return {
      ok: false,
      status: 403,
      body: { error: "forbidden", reason: "Not available through MCP" },
    };
  // A caller who may not decide learns nothing about the page unless it is their own.
  const right = mayDecide(c, rec);
  if (!right.allowed)
    return rec.owner === s.principal.id
      ? { ok: false, status: 403, body: { error: "forbidden", reason: right.reason } }
      : { ok: false, status: 404, body: { error: "not_found" } };
  if (!revisionHash)
    return {
      ok: false,
      status: 400,
      body: { error: "revision_required", reason: "Name the revision you read: send revisionHash" },
    };
  if (
    !(await audit(c, {
      action: "lp.approve",
      nodeId: rec.id,
      scopeId: RELEASE_NODE,
      revision: rec.revision,
      reason: right.reason,
    }))
  )
    return { ok: false, status: 503, body: { error: "audit_unavailable" } };
  const humans = await humanIdsOf(c.env, s);
  const res = await lpStub(c.env, s.tenantId).approve(
    rec.id,
    revisionHash,
    { id: s.principal.id, email: s.principal.email },
    humans,
    s.ctx.now,
  );
  if (res.ok) return { ok: true, status: "approved", approvals: 1, required: 1 };
  if (res.code === "self_approval")
    return { ok: false, status: 403, body: { error: "self_approval", reason: res.message } };
  if (res.code === "conflict")
    return {
      ok: false,
      status: 409,
      body: {
        error: "revision_conflict",
        currentRevision: res.currentRevision,
        reason: res.message,
      },
    };
  if (res.code === "not_found") return { ok: false, status: 404, body: { error: "not_found" } };
  return { ok: false, status: 409, body: { error: res.code, reason: res.message } };
}

export async function requestPageChanges(
  c: C,
  rec: PageRecord,
  note: string,
): Promise<ReviewOutcome> {
  const s = sess(c);
  if (s.internal)
    return {
      ok: false,
      status: 403,
      body: { error: "forbidden", reason: "Not available through MCP" },
    };
  const right = mayDecide(c, rec);
  if (!right.allowed)
    return rec.owner === s.principal.id
      ? { ok: false, status: 403, body: { error: "forbidden", reason: right.reason } }
      : { ok: false, status: 404, body: { error: "not_found" } };
  if (
    !(await audit(c, {
      action: "lp.request_changes",
      nodeId: rec.id,
      scopeId: RELEASE_NODE,
      revision: rec.revision,
      reason: right.reason,
    }))
  )
    return { ok: false, status: 503, body: { error: "audit_unavailable" } };
  const res = await lpStub(c.env, s.tenantId).requestChanges(rec.id, note, s.ctx.now);
  if (res.ok) return { ok: true, status: "draft", approvals: 0, required: 1 };
  return { ok: false, status: 409, body: { error: res.code, reason: res.message } };
}

export const hashOfRecord = (rec: PageRecord): Promise<string> => revisionHashOf(rec);
