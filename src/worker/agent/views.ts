// Saved views (v6): /v1/views. A view is a plan and a layout, never data. It lives as one record of kind
// "agent_view" in the caller's own personal workspace, so another person's id is simply not there (404).
// A share is a link to the plan: a record of kind "agent_share" in a hidden tenant scope that no admitted
// view reaches (like `ux2:usage`), keyed by an unguessable id. Whenever a view is read, by its owner or
// through a share, the plan is parsed, checked and re-resolved for THAT viewer (`lockTree`): a card that
// names a brain the viewer cannot open becomes a Locked card with no title, id or text from the plan.

import {
  type AgentNode,
  brainRefs,
  lockTree,
  SavedViewInput,
  type SavedViewInputValue,
  viewOfProgram,
} from "../../../packages/contracts/src/agent-ui/index.ts";
import { brainOf } from "../brains/open.ts";
import { personalScope } from "../scope.ts";
import { workspaceStub } from "../stubs.ts";
import { audit, bad, type C, notFound, sess } from "../ux/util.ts";
import type { ItemRecord } from "../workspace.ts";

export const VIEW_KIND = "agent_view";
export const SHARE_KIND = "agent_share";
/** A tenant scope no admitted view reaches. */
export const SHARE_SCOPE = "agent:shares";
export const MAX_VIEWS = 50;

