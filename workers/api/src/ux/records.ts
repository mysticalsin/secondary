// Account workspace records that members create and edit: decisions, commitments, risks and
// success stories. Each is an item in the account's own workspace (kind "record"), so it has
// revisions and history like any other item. Reads need content access, writes need `edit`.

import { type AdmittedView, canDoInView, type ViewNode } from "@secondary/policy";
import { Hono } from "hono";
import { viewOf } from "../auth.ts";
import { scopeOfNode } from "../scope.ts";
import { workspaceStub } from "../stubs.ts";
import type { AppEnv } from "../types.ts";
import { wikiNotify } from "../wiki/hooks.ts";
import type { ItemRecord } from "../workspace.ts";
import {
  audit,
  bad,
  type C,
  failResponse,
  forbidden,
  MAX_BODY_TEXT,
  MAX_TEXT,
  NODE_ID,
  notFound,
  optText,
  readObject,
  revisionOf,
  sess,
  text,
} from "./util.ts";

export const SECTIONS = ["dec", "com", "risk", "out"] as const;
type Section = (typeof SECTIONS)[number];

const STATUSES: Record<Section, readonly string[]> = {
  dec: ["open", "decided"],
  com: ["open", "in progress", "done"],
  risk: ["open", "mitigating", "closed"],
  out: ["draft", "ready"],
};
/** Statuses that stop a record from needing attention. */
const SETTLED = new Set(["decided", "done", "closed", "ready"]);
export const OWNER_ROLES = [
  "Account lead",
  "Delivery lead",
  "Bid manager",
  "Knowledge reviewer",
  "Customer",
] as const;
const DUE = /^\d{4}-\d{2}-\d{2}$/;

interface Stored {
  note: string;
  ownerRole: string;
  due: string | null;
  story: null | {
    internal: string;
    lesson: string;
    external: string;
    /** `text` is the external text the customer agreed to; any other text is not covered (M-12). */
    permission: null | {
      reference: string;
      by: string;
      at: string;
      text?: string;
      /** Channels the customer agreed to, for example "landing page". Absent on older records: covers none. */
      channels?: string[];
    };
  };
}

const parse = (s: string | null): Stored => {
  try {
    const v = JSON.parse(s ?? "{}") as Partial<Stored>;
    return {
      note: typeof v.note === "string" ? v.note : "",
      ownerRole: typeof v.ownerRole === "string" ? v.ownerRole : "",
      due: typeof v.due === "string" ? v.due : null,
      story: v.story ?? null,
    };
  } catch {
    return { note: "", ownerRole: "", due: null, story: null };
  }
};

const sectionOf = (r: ItemRecord): Section =>
  (r.tags.find((t) => (SECTIONS as readonly string[]).includes(t)) as Section) ?? "dec";

const today = (now: number): string => new Date(now).toISOString().slice(0, 10);

export function recordView(r: ItemRecord, now: number) {
  const st = parse(r.body);
  const section = sectionOf(r);
  // Permission counts only for the exact external text it was recorded against (M-12).
  const perm = st.story?.permission;
  const granted = !!perm && perm.text !== undefined && perm.text === st.story?.external;
  return {
    id: r.id,
    section,
    title: r.label,
    status: r.status,
    revision: r.revision,
    ownerRole: st.ownerRole,
    due: st.due,
    overdue: !!st.due && st.due < today(now) && !SETTLED.has(r.status),
    note: st.note,
    updatedAt: new Date(r.updatedAt).toISOString(),
    ...(st.story
      ? {
          story: {
            internal: st.story.internal,
            lesson: st.story.lesson,
            // The external text is stored, but it is only ever returned while permission stands.
            external: {
              available: granted,
              text: granted ? st.story.external : null,
              reason: granted
                ? "Customer permission on record"
                : "No customer permission on record",
            },
            permission:
              granted && perm
                ? {
                    reference: perm.reference,
                    by: perm.by,
                    at: perm.at,
                    ...(perm.channels ? { channels: perm.channels } : {}),
                  }
                : null,
          },
        }
      : {}),
  };
}

/** The account node and its workspace, or null when the caller cannot see content there. */
function accountOf(c: C, view: AdmittedView, id: string): { vn: ViewNode; scope: string } | null {
  if (!NODE_ID.test(id)) return null;
  const vn = view.nodes.get(id);
  if (vn?.kind !== "account") return null;
  const s = sess(c);
  if (!canDoInView(view, s.principal, id, "view_content").allowed) return null;
  const scope = scopeOfNode(vn);
  return scope ? { vn, scope } : null;
}

function readFields(b: Record<string, unknown>, section: Section) {
  const title = b.title === undefined ? undefined : text(b.title, 1, 200, "invalid_title");
  const note = optText(b.note, MAX_TEXT, "invalid_note");
  let ownerRole: string | undefined;
  if (b.ownerRole !== undefined) {
    if (
      typeof b.ownerRole !== "string" ||
      (b.ownerRole !== "" && !(OWNER_ROLES as readonly string[]).includes(b.ownerRole))
    )
      throw bad("invalid_owner_role");
    ownerRole = b.ownerRole;
  }
  let due: string | null | undefined;
  if (b.due !== undefined) {
    if (b.due === null || b.due === "") due = null;
    else if (typeof b.due === "string" && DUE.test(b.due) && !Number.isNaN(Date.parse(b.due)))
      due = b.due;
    else throw bad("invalid_due");
  }
  let status: string | undefined;
  if (b.status !== undefined) {
    if (typeof b.status !== "string" || !STATUSES[section].includes(b.status))
      throw bad("invalid_status");
    status = b.status;
  }
  return { title, note, ownerRole, due, status };
}

