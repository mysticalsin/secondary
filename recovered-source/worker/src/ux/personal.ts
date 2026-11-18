// Personal Brain: edit, delete, history, restore, tags, contribution status, drafts and prefs.
// Everything here addresses the caller's own workspace (personal:<id>) and nothing else.

import { Hono } from "hono";
import { asciiLower } from "../../../src/state/actor.ts";
import { viewOf } from "../auth.ts";
import { personalScope, scopeOfNode } from "../scope.ts";
import { detectSensitivity } from "../sensitivity.ts";
import { workspaceStub } from "../stubs.ts";
import type { AppEnv } from "../types.ts";
import { wikiNotify } from "../wiki/hooks.ts";
import type { ItemRecord } from "../workspace.ts";
import {
  audit,
  bad,
  type C,
  failResponse,
  MAX_BODY_TEXT,
  NODE_ID,
  notFound,
  optText,
  readObject,
  revisionOf,
  sess,
  text,
} from "./util.ts";

const PERSONAL_KINDS = ["note", "brief", "view", "draft"];
const TAG_RE = /^[\p{L}\p{N}][\p{L}\p{N} _-]{0,23}$/u;
const MAX_TAGS = 8;
const DRAFT_KEY = /^(new|pi:[0-9a-f]{16})$/;

const ws = (c: C) => workspaceStub(c.env, sess(c).tenantId, personalScope(sess(c).principal.id));

const userTags = (tags: string[]): string[] =>
  tags.filter((t) => t.startsWith("t:")).map((t) => t.slice(2));

function tagsOf(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > MAX_TAGS) throw bad("invalid_tags");
  const out = new Set<string>();
  for (const t of v) {
    if (typeof t !== "string" || !TAG_RE.test(t.trim())) throw bad("invalid_tags");
    out.add(asciiLower(t.trim()));
  }
  return [...out];
}

const itemOf = async (c: C, id: string): Promise<ItemRecord> => {
  if (!NODE_ID.test(id)) throw notFound();
  const item = await ws(c).get(id);
  if (item?.kind !== "personalitem") throw notFound();
  return item;
};

