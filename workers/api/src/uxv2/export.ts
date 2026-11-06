// GET /v1/brain/export?workspaceId=: the brain as portable Markdown, in Open Knowledge Format v0.2
// (decision D17). One folder per wiki page type, `index.md` and `log.md` at every level, one `.md`
// concept page per wiki page with frontmatter (`type` is required). Only what the caller may read is
// written: a page with no readable source is left out, a line that rests on an unreadable source is
// dropped, and the Personal Brain is only ever the caller's own.

import type { ContentFlag } from "@secondary/policy";
import { Hono } from "hono";
import { viewOf } from "../auth.ts";
import { exportProperties } from "../brains/fields.ts";
import { ruleGate } from "../rules/gate.ts";
import { tenantStub } from "../stubs.ts";
import type { AppEnv } from "../types.ts";
import { audit, sess } from "../ux/util.ts";
import {
  canGlobal,
  filterMarkdown,
  pageVisible,
  type Readable,
  readableMany,
} from "../wiki/routes.ts";
import { citationsOf, summaryOf } from "../wiki/text.ts";
import { badRequest, resolveTarget, stubOf } from "./shared.ts";
import { zip } from "./zip.ts";

const EXPORTS_PER_MIN = 5;
const DAY = 86_400_000;
const FOLDER = /[^a-z0-9_-]/g;

const yaml = (v: unknown): string => JSON.stringify(v);
const oneLine = (s: string, n = 160): string => s.replace(/\s+/g, " ").trim().slice(0, n);

function frontmatter(f: Record<string, unknown>): string {
  return `---\n${Object.entries(f)
    .map(([k, v]) => `${k}: ${yaml(v)}`)
    .join("\n")}\n---\n\n`;
}

