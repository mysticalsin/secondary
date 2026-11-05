// Review detail: the exact revision, the one before it, the discussion and who decided what.
// The list in GET /v1/review stays the source of the queue. This answers for one candidate and
// applies the same rule: review or approve rights on the target, and never the contributor.

import { canDoInView } from "@secondary/policy";
import { Hono } from "hono";
import { viewOf } from "../auth.ts";
import { parseCandidateId, scopeOfNode } from "../scope.ts";
import { workspaceStub } from "../stubs.ts";
import type { AppEnv } from "../types.ts";
import { notifyChangesRequested } from "./notify.ts";
import {
  audit,
  bad,
  type C,
  failResponse,
  forbidden,
  NODE_ID,
  notFound,
  readObject,
  revisionOf,
  sess,
  text,
} from "./util.ts";

const MAX_COMMENT = 2_000;

export function reviewRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  /** The candidate, its workspace and the policy node, for a caller who may review or approve it. */
  const open = async (c: C) => {
    const s = sess(c);
    const id = c.req.param("id") ?? "";
    if (!NODE_ID.test(id)) throw notFound();
    const policyNode = parseCandidateId(id)?.targetNodeId ?? id;
    const view = viewOf(s);
    const vn = view.nodes.get(policyNode);
    const scope = vn ? scopeOfNode(vn) : null;
    if (!vn || !scope) throw notFound();
    const may =
      canDoInView(view, s.principal, policyNode, "review").allowed ||
      canDoInView(view, s.principal, policyNode, "approve_release").allowed;
    if (!may) throw notFound();
    const stub = workspaceStub(c.env, s.tenantId, scope);
    const item = await stub.get(id);
    if (!item || item.authorId === s.principal.id) throw notFound();
    return { s, id, scope, stub, item };
  };

  r.get("/ux/review/:id", async (c) => {
    const { s, id, stub, item } = await open(c);
    const history = await stub.history(id);
    const byRev = new Map(history.map((h) => [h.revision, h]));
    // A candidate with no stored snapshot (created before history existed) still shows its text.
    const cur = byRev.get(item.revision) ?? {
      revision: item.revision,
      label: item.label,
      body: item.body,
      actorId: item.authorId,
      at: item.updatedAt,
    };
    const prevRev = [...byRev.keys()].filter((n) => n < item.revision).sort((a, b) => b - a)[0];
    const prev = prevRev === undefined ? null : (byRev.get(prevRev) ?? null);
    const comments = await stub.comments(id, 100);
    const decisions = await stub.decisions(id, item.revision);
    const shape = (x: { revision: number; label: string; body: string | null; at: number }) => ({
      revision: x.revision,
      title: x.label,
      body: x.body ?? "",
      at: new Date(x.at).toISOString(),
    });
    return c.json({
      id,
      current: shape(cur),
      previous: prev ? shape(prev) : null,
      revisions: history.map((h) => ({ revision: h.revision, at: new Date(h.at).toISOString() })),
      // Oldest first, so it reads as a thread.
      comments: [...comments].reverse().map((m) => ({
        id: m.id,
        authorId: m.authorId,
        text: m.text,
        at: new Date(m.at).toISOString(),
        mine: m.authorId === s.principal.id,
      })),
      decisions: decisions.map((d) => ({
        actorId: d.actorId,
        kind: d.kind === "approve" ? "approved" : (d.verdict ?? "reviewed"),
        at: new Date(d.at).toISOString(),
        mine: d.actorId === s.principal.id,
      })),
      twoPerson: { required: item.required > 1, approvals: item.approvals, needed: item.required },
    });
  });

  // A reviewer's words on a candidate. Reviewing includes saying why, so this needs the same
  // right as the decision, not the separate `comment` grant.
  r.post("/ux/review/:id/comments", async (c) => {
    const { s, id, scope, stub } = await open(c);
    const b = await readObject(c);
    const t = text(b.text, 1, MAX_COMMENT, "invalid_comment");
    if (!(await audit(c, { action: "comment", nodeId: id, scopeId: scope, revision: null })))
      return c.json({ error: "audit_unavailable" }, 503);
    const m = await stub.comment(id, s.principal.id, t, s.ctx.now);
    return c.json({ ok: true, commentId: m.id });
  });

  // Request changes on the exact revision, with the reason as a comment in the same step.
  r.post("/ux/review/:id/decision", async (c) => {
    const { s, id, scope, stub, item } = await open(c);
    const b = await readObject(c);
    const revision = revisionOf(b.revision);
    if (b.verdict !== "changes_requested" && b.verdict !== "accept") throw bad("invalid_verdict");
    const t = b.comment === undefined ? "" : text(b.comment, 0, MAX_COMMENT, "invalid_comment");
    const view = viewOf(s);
    const policyNode = parseCandidateId(id)?.targetNodeId ?? id;
    const d = canDoInView(view, s.principal, policyNode, "review");
    if (!d.allowed) return forbidden(c, d.reason);
    if (!(await audit(c, { action: "review", nodeId: id, scopeId: scope, revision })))
      return c.json({ error: "audit_unavailable" }, 503);
    const res = await stub.review(id, revision, s.principal.id, b.verdict, s.ctx.now);
    if (!res.ok) return failResponse(c, res);
    if (t) await stub.comment(id, s.principal.id, t, s.ctx.now);
    if (b.verdict === "changes_requested")
      await notifyChangesRequested(c, policyNode, id, item.authorId);
    return c.json({ ok: true, revision: res.revision });
  });

  return r;
}
