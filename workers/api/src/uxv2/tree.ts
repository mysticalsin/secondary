// GET /v1/brain/tree?root=personal|company: the Brain explorer's folders. Roots are the workspaces in
// the caller's admitted view, folders are the wiki page types, leaves are pages. A workspace the caller
// can see by name only is "locked" (name, no children). A workspace the view does not reach is absent,
// so an NDA account the caller has no grant for leaves no trace. Pages whose cited sources the caller
// cannot read are left out, and a folder that lost pages says "partial".

import { isPersonalKind } from "@secondary/policy";
import { Hono } from "hono";
import { viewOf } from "../auth.ts";
import { scopeOfNode } from "../scope.ts";
import type { AppEnv } from "../types.ts";
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
  access: "full" | "partial" | "locked";
  count?: number;
  children?: TreeNode[];
};

const MAX_PAGES_PER_FOLDER = 200;

export function treeRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get("/brain/tree", async (c) => {
    const root = c.req.query("root");
    if (root !== undefined && root !== "personal" && root !== "company")
      throw badRequest("invalid_root");
    return c.json({ roots: await brainTree(c, root) });
  });

  return r;
}

export async function brainTree(
  c: C,
  root: "personal" | "company" | undefined,
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
              vn.level !== "content" &&
              scopeOfNode(vn) !== null,
          )
          .map((vn) => ({
            id: vn.id,
            label: vn.label,
            kind: "workspace" as const,
            access: "locked" as const,
          }));

  const per = await Promise.all(
    wanted.map(async (t) => {
      const stub = stubOf(c, t.scope);
      const [pages, schema] = await Promise.all([stub.wikiPages(), stub.wikiSchema()]);
      return { t, stub, pages, schema };
    }),
  );
  const oks = await readableMany(
    c,
    per.map((p) => ({
      w: { view, personal: p.t.personal, stub: p.stub },
      ids: p.pages.flatMap((x) => citationsOf(x.markdown)),
    })),
  );

  const open: TreeNode[] = per.map((p, i) => {
    const ok = oks[i] as Parameters<typeof pageVisible>[1];
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
  return [...open, ...locked].sort(
    (a, b) => Number(b.id === "me") - Number(a.id === "me") || a.label.localeCompare(b.label),
  );
}