function readStory(v: unknown): { internal: string; lesson: string; external: string } | undefined {
  if (v === undefined) return undefined;
  if (!v || typeof v !== "object" || Array.isArray(v)) throw bad("invalid_story");
  const o = v as Record<string, unknown>;
  return {
    internal: optText(o.internal, MAX_BODY_TEXT, "invalid_story") ?? "",
    lesson: optText(o.lesson, MAX_BODY_TEXT, "invalid_story") ?? "",
    external: optText(o.external, MAX_BODY_TEXT, "invalid_story") ?? "",
  };
}

export function recordRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get("/ux/accounts/:id/records", async (c) => {
    const s = sess(c);
    const view = viewOf(s);
    const acc = accountOf(c, view, c.req.param("id"));
    if (!acc) return c.json({ canEdit: false, ownerRoles: OWNER_ROLES, records: [] });
    const rows = await workspaceStub(c.env, s.tenantId, acc.scope).listByKind("record", 200);
    return c.json({
      canEdit: canDoInView(view, s.principal, acc.vn.id, "edit").allowed,
      ownerRoles: OWNER_ROLES,
      records: rows.map((x) => recordView(x, s.ctx.now)),
    });
  });

  const writer = async (c: C) => {
    const s = sess(c);
    const view = viewOf(s);
    const id = c.req.param("id") ?? "";
    const acc = accountOf(c, view, id);
    if (!acc) throw notFound();
    const d = canDoInView(view, s.principal, id, "edit");
    if (!d.allowed) {
      await audit(c, {
        action: "record.write",
        nodeId: id,
        scopeId: acc.scope,
        revision: null,
        decision: "deny",
        reason: d.reason,
      });
      return { deny: forbidden(c, d.reason) } as const;
    }
    return { acc, id, stub: workspaceStub(c.env, s.tenantId, acc.scope) } as const;
  };

  r.post("/ux/accounts/:id/records", async (c) => {
    const w = await writer(c);
    if ("deny" in w) return w.deny;
    const b = await readObject(c);
    const section = b.section as Section;
    if (!(SECTIONS as readonly string[]).includes(section)) throw bad("invalid_section");
    const f = readFields(b, section);
    if (f.title === undefined) throw bad("invalid_title");
    const story =
      section === "out"
        ? (readStory(b.story) ?? { internal: "", lesson: "", external: "" })
        : undefined;
    // A new story has no permission yet, so it cannot carry an external text.
    if (story?.external) throw bad("customer_permission_required", 422);
    if (
      !(await audit(c, {
        action: "record.create",
        nodeId: w.id,
        scopeId: w.acc.scope,
        revision: 1,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    const stored: Stored = {
      note: f.note ?? "",
      ownerRole: f.ownerRole ?? "",
      due: f.due ?? null,
      story: story ? { ...story, permission: null } : null,
    };
    const made = await w.stub.create(
      {
        id: `rec:${w.id}:${crypto.randomUUID().slice(0, 8)}`,
        label: f.title,
        kind: "record",
        plane: w.acc.vn.plane,
        origin: "record",
        status: f.status ?? STATUSES[section][0] ?? "open",
        authorId: sess(c).principal.id,
        body: JSON.stringify(stored),
        tags: [section],
      },
      sess(c).ctx.now,
    );
    if ("ok" in made) return failResponse(c, made);
    await wikiNotify(c.env, sess(c).tenantId, w.acc.scope, [made.id], sess(c).ctx.now);
    return c.json(recordView(made, sess(c).ctx.now), 201);
  });

  const recordId = (c: C, accId: string): string => {
    const rid = c.req.param("rid") ?? "";
    if (!rid.startsWith(`rec:${accId}:`) || !NODE_ID.test(rid)) throw notFound();
    return rid;
  };

  r.put("/ux/accounts/:id/records/:rid", async (c) => {
    const w = await writer(c);
    if ("deny" in w) return w.deny;
    const rid = recordId(c, w.id);
    const cur = await w.stub.get(rid);
    if (cur?.kind !== "record") throw notFound();
    const b = await readObject(c);
    const expected = revisionOf(b.revision);
    const section = sectionOf(cur);
    const f = readFields(b, section);
    const story = section === "out" ? readStory(b.story) : undefined;
    const st = parse(cur.body);
    // External text enters through the permission route (text and permission recorded together). A rewrite
    // while a permission stands is stored but locked: permission covers only the text it was given for (M-12).
    if (story?.external && !st.story?.permission) throw bad("customer_permission_required", 422);
    const next: Stored = {
      note: f.note ?? st.note,
      ownerRole: f.ownerRole ?? st.ownerRole,
      due: f.due === undefined ? st.due : f.due,
      story: st.story ? { ...st.story, ...(story ?? {}) } : null,
    };
    if (
      !(await audit(c, {
        action: "record.update",
        nodeId: w.id,
        scopeId: w.acc.scope,
        revision: expected,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    const res = await w.stub.update(
      rid,
      expected,
      {
        ...(f.title !== undefined ? { title: f.title } : {}),
        ...(f.status !== undefined ? { status: f.status } : {}),
        body: JSON.stringify(next),
      },
      sess(c).ctx.now,
      sess(c).principal.id,
    );
    if (!res.ok) return failResponse(c, res);
    await wikiNotify(c.env, sess(c).tenantId, w.acc.scope, [rid], sess(c).ctx.now);
    return c.json(recordView((await w.stub.get(rid)) as ItemRecord, sess(c).ctx.now));
  });

  // Customer permission for the external output. It names where the permission is on file.
  r.post("/ux/accounts/:id/records/:rid/permission", async (c) => {
    const w = await writer(c);
    if ("deny" in w) return w.deny;
    const rid = recordId(c, w.id);
    const cur = await w.stub.get(rid);
    if (cur?.kind !== "record" || sectionOf(cur) !== "out") throw notFound();
    const b = await readObject(c);
    const expected = revisionOf(b.revision);
    const st = parse(cur.body);
    if (!st.story) throw notFound();
    if (typeof b.granted !== "boolean") throw bad("invalid_permission");
    const reference = b.granted ? text(b.reference, 3, 200, "permission_reference_required") : "";
    // The permission is for these exact words: they are given with it, or are the ones already stored.
    const external =
      b.granted && b.text !== undefined
        ? text(b.text, 1, MAX_BODY_TEXT, "invalid_story")
        : st.story.external;
    if (b.granted && !external) throw bad("external_text_required");
    let channels: string[] | undefined;
    if (b.channels !== undefined) {
      if (
        !Array.isArray(b.channels) ||
        b.channels.length > 10 ||
        b.channels.some((x) => typeof x !== "string" || x.trim().length < 1 || x.length > 60)
      )
        throw bad("invalid_channels");
      channels = [...new Set((b.channels as string[]).map((x) => x.trim().toLowerCase()))];
    }
    if (
      !(await audit(c, {
        action: "record.permission",
        nodeId: w.id,
        scopeId: w.acc.scope,
        revision: expected,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    const permission = b.granted
      ? {
          reference,
          by: sess(c).principal.id,
          at: new Date(sess(c).ctx.now).toISOString(),
          text: external,
          ...(channels ? { channels } : {}),
        }
      : null;
    const res = await w.stub.update(
      rid,
      expected,
      {
        body: JSON.stringify({
          ...st,
          story: { ...st.story, ...(b.granted ? { external } : {}), permission },
        }),
      },
      sess(c).ctx.now,
      sess(c).principal.id,
    );
    if (!res.ok) return failResponse(c, res);
    return c.json(recordView((await w.stub.get(rid)) as ItemRecord, sess(c).ctx.now));
  });

  r.get("/ux/accounts/:id/records/:rid/history", async (c) => {
    const s = sess(c);
    const acc = accountOf(c, viewOf(s), c.req.param("id"));
    if (!acc) throw notFound();
    const rid = recordId(c, acc.vn.id);
    const rows = await workspaceStub(c.env, s.tenantId, acc.scope).history(rid);
    return c.json(
      rows.map((x) => ({ revision: x.revision, title: x.label, at: new Date(x.at).toISOString() })),
    );
  });

  // What needs this person across the accounts they can read: open decisions, overdue
  // commitments and open risks.
  r.get("/ux/attention", async (c) => {
    const s = sess(c);
    const view = viewOf(s);
    const accounts = [...view.nodes.values()].filter(
      (n) => n.kind === "account" && canDoInView(view, s.principal, n.id, "view_content").allowed,
    );
    const lists = await Promise.all(
      accounts.map(async (a) => {
        const scope = scopeOfNode(a);
        if (!scope) return [];
        const rows = await workspaceStub(c.env, s.tenantId, scope).listByKind("record", 200);
        return rows.map((x) => ({ a, v: recordView(x, s.ctx.now) }));
      }),
    );
    const items = lists
      .flat()
      .filter(({ v }) => v.section !== "out" && !SETTLED.has(v.status))
      .map(({ a, v }) => ({
        id: v.id,
        kind: v.section === "dec" ? "decision" : v.section === "com" ? "commitment" : "risk",
        title: v.title,
        accountId: a.id,
        accountName: a.label,
        due: v.due,
        overdue: v.overdue,
        ownerRole: v.ownerRole,
      }))
      // Overdue first, then the nearest due date, then undated.
      .sort(
        (x, y) =>
          Number(y.overdue) - Number(x.overdue) ||
          (x.due ?? "9999").localeCompare(y.due ?? "9999") ||
          x.id.localeCompare(y.id),
      )
      .slice(0, 30);
    return c.json({ items });
  });

  return r;
}
