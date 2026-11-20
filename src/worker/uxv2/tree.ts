// GET /v1/brain/tree?root=personal|company: the Brain explorer's folders. Roots are the workspaces in
// the caller's admitted view, folders are the wiki page types, leaves are pages. A workspace the caller
// can see by name only is "locked" (name, no children). A workspace the view does not reach is absent,
// so an NDA account the caller has no grant for leaves no trace. Pages whose cited sources the caller
// cannot read are left out, and a folder that lost pages says "partial". A brain that does not
// answer within the bound is returned as "degraded" so the others are not held.

import { isPersonalKind, opensBrain } from "@secondary/policy";
import { Hono } from "hono";
import { viewOf } from "../auth.ts";
import { scopeOfNode } from "../scope.ts";
import type { AppDeps, AppEnv } from "../types.ts";
import { type C, sess } from "../ux/util.ts";
import {
  admittedWikis,
  canGlobal,
  filterMarkdown,
  pageVisible,
  readableMany,
} from "../wiki/routes.ts";
import { citationsOf } from "../wiki/text.ts";
import { inflightKey, loadRaw } from "./inflight.ts";
import { badRequest, stubOf, type Target, WIKI_NODE_KINDS } from "./shared.ts";

export { inflightKey };

export type TreeNode = {
  id: string;
  label: string;
  kind: "workspace" | "folder" | "page";
  access: "full" | "partial" | "locked" | "degraded";
  count?: number;
  children?: TreeNode[];
};

const MAX_PAGES_PER_FOLDER = 200;
const TREE_BOUND_MS = 2_500;

function holdOf(c: C): ((promise: Promise<unknown>) => void) | null {
  try {
    const ctx = (c as { executionCtx?: { waitUntil?: (promise: Promise<unknown>) => void } })
      .executionCtx;
    if (!ctx || typeof ctx.waitUntil !== "function") return null;
    return (promise) => ctx.waitUntil!(promise);
  } catch {
    return null;
  }
}

/**
 * One brain has this long to answer. The timer ends the wait. `wikiPages` takes no signal, so
 * that SQL read runs to completion. A value that arrives in the abort turn is left out of the
 * response. A read that never settles is a miss on the following turn, so one hung brain does
 * not hold the others.
 */
function within<T>(ms: number, work: (signal: AbortSignal) => Promise<T>): Promise<T | "miss"> {
  const ac = new AbortController();
  return new Promise((resolve) => {
    let settled = false;
    let safety: ReturnType<typeof setTimeout> | undefined;
    const finish = (value: T | "miss") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (safety !== undefined) clearTimeout(safety);
      resolve(value);
    };
    const timer = setTimeout(() => ac.abort(), ms);
    // The work may register its abort listener before this one, so a late resolve is queued
    // first and the miss rule leaves it out of the response. This listener ends the wait when
    // the read ignores the signal. It does not cancel wikiPages.
    const pending = work(ac.signal);
    ac.signal.addEventListener(
      "abort",
      () => {
        safety = setTimeout(() => finish("miss"), 0);
      },
      { once: true },
    );
    pending.then(
      (value) => finish(ac.signal.aborted ? "miss" : value),
      () => finish("miss"),
    );
  });
}

export function treeRoutes(deps: AppDeps = {}): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const ms = deps.treeBoundMs ?? TREE_BOUND_MS;
  const now = () => deps.now?.() ?? Date.now();

  r.get("/brain/tree", async (c) => {
    const root = c.req.query("root");
    if (root !== undefined && root !== "personal" && root !== "company")
      throw badRequest("invalid_root");
    return c.json({ roots: await brainTree(c, root, ms, now) });
  });

  return r;
}