const VIEW_ID = /^av_[0-9a-f]{16}$/;
const SHARE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const hex = (n: number): string =>
  [...crypto.getRandomValues(new Uint8Array(n))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

type Pin = SavedViewInputValue["pin"];
type Layout = SavedViewInputValue["layout"];

/** What a view record holds: the plan and where it sits, plus the id of its share when it has one. */
interface Stored {
  name: string;
  program: string;
  pin: Pin;
  layout?: Layout;
  shareId?: string;
}

const mine = (c: C) => workspaceStub(c.env, sess(c).tenantId, personalScope(sess(c).principal.id));
const shares = (c: C) => workspaceStub(c.env, sess(c).tenantId, SHARE_SCOPE);

function storedOf(row: ItemRecord): Stored | null {
  try {
    const v = JSON.parse(row.body ?? "null") as Stored | null;
    return v && typeof v.program === "string" && typeof v.name === "string" ? v : null;
  } catch {
    return null;
  }
}

/** Per-request memory of which brains this viewer can open at read level (the same check as /v1/brains/:id). */
export function readChecker(c: C): (ids: Iterable<string>) => Promise<(id: string) => boolean> {
  const memo = new Map<string, Promise<boolean>>();
  const can = (id: string): Promise<boolean> => {
    let p = memo.get(id);
    if (!p) {
      p = brainOf(c, id).then((b) => b !== null);
      memo.set(id, p);
    }
    return p;
  };
  return async (ids) => {
    const known = new Map<string, boolean>();
    await Promise.all([...new Set(ids)].map(async (id) => known.set(id, await can(id))));
    return (id) => known.get(id) === true;
  };
}

/** The plan as this viewer may see it. */
export async function treeFor(
  c: C,
  program: string,
  check = readChecker(c),
): Promise<AgentNode | null> {
  const v = viewOfProgram(program);
  const canRead = await check(v.root ? brainRefs(v.root) : []);
  return lockTree(v.root, canRead).tree;
}

/** A program that may be stored: it parses to a root with nothing dropped or refused, and names only brains this person can read. */
async function checkedProgram(c: C, program: string, pin: Pin): Promise<void> {
  const v = viewOfProgram(program);
  // Finished (no open statement), nothing waiting on a line that is not there, nothing dropped or refused.
  if (!v.root || !v.complete || v.pending > 0 || v.dropped > 0 || v.rejected > 0)
    throw bad("invalid_program");
  const ids = [...brainRefs(v.root), ...(pin === "home" ? [] : [pin.brain])];
  const canRead = await readChecker(c)(ids);
  if (!ids.every(canRead)) throw bad("brain_not_readable");
}

async function present(
  c: C,
  row: ItemRecord,
  st: Stored,
  check: ReturnType<typeof readChecker>,
): Promise<Record<string, unknown>> {
  return {
    id: row.id,
    name: st.name,
    pin: st.pin,
    ...(st.layout ? { layout: st.layout } : {}),
    program: st.program,
    updatedAt: new Date(row.updatedAt).toISOString(),
    shared: typeof st.shareId === "string",
    tree: await treeFor(c, st.program, check),
  };
}

const bodyOf = (st: Stored): string => JSON.stringify(st);

async function loadMine(c: C): Promise<{ row: ItemRecord; st: Stored }> {
  const id = c.req.param("id") ?? "";
  if (!VIEW_ID.test(id)) throw notFound();
  const row = await mine(c).get(id);
  const st = row && row.kind === VIEW_KIND ? storedOf(row) : null;
  if (!row || !st) throw notFound();
  return { row, st };
}

async function readBody<T>(c: C, parse: (v: unknown) => T | null): Promise<T> {
  let v: unknown;
  try {
    v = JSON.parse(await c.req.text());
  } catch {
    throw bad("invalid_body");
  }
  const out = parse(v);
  if (out === null) throw bad("invalid_body");
  return out;
}

export function viewsHandlers() {
  return {
    async list(c: C): Promise<Response> {
      const want = c.req.query("pin");
      if (want !== undefined && want !== "home" && !/^[a-z0-9][a-z0-9_.:-]{0,127}$/.test(want))
        throw bad("invalid_pin");
      const rows = await mine(c).listByKind(VIEW_KIND, MAX_VIEWS + 1);
      const have = rows.flatMap((row) => {
        const st = storedOf(row);
        if (!st) return [];
        const pinned = st.pin === "home" ? "home" : st.pin.brain;
        return want === undefined || want === pinned ? [{ row, st }] : [];
      });
      have.sort((a, z) => z.row.updatedAt - a.row.updatedAt || a.row.id.localeCompare(z.row.id));
      // One brain-open check per brain, however many views name it.
      const check = readChecker(c);
      const out = await Promise.all(have.map((h) => present(c, h.row, h.st, check)));
      return c.json({ views: out });
    },

    async get(c: C): Promise<Response> {
      const { row, st } = await loadMine(c);
      return c.json(await present(c, row, st, readChecker(c)));
    },

    async create(c: C): Promise<Response> {
      const input = await readBody(c, (v) => {
        const r = SavedViewInput.safeParse(v);
        return r.success ? r.data : null;
      });
      await checkedProgram(c, input.program, input.pin);
      const w = mine(c);
      if ((await w.listByKind(VIEW_KIND, MAX_VIEWS + 1)).length >= MAX_VIEWS)
        return c.json({ error: "too_many_views" }, 409);
      const id = `av_${hex(8)}`;
      if (
        !(await audit(c, {
          action: "agent.pin",
          nodeId: id,
          scopeId: null,
          revision: 1,
          reason: "create",
        }))
      )
        return c.json({ error: "audit_unavailable" }, 503);
      const st: Stored = {
        name: input.name,
        program: input.program,
        pin: input.pin,
        ...(input.layout ? { layout: input.layout } : {}),
      };
      const row = await w.scratch(
        {
          id,
          // The label is not the name: names are the person's words, and stay in the body.
          label: id,
          kind: VIEW_KIND,
          plane: "PERSONAL_HOSTED",
          origin: "personal",
          status: "draft",
          authorId: sess(c).principal.id,
          body: bodyOf(st),
        },
        sess(c).ctx.now,
      );
      return c.json(await present(c, row, st, readChecker(c)), 201);
    },

    async update(c: C): Promise<Response> {
      const { row, st } = await loadMine(c);
      const patch = await readBody(c, (v) => {
        const r = SavedViewInput.partial().safeParse(v);
        return r.success && Object.keys(r.data).length > 0 ? r.data : null;
      });
      const next: Stored = {
        ...st,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.program !== undefined ? { program: patch.program } : {}),
        ...(patch.pin !== undefined ? { pin: patch.pin } : {}),
        ...(patch.layout !== undefined ? { layout: patch.layout } : {}),
      };
      await checkedProgram(c, next.program, next.pin);
      if (
        !(await audit(c, {
          action: "agent.pin",
          nodeId: row.id,
          scopeId: null,
          revision: row.revision,
          reason: "update",
        }))
      )
        return c.json({ error: "audit_unavailable" }, 503);
      const now = sess(c).ctx.now;
      const saved = await mine(c).scratch(
        {
          id: row.id,
          label: row.id,
          kind: VIEW_KIND,
          plane: "PERSONAL_HOSTED",
          origin: "personal",
          status: "draft",
          authorId: sess(c).principal.id,
          body: bodyOf(next),
        },
        now,
      );
      // A share is a link to the plan: it follows the owner's edits.
      if (next.shareId) await writeShare(c, next.shareId, next, now);
      return c.json(await present(c, saved, next, readChecker(c)));
    },

    async remove(c: C): Promise<Response> {
      const { row, st } = await loadMine(c);
      if (
        !(await audit(c, {
          action: "agent.unpin",
          nodeId: row.id,
          scopeId: null,
          revision: null,
          reason: "delete",
        }))
      )
        return c.json({ error: "audit_unavailable" }, 503);
      if (st.shareId) await shares(c).remove(`sh:${st.shareId}`);
      await mine(c).remove(row.id);
      return c.body(null, 204);
    },

    async share(c: C): Promise<Response> {
      const { row, st } = await loadMine(c);
      if (
        !(await audit(c, {
          action: "agent.share",
          nodeId: row.id,
          scopeId: null,
          revision: null,
          reason: "share",
        }))
      )
        return c.json({ error: "audit_unavailable" }, 503);
      const shareId = st.shareId ?? crypto.randomUUID();
      const now = sess(c).ctx.now;
      await writeShare(c, shareId, st, now);
      if (!st.shareId)
        await mine(c).scratch(
          {
            id: row.id,
            label: row.id,
            kind: VIEW_KIND,
            plane: "PERSONAL_HOSTED",
            origin: "personal",
            status: "draft",
            authorId: sess(c).principal.id,
            body: bodyOf({ ...st, shareId }),
          },
          now,
        );
      return c.json({ shareId, path: `/agent/shared/${shareId}` });
    },

    async unshare(c: C): Promise<Response> {
      const { row, st } = await loadMine(c);
      if (
        !(await audit(c, {
          action: "agent.share",
          nodeId: row.id,
          scopeId: null,
          revision: null,
          reason: "revoke",
        }))
      )
        return c.json({ error: "audit_unavailable" }, 503);
      if (st.shareId) {
        await shares(c).remove(`sh:${st.shareId}`);
        const { shareId: _gone, ...rest } = st;
        await mine(c).scratch(
          {
            id: row.id,
            label: row.id,
            kind: VIEW_KIND,
            plane: "PERSONAL_HOSTED",
            origin: "personal",
            status: "draft",
            authorId: sess(c).principal.id,
            body: bodyOf(rest),
          },
          sess(c).ctx.now,
        );
      }
      return c.body(null, 204);
    },

    /** Anyone signed in to the tenant who holds the link. The plan is re-resolved for them. */
    async shared(c: C): Promise<Response> {
      const id = c.req.param("shareId") ?? "";
      if (!SHARE_ID.test(id)) throw notFound();
      const row = await shares(c).get(`sh:${id}`);
      const rec = row && row.kind === SHARE_KIND ? sharedOf(row) : null;
      if (!rec) throw notFound();
      return c.json({ name: rec.name, tree: await treeFor(c, rec.program) });
    },
  };
}

interface SharedRec {
  ownerId: string;
  name: string;
  program: string;
}

function sharedOf(row: ItemRecord): SharedRec | null {
  try {
    const v = JSON.parse(row.body ?? "null") as SharedRec | null;
    return v && typeof v.program === "string" && typeof v.name === "string" ? v : null;
  } catch {
    return null;
  }
}

async function writeShare(c: C, shareId: string, st: Stored, now: number): Promise<void> {
  await shares(c).scratch(
    {
      id: `sh:${shareId}`,
      label: `sh:${shareId}`,
      kind: SHARE_KIND,
      plane: "GLOBAL_NONPERSONAL",
      origin: "personal",
      status: "draft",
      authorId: sess(c).principal.id,
      body: JSON.stringify({ ownerId: sess(c).principal.id, name: st.name, program: st.program }),
    },
    now,
  );
}