export function exportRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get("/brain/export", async (c) => {
    const s = sess(c);
    const param = c.req.query("workspaceId");
    if (!param) throw badRequest("invalid_workspace");
    // The Personal Brain is `me`, and `me` is always the caller's own. Anything the view does not
    // reach at content level is absent.
    const t = resolveTarget(c, param, "read");
    if (!t) return c.json({ error: "not_found" }, 404);
    const limited = await tenantStub(c.env, s.tenantId).hit(
      `uxv2_export:${s.principal.id}`,
      s.ctx.now,
      EXPORTS_PER_MIN,
    );
    if (limited.limited) {
      c.header("Retry-After", String(limited.retryAfter));
      return c.json({ error: "rate_limited" }, 429);
    }
    const view = viewOf(s);
    const stub = stubOf(c, t.scope);
    const [pages, facts, schema, meta, brain, fieldValues] = await Promise.all([
      stub.wikiPages(),
      stub.wikiFacts({ validOnly: true, limit: 2_000 }),
      stub.wikiSchema(),
      stub.wikiMeta(),
      stub.brainConfig(),
      stub.brainAllFieldValues(),
    ]);
    const ok = (
      await readableMany(c, [
        {
          w: { view, personal: t.personal, stub },
          ids: [
            ...pages.flatMap((p) => citationsOf(p.markdown)),
            ...facts.flatMap((f) => f.sourceIds),
          ],
        },
      ])
    )[0] as Readable;
    const g = canGlobal(view);
    const freshness = (meta?.freshnessDays ?? 180) * DAY;
    const generated = new Date(s.ctx.now).toISOString();

    type Out = {
      folder: string;
      id: string;
      title: string;
      description: string;
      updatedAt: number;
      revision: number;
      file: string;
      text: string;
    };
    const shown = pages
      .filter((p) => pageVisible(citationsOf(p.markdown), ok))
      .map((p) => {
        const f = filterMarkdown(p.markdown, ok, g);
        return {
          p,
          text: f.text.replace(/\[\[global:[A-Za-z0-9_-]+\]\]/g, ""),
          folder: p.type.toLowerCase().replace(FOLDER, "") || "other",
        };
      });
    // Brain rules (v7): block, or hold the export until an approver says yes. The receipt comes after
    // the gate and before anything leaves, so an export is never returned without its receipt.
    const flags: ContentFlag[] = [];
    if (
      brain.fields.some(
        (f) => f.sensitivity === "confidential" && fieldValues.some((v) => v.key === f.key),
      )
    )
      flags.push("confidential_field");
    const rg = await ruleGate(c, {
      action: "export",
      brain: { nodeId: t.nodeId, personal: t.personal, vn: view.nodes.get(t.nodeId) ?? null },
      pages: shown.length,
      flags,
      mode: "hold",
    });
    if (rg.response) return rg.response;
    if (
      !(await audit(c, {
        action: "brain.export",
        nodeId: t.nodeId,
        scopeId: t.scope,
        revision: null,
        ...rg.rx,
      }))
    ) {
      await rg.refund();
      return c.json({ error: "audit_unavailable" }, 503);
    }
    const known = new Map(shown.map((x) => [x.p.id, x]));
    const files: { path: string; content: string }[] = [];
    const outs: Out[] = [];
    for (const x of shown) {
      const cites = citationsOf(x.p.markdown).filter((id) => ok.has(id));
      const body = x.text
        .replace(/\[\[([A-Za-z0-9:_-]{1,70})\]\]/g, (_m, id: string) => {
          const to = known.get(id);
          return to ? `[${to.p.title}](/${to.folder}/${to.p.id}.md)` : "";
        })
        .replace(/ ?\{src:[^}]+\}/g, "")
        .trim();
      // "Verified" means every valid fact drawn only from this page's readable sources was confirmed by a person.
      const backing = facts.filter(
        (f) => f.sourceIds.length > 0 && f.sourceIds.every((id) => cites.includes(id)),
      );
      const description = oneLine(summaryOf(x.text));
      const path = `${x.folder}/${x.p.id}.md`;
      // The export filter: only fields whose sensitivity is none leave the brain.
      const properties = exportProperties(brain.fields, fieldValues, x.p);
      files.push({
        path,
        content:
          frontmatter({
            type: x.p.type,
            title: x.p.title,
            description,
            tags: [x.p.type],
            sources: cites,
            generated,
            verified: backing.length > 0 && backing.every((f) => f.verifiedBy !== null),
            status: x.p.status,
            origin: x.p.origin,
            ...(x.p.origin === "seed" ? { synthetic: "Synthetic seed (dev data)" } : {}),
            ...(Object.keys(properties).length ? { properties } : {}),
            stale_after: new Date(x.p.updatedAt + freshness).toISOString().slice(0, 10),
          }) + body,
      });
      outs.push({
        folder: x.folder,
        id: x.p.id,
        title: x.p.title,
        description,
        updatedAt: x.p.updatedAt,
        revision: x.p.revision,
        file: path,
        text: body,
      });
    }

    const bullet = (o: Out) => `- [${o.title}](/${o.file}): ${o.description || "No summary yet"}`;
    const logLine = (o: Out) =>
      `- ${new Date(o.updatedAt).toISOString().slice(0, 10)}: updated [${o.title}](/${o.file}), revision ${o.revision}`;
    const folders = [...new Set(outs.map((o) => o.folder))].sort();
    const labelOf = (folder: string): string =>
      Object.entries(schema.types).find(
        ([k]) => k.toLowerCase().replace(FOLDER, "") === folder,
      )?.[1].label ?? folder;
    for (const folder of folders) {
      const list = outs
        .filter((o) => o.folder === folder)
        .sort((a, b) => a.title.localeCompare(b.title));
      files.push({
        path: `${folder}/index.md`,
        content: `# ${labelOf(folder)}\n\n${list.map(bullet).join("\n")}\n`,
      });
      files.push({
        path: `${folder}/log.md`,
        content: `# Log: ${labelOf(folder)}\n\n${[...list]
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map(logLine)
          .join("\n")}\n`,
      });
    }
    files.push({
      path: "index.md",
      content: `# ${t.label}\n\n${folders
        .map(
          (f) =>
            `## ${labelOf(f)}\n\n${outs
              .filter((o) => o.folder === f)
              .sort((a, b) => a.title.localeCompare(b.title))
              .map(bullet)
              .join("\n")}\n`,
        )
        .join("\n")}`,
    });
    files.push({
      path: "log.md",
      content: `# Log\n\n${[...outs]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(logLine)
        .join("\n")}${outs.length ? "\n" : ""}`,
    });

    const bytes = zip(files, s.ctx.now);
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="brain-${t.param.replace(/[^A-Za-z0-9_-]/g, "_")}-okf.zip"`,
        "Cache-Control": "no-store",
      },
    });
  });

  return r;
}