export async function brainTree(
  c: C,
  root: "personal" | "company" | undefined,
  ms = TREE_BOUND_MS,
  now: () => number = Date.now,
): Promise<TreeNode[]> {
  const s = sess(c);
  const view = viewOf(s);
  const g = canGlobal(view);
  const readable = admittedWikis(c).map(
    (w): Target => ({
      param: w.param,
      nodeId: w.nodeId,
      scope: w.scope,
      label: w.label,
      personal: w.scope.startsWith("personal:"),
    }),
  );
  const wanted = readable.filter((t) =>
    root === undefined ? true : root === "personal" ? t.personal : !t.personal,
  );
  // Workspaces the caller sees by name only: in the view, a wiki kind, but not at content level.
  const locked: TreeNode[] =
    root === "personal"
      ? []
      : [...view.nodes.values()]
          .filter(
            (vn) =>
              WIKI_NODE_KINDS.has(vn.kind) &&
              !isPersonalKind(vn.kind) &&
              !opensBrain(vn) &&
              scopeOfNode(vn) !== null,
          )
          .map((vn) => ({
            id: vn.id,
            label: vn.label,
            kind: "workspace" as const,
            access: "locked" as const,
          }));

  const settled = await Promise.all(
    wanted.map(async (t) => {
      const stub = stubOf(c, t.scope);
      const read = await within(ms, async (signal) => {
        // The real wikiPages() takes no signal. The extra argument does not cancel the SQL read.
        const readPages = stub.wikiPages as (
          signal?: AbortSignal,
        ) => ReturnType<typeof stub.wikiPages>;
        const raw = await loadRaw({
          tenantId: s.tenantId,
          scope: t.scope,
          now: now(),
          hold: holdOf(c),
          read: async () => {
            const [pages, schema] = await Promise.all([
              Promise.resolve(readPages(signal)),
              Promise.resolve(stub.wikiSchema()),
            ]);
            return { pages, schema };
          },
        });
        if (!raw.ok) throw new Error("tree_inflight_rejected");
        const [ok] = await readableMany(c, [
          {
            w: { view, personal: t.personal, stub },
            ids: raw.pages.flatMap((x) => citationsOf(x.markdown)),
          },
        ]);
        return { pages: raw.pages, schema: raw.schema, ok };
      });
      if (read === "miss") return { t, miss: true as const };
      return { t, miss: false as const, ...read };
    }),
  );
  const per = settled.filter((p) => !p.miss);
  const degraded: TreeNode[] = settled
    .filter((p) => p.miss)
    .map((p) => ({
      id: p.t.param,
      label: p.t.label,
      kind: "workspace" as const,
      access: "degraded" as const,
    }));

  const open: TreeNode[] = per.map((p) => {
    const ok = p.ok as Parameters<typeof pageVisible>[1];
    let hidden = 0;
    const byType = new Map<string, TreeNode[]>();
    const partialType = new Set<string>();
    for (const page of p.pages) {
      const cites = citationsOf(page.markdown);
      if (!pageVisible(cites, ok)) {
        hidden++;
        partialType.add(page.type);
        continue;
      }
      if (filterMarkdown(page.markdown, ok, g).dropped > 0) partialType.add(page.type);
      const list = byType.get(page.type) ?? [];
      list.push({ id: `${p.t.param}/${page.id}`, label: page.title, kind: "page", access: "full" });
      byType.set(page.type, list);
    }
    const folders: TreeNode[] = [...byType.entries()]
      .map(([type, pages]) => {
        const sorted = pages.sort((a, b) => a.label.localeCompare(b.label));
        return {
          id: `${p.t.param}#${type}`,
          label: p.schema.types[type]?.label ?? type,
          kind: "folder" as const,
          access: partialType.has(type) ? ("partial" as const) : ("full" as const),
          count: sorted.length,
          children: sorted.slice(0, MAX_PAGES_PER_FOLDER),
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
    return {
      id: p.t.param,
      label: p.t.label,
      kind: "workspace" as const,
      access: hidden > 0 || folders.some((f) => f.access === "partial") ? "partial" : "full",
      count: folders.reduce((n, f) => n + (f.count ?? 0), 0),
      children: folders,
    };
  });
  // The Personal Brain first, then company workspaces by name.
  return [...open, ...locked, ...degraded].sort(
    (a, b) => Number(b.id === "me") - Number(a.id === "me") || a.label.localeCompare(b.label),
  );
}