export function personalRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  // Edit: title, body, type and tags. Every call is a new revision that can be restored.
  r.put("/personal/items/:id", async (c) => {
    const item = await itemOf(c, c.req.param("id"));
    const body = await readObject(c);
    const expected = revisionOf(body.revision);
    const title = body.title === undefined ? undefined : text(body.title, 1, 200, "invalid_title");
    const itemBody = optText(body.body, MAX_BODY_TEXT, "invalid_body");
    let tags: string[] | undefined;
    if (body.kind !== undefined || body.tags !== undefined) {
      const kind =
        body.kind === undefined
          ? (item.tags.find((t) => PERSONAL_KINDS.includes(t)) ?? "note")
          : String(body.kind);
      if (!PERSONAL_KINDS.includes(kind)) throw bad("invalid_kind");
      const mine = body.tags === undefined ? userTags(item.tags) : tagsOf(body.tags);
      tags = [kind, ...mine.map((t) => `t:${t}`)];
    }
    if (title === undefined && itemBody === undefined && tags === undefined)
      throw bad("nothing_to_edit");
    // Type and tags alone are metadata: no new revision, nothing for the history to hold.
    if (title === undefined && itemBody === undefined && tags) {
      // Metadata only, but still on the record (L-08).
      if (
        !(await audit(c, {
          action: "personal.retag",
          nodeId: item.id,
          scopeId: null,
          revision: item.revision,
        }))
      )
        return c.json({ error: "audit_unavailable" }, 503);
      await ws(c).retag(item.id, tags);
      return c.json({
        ok: true,
        revision: item.revision,
        updatedAt: new Date(item.updatedAt).toISOString(),
        sensitivity_flags: detectSensitivity({ title: item.label, body: item.body }),
      });
    }
    if (
      !(await audit(c, {
        action: "personal.update",
        nodeId: item.id,
        scopeId: null,
        revision: expected,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    const res = await ws(c).update(
      item.id,
      expected,
      {
        ...(title !== undefined ? { title } : {}),
        ...(itemBody !== undefined ? { body: itemBody } : {}),
        ...(tags ? { tags } : {}),
      },
      sess(c).ctx.now,
      sess(c).principal.id,
    );
    if (!res.ok) return failResponse(c, res);
    // A saved revision supersedes the working copy.
    await ws(c).remove(`ud:${item.id}`);
    await wikiNotify(
      c.env,
      sess(c).tenantId,
      personalScope(sess(c).principal.id),
      [item.id],
      sess(c).ctx.now,
    );
    const now = (await ws(c).get(item.id)) as ItemRecord;
    return c.json({
      ok: true,
      revision: now.revision,
      updatedAt: new Date(now.updatedAt).toISOString(),
      sensitivity_flags: detectSensitivity({ title: now.label, body: now.body }),
    });
  });

  r.delete("/personal/items/:id", async (c) => {
    const item = await itemOf(c, c.req.param("id"));
    if (
      !(await audit(c, {
        action: "personal.delete",
        nodeId: item.id,
        scopeId: null,
        revision: item.revision,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    const w = ws(c);
    const copies = (await w.contributions(item.id)).length;
    await w.remove(item.id);
    await w.remove(`ud:${item.id}`);
    // Copies already contributed are candidates in other scopes. They keep their own life in review.
    return c.json({ ok: true, copiesLeftInReview: copies });
  });

  r.get("/personal/items/:id/history", async (c) => {
    const item = await itemOf(c, c.req.param("id"));
    const rows = await ws(c).history(item.id);
    const have = new Set(rows.map((x) => x.revision));
    // An item from before history existed has only its current state.
    if (!have.has(item.revision))
      rows.unshift({
        revision: item.revision,
        label: item.label,
        body: item.body,
        actorId: item.authorId,
        at: item.updatedAt,
      });
    return c.json(
      rows.map((x) => ({
        revision: x.revision,
        title: x.label,
        body: x.body ?? "",
        at: new Date(x.at).toISOString(),
        current: x.revision === item.revision,
      })),
    );
  });

  // Restore copies an old revision forward as a new revision. History is never rewritten.
  r.post("/personal/items/:id/restore", async (c) => {
    const item = await itemOf(c, c.req.param("id"));
    const body = await readObject(c);
    const expected = revisionOf(body.revision);
    const from = revisionOf(body.fromRevision);
    const old = (await ws(c).history(item.id)).find((x) => x.revision === from);
    if (!old) throw notFound();
    if (
      !(await audit(c, {
        action: "personal.restore",
        nodeId: item.id,
        scopeId: null,
        revision: expected,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    const res = await ws(c).update(
      item.id,
      expected,
      { title: old.label, body: old.body ?? "" },
      sess(c).ctx.now,
      sess(c).principal.id,
    );
    if (!res.ok) return failResponse(c, res);
    return c.json({ ok: true, revision: res.revision });
  });

  // Where each contribution of this note stands, with what reviewers said. Content stays in review.
  r.get("/personal/items/:id/contributions", async (c) => {
    const s = sess(c);
    const item = await itemOf(c, c.req.param("id"));
    const view = viewOf(s);
    const rows = await ws(c).contributions(item.id);
    const out = await Promise.all(
      rows.map(async (x) => {
        const target = view.nodes.get(x.scopeId);
        const scope = target ? scopeOfNode(target) : null;
        const base = {
          candidateId: x.candidateId,
          scopeLabel: target?.label ?? x.scopeId,
          at: new Date(x.at).toISOString(),
        };
        if (!scope) return { ...base, status: "unknown", revision: 0, feedback: [] };
        const stub = workspaceStub(c.env, s.tenantId, scope);
        const cand = await stub.get(x.candidateId);
        if (!cand) return { ...base, status: "withdrawn", revision: 0, feedback: [] };
        const decisions = await stub.decisions(cand.id, cand.revision);
        const comments = await stub.comments(cand.id, 50);
        const changes = decisions.some(
          (d) => d.kind === "review" && d.verdict === "changes_requested",
        );
        return {
          ...base,
          status:
            cand.status === "approved" ? "released" : changes ? "changes_requested" : "in_review",
          revision: cand.revision,
          approvals: cand.approvals,
          required: cand.required,
          // Reviewer comments only. The contributor sees what was asked, not who asked.
          feedback: comments
            .filter((m) => m.authorId !== s.principal.id)
            .map((m) => ({ id: m.id, text: m.text, at: new Date(m.at).toISOString() })),
        };
      }),
    );
    return c.json(out);
  });

  // ---- drafts: a working copy that autosaves and never becomes a revision on its own ----

  r.get("/ux/drafts", async (c) => {
    const rows = await ws(c).listByKind("uxdraft", 50);
    return c.json(
      rows.map((d) => {
        const p = safeJson(d.body);
        return {
          key: d.id.slice(3),
          title: d.label,
          body: typeof p.body === "string" ? p.body : "",
          kind: typeof p.kind === "string" ? p.kind : "note",
          baseRevision: typeof p.baseRevision === "number" ? p.baseRevision : 0,
          at: new Date(d.updatedAt).toISOString(),
        };
      }),
    );
  });

  r.put("/ux/drafts/:key", async (c) => {
    const key = c.req.param("key");
    if (!DRAFT_KEY.test(key)) throw notFound();
    // A draft belongs to a note that exists, or is the one new-note draft: at most one per note (L-08).
    if (key !== "new" && (await ws(c).get(key))?.kind !== "personalitem") throw notFound();
    const b = await readObject(c);
    const title = optText(b.title, 200, "invalid_title") ?? "";
    const body = optText(b.body, MAX_BODY_TEXT, "invalid_body") ?? "";
    const kind = typeof b.kind === "string" && PERSONAL_KINDS.includes(b.kind) ? b.kind : "note";
    // Autosave is frequent: only the first save of a draft leaves a receipt.
    if (
      !(await ws(c).get(`ud:${key}`)) &&
      !(await audit(c, {
        action: "personal.draft",
        nodeId: key === "new" ? null : key,
        scopeId: null,
        revision: null,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    const baseRevision =
      typeof b.baseRevision === "number" ? Math.max(0, Math.floor(b.baseRevision)) : 0;
    const rec = await ws(c).scratch(
      {
        id: `ud:${key}`,
        label: title,
        kind: "uxdraft",
        plane: "PERSONAL_HOSTED",
        origin: "personal",
        status: "draft",
        authorId: sess(c).principal.id,
        body: JSON.stringify({ body, kind, baseRevision }),
      },
      sess(c).ctx.now,
    );
    return c.json({ ok: true, at: new Date(rec.updatedAt).toISOString() });
  });

  r.delete("/ux/drafts/:key", async (c) => {
    const key = c.req.param("key");
    if (!DRAFT_KEY.test(key)) throw notFound();
    if (
      (await ws(c).get(`ud:${key}`)) &&
      !(await audit(c, {
        action: "personal.draft_delete",
        nodeId: key === "new" ? null : key,
        scopeId: null,
        revision: null,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    await ws(c).remove(`ud:${key}`);
    return c.json({ ok: true });
  });

  // ---- per-user preferences (language, onboarding tour) ----

  r.get("/ux/prefs", async (c) => {
    const rec = await ws(c).get("pref:ui");
    return c.json(prefsOf(rec));
  });

  r.put("/ux/prefs", async (c) => {
    const b = await readObject(c);
    const cur = prefsOf(await ws(c).get("pref:ui"));
    const next = { ...cur };
    if (b.lang !== undefined) {
      if (b.lang !== "en" && b.lang !== "fr" && b.lang !== null) throw bad("invalid_lang");
      next.lang = b.lang;
    }
    if (b.tourDone !== undefined) {
      if (typeof b.tourDone !== "boolean") throw bad("invalid_tour");
      next.tourDone = b.tourDone;
    }
    if (
      !(await audit(c, { action: "personal.prefs", nodeId: null, scopeId: null, revision: null }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    await ws(c).scratch(
      {
        id: "pref:ui",
        label: "ui",
        kind: "uxpref",
        plane: "PERSONAL_HOSTED",
        origin: "personal",
        status: "draft",
        authorId: sess(c).principal.id,
        body: JSON.stringify(next),
      },
      sess(c).ctx.now,
    );
    return c.json(next);
  });

  return r;
}

function safeJson(s: string | null): Record<string, unknown> {
  try {
    const v = s ? JSON.parse(s) : {};
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function prefsOf(rec: ItemRecord | null): { lang: "en" | "fr" | null; tourDone: boolean } {
  const p = safeJson(rec?.body ?? null);
  return {
    lang: p.lang === "en" || p.lang === "fr" ? p.lang : null,
    tourDone: p.tourDone === true,
  };
}
