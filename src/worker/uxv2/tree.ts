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
import { badRequest, stubOf, type Target, WIKI_NODE_KINDS } from "./shared.ts";

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

function aborted(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

/** One brain has this long to answer. A miss is that brain alone; the others are still returned. */
function within<T>(ms: number, work: (signal: AbortSignal) => Promise<T>): Promise<T | "miss"> {
  const ac = new AbortController();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      ac.abort();
      resolve("miss");
    }, ms);
    work(ac.signal).then(
      (value) => {
        clearTimeout(timer);
        resolve(ac.signal.aborted ? "miss" : value);
      },
      () => {
        clearTimeout(timer);
        resolve("miss");
      },
    );
  });
}

export function treeRoutes(deps: AppDeps = {}): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const ms = deps.treeBoundMs ?? TREE_BOUND_MS;

  r.get("/brain/tree", async (c) => {
    const root = c.req.query("root");
    if (root !== undefined && root !== "personal" && root !== "company")
      throw badRequest("invalid_root");
    return c.json({ roots: await brainTree(c, root, ms) });
  });

  return r;
}

export async function brainTree(
  c: C,
  root: "personal" | "company" | undefined,
  ms = TREE_BOUND_MS,
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
        const [pages, schema] = await Promise.all([stub.wikiPages(), stub.wikiSchema()]);
        if (signal.aborted) throw aborted();
        const [ok] = await readableMany(c, [
          {
            w: { view, personal: t.personal, stub },
            ids: pages.flatMap((x) => citationsOf(x.markdown)),
          },
        ]);
        if (signal.aborted) throw aborted();
        return { pages, schema, ok };
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
