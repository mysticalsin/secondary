// Brain data routes: business fields, hidden versions, import and the journal.

import { roleAllows } from "@secondary/policy";
import { Hono } from "hono";
import { IMPORT_BODY_BYTES } from "../security.ts";
import type { AppDeps, AppEnv } from "../types.ts";
import { audit, bad, type C, notFound, readObject, sess, text } from "../ux/util.ts";
import { classify } from "../uxv2/classifier.ts";
import { pageVisible, readableMany } from "../wiki/routes.ts";
import { citationsOf, cleanText, GENERATED, PAGE_ID } from "../wiki/text.ts";
import type { PageDraft, Proposal } from "../wiki/types.ts";
import { checkWrite, fieldsFor } from "./fields.ts";
import {
  type ImportDoc,
  type ImportFormat,
  isImportFormat,
  MAX_PAGES,
  parseObsidian,
  parseOkf,
  parseOutline,
} from "./importers.ts";
import { DAY, FIELD_TYPES, isCalendarDay, parseFields, SENSITIVITIES } from "./model.ts";
import { type Brain, needBrain, needFlag } from "./open.ts";
import { rateLimit } from "./shared.ts";
import { unzipGuarded, ZipError } from "./unzip.ts";

const MAX_REASON = 200;

/** A page of the brain the caller may read, or 404. */
async function readablePage(c: C, b: Brain, pid: string) {
  if (!PAGE_ID.test(pid)) throw notFound();
  const page = await b.stub.wikiPage(pid);
  if (!page || page.status !== "published") throw notFound();
  const ok = (
    await readableMany(c, [
      { w: { view: b.view, personal: b.personal, stub: b.stub }, ids: citationsOf(page.markdown) },
    ])
  )[0];
  if (!ok || !pageVisible(citationsOf(page.markdown), ok)) throw notFound();
  return page;
}

export function dataRoutes(_deps: AppDeps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  // ---- business fields ----

  r.get("/brains/:id/fields", async (c) => {
    const b = await needBrain(c, c.req.param("id"), "read");
    if (b instanceof Response) return b;
    const config = await b.stub.brainConfig();
    c.header("Cache-Control", "no-store");
    return c.json({ fields: config.fields, types: FIELD_TYPES, sensitivities: SENSITIVITIES });
  });

  r.put("/brains/:id/fields", async (c) => {
    const b = await needBrain(c, c.req.param("id"), "manage");
    if (b instanceof Response) return b;
    const body = await readObject(c);
    const parsed = parseFields(body.fields);
    if (!parsed.ok) throw bad(parsed.code);
    const s = sess(c);
    if (
      !(await audit(c, {
        action: "brain.fields_schema",
        nodeId: b.nodeId,
        scopeId: b.scope,
        revision: null,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    await b.stub.brainConfigSet({ fields: parsed.fields }, s.principal.id, s.ctx.now);
    return c.json({ ok: true, fields: parsed.fields });
  });

  r.get("/brains/:id/pages/:pid/fields", async (c) => {
    const b = await needBrain(c, c.req.param("id"), "read");
    if (b instanceof Response) return b;
    const page = await readablePage(c, b, c.req.param("pid"));
    c.header("Cache-Control", "no-store");
    return c.json({ pageId: page.id, fields: await fieldsFor(c, b, page) });
  });

  r.put("/brains/:id/pages/:pid/fields", async (c) => {
    const b = await needBrain(c, c.req.param("id"), "edit");
    if (b instanceof Response) return b;
    const page = await readablePage(c, b, c.req.param("pid"));
    const body = await readObject(c);
    const ack = Array.isArray(body.acknowledgedFlags)
      ? body.acknowledgedFlags.filter((x): x is string => typeof x === "string").slice(0, 50)
      : [];
    const config = await b.stub.brainConfig();
    const res = checkWrite(b, config.fields, page.type, body.values, ack);
    if (!res.ok) return c.json(res.body, res.status);
    const s = sess(c);
    if (
      !(await audit(c, {
        action: "brain.fields_write",
        nodeId: b.nodeId,
        scopeId: b.scope,
        revision: page.revision,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    await b.stub.brainFieldsWrite(page.id, res.writes, s.principal.id, s.ctx.now);
    return c.json({ ok: true, fields: await fieldsFor(c, b, page) });
  });

  // ---- hidden versions ----

  r.get("/brains/:id/pages/:pid/versions", async (c) => {
    const b = await needBrain(c, c.req.param("id"), "read");
    if (b instanceof Response) return b;
    const page = await readablePage(c, b, c.req.param("pid"));
    const editor = b.can.edit && roleAllows(b.role, "edit");
    const rows = await b.stub.brainVersions(page.id, 50);
    c.header("Cache-Control", "no-store");
    return c.json({
      versions: rows.map((v) =>
        v.hidden && !editor
          ? { revision: v.revision, at: new Date(v.at).toISOString(), hidden: true }
          : {
              revision: v.revision,
              at: new Date(v.at).toISOString(),
              actor: v.actor,
              hidden: v.hidden,
              ...(v.hidden && v.hiddenAt
                ? {
                    hiddenAt: new Date(v.hiddenAt).toISOString(),
                    hiddenBy: v.hiddenBy,
                    reason: v.reason,
                  }
                : {}),
            },
      ),
    });
  });

  for (const hide of [true, false]) {
    r.post(`/brains/:id/pages/:pid/versions/:rev/${hide ? "hide" : "restore"}`, async (c) => {
      const b = await needBrain(c, c.req.param("id"), "edit");
      if (b instanceof Response) return b;
      const page = await readablePage(c, b, c.req.param("pid"));
      const rev = Number(c.req.param("rev"));
      if (!Number.isInteger(rev) || rev < 1) throw bad("invalid_revision");
      const body = hide ? await readObject(c) : {};
      const reason = hide
        ? cleanText(text(body.reason, 1, MAX_REASON, "invalid_reason"), MAX_REASON)
        : "";
      const s = sess(c);
      if (
        !(await audit(c, {
          action: hide ? "brain.version_hide" : "brain.version_restore",
          nodeId: b.nodeId,
          scopeId: b.scope,
          revision: rev,
        }))
      )
        return c.json({ error: "audit_unavailable" }, 503);
      const res = await b.stub.brainSetHidden(
        page.id,
        rev,
        hide,
        s.principal.id,
        reason,
        s.ctx.now,
      );
      if (!res.ok) {
        const status = res.code === "not_found" ? 404 : res.code === "current_revision" ? 422 : 409;
        return c.json({ error: res.code, reason: res.message }, status);
      }
      return c.json({ ok: true });
    });
  }

  // ---- import ----

  r.post("/brains/:id/import", async (c) => {
    const f = await needFlag(c, "imports");
    if (f) return f;
    const b = await needBrain(c, c.req.param("id"), "contribute");
    if (b instanceof Response) return b;
    const format = c.req.query("format");
    if (!isImportFormat(format)) throw bad("invalid_format");
    const limited = await rateLimit(c, "brain_import", 5);
    if (limited) return limited;
    const declared = Number(c.req.header("Content-Length") ?? "0");
    if (declared > IMPORT_BODY_BYTES)
      return c.json({ error: "too_large", reason: "The archive is larger than 5 MB" }, 413);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.length > IMPORT_BODY_BYTES)
      return c.json({ error: "too_large", reason: "The archive is larger than 5 MB" }, 413);
    if (!bytes.length) return c.json({ error: "invalid_archive", reason: "Empty body" }, 422);

    let parsed: ReturnType<typeof parseOkf>;
    try {
      const isJson = (c.req.header("Content-Type") ?? "")
        .toLowerCase()
        .startsWith("application/json");
      if (format === "outline" && isJson)
        parsed = parseOutline({ json: new TextDecoder().decode(bytes) });
      else {
        const entries = await unzipGuarded(bytes);
        parsed =
          format === "okf"
            ? parseOkf(entries)
            : format === "obsidian"
              ? parseObsidian(entries)
              : parseOutline({ zip: entries });
      }
    } catch (e) {
      if (e instanceof ZipError)
        return c.json({ error: e.code, reason: e.reason }, e.code === "too_large" ? 413 : 422);
      throw e;
    }
    if (
      !(await audit(c, {
        action: "brain.import",
        nodeId: b.nodeId,
        scopeId: b.scope,
        revision: null,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    return runImport(c, b, format, parsed);
  });

  // ---- journal ----

  r.get("/brains/:id/journal", async (c) => {
    const f = await needFlag(c, "journal");
    if (f) return f;
    const b = await needBrain(c, c.req.param("id"), "read");
    if (b instanceof Response) return b;
    c.header("Cache-Control", "no-store");
    return c.json({ days: await b.stub.brainJournalDays(60) });
  });

  r.post("/brains/:id/journal/run", async (c) => {
    const f = await needFlag(c, "journal");
    if (f) return f;
    const b = await needBrain(c, c.req.param("id"), "edit");
    if (b instanceof Response) return b;
    const s = sess(c);
    const raw = c.req.header("Content-Length") === "0" ? {} : await readObject(c).catch(() => ({}));
    const yesterday = new Date(s.ctx.now - DAY).toISOString().slice(0, 10);
    const date = typeof raw.date === "string" ? raw.date : yesterday;
    if (!isCalendarDay(date) || date < "2020-01-01") throw bad("invalid_date");
    if (date > new Date(s.ctx.now).toISOString().slice(0, 10)) throw bad("invalid_date");
    if (
      !(await audit(c, {
        action: "brain.journal_run",
        nodeId: b.nodeId,
        scopeId: b.scope,
        revision: null,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    const res = await b.stub.brainJournalRun(date, s.ctx.now);
    return c.json({ ok: true, pageId: res.pageId, created: res.created });
  });

  return r;
}

type ImportOut = {
  pageId: string;
  title: string;
  state: "published" | "draft";
  proposalId?: string;
};

async function runImport(
  c: C,
  b: Brain,
  format: ImportFormat,
  parsed: { docs: ImportDoc[]; skipped: { path: string; reason: string }[] },
): Promise<Response> {
  const s = sess(c);
  const schema = await b.stub.wikiSchema();
  const fallback = schema.types.topic
    ? "topic"
    : (Object.keys(schema.types).find((t) => !GENERATED[t] && t !== "journal") ?? "topic");
  const skipped = [...parsed.skipped];
  const imported: ImportOut[] = [];
  let asked = 0;
  for (const d of parsed.docs.slice(0, MAX_PAGES)) {
    // Every page goes through the same classifier the routines use: personal passages come out,
    // contact details are masked, HR and mostly-personal pages are skipped.
    const verdict = classify(
      { key: d.path, title: d.title, text: d.markdown },
      { excludeNewsletters: false },
    );
    if (verdict.verdict === "skip" || !verdict.kept.trim()) {
      skipped.push({ path: d.path, reason: verdict.reason });
      continue;
    }
    if (verdict.verdict === "ask") asked++;
    const cur = await b.stub.wikiPage(d.pageId);
    if (cur && (GENERATED[cur.type] || cur.type === "journal")) {
      skipped.push({ path: d.path, reason: "reserved_page" });
      continue;
    }
    const type =
      cur?.type ??
      (d.type && schema.types[d.type] && !GENERATED[d.type] && d.type !== "journal"
        ? d.type
        : fallback);
    const draft: PageDraft = {
      pageId: d.pageId,
      type,
      title: cleanText(d.title, 120) || d.pageId,
      baseRevision: cur?.revision ?? null,
      markdown: verdict.kept,
    };
    // Direct only in the Personal Brain, for a page the classifier is sure about and that replaces nothing.
    const publishDirect = b.personal && verdict.verdict === "ingest" && !cur;
    const res = await b.stub.wikiPropose(
      {
        kind: "wiki_ingest",
        title: `Import: ${draft.title}`.slice(0, 200),
        rationale: `Imported from ${format}`,
        origin: "human",
        pages: [draft],
        facts: [],
        invalidate: [],
        confirm: [],
        archive: [],
        reingest: [],
        sources: [],
        findingKey: null,
      } satisfies Omit<Proposal, "v" | "pages"> & { pages: PageDraft[] },
      s.principal.id,
      s.ctx.now,
      { plane: b.plane, readable: [], ...(publishDirect ? { publishDirect: true } : {}) },
    );
    if (!res.ok || !res.created) {
      skipped.push({ path: d.path, reason: res.ok ? res.reason : res.message });
      continue;
    }
    imported.push({
      pageId: d.pageId,
      title: draft.title,
      state: res.autoAccepted ? "published" : "draft",
      proposalId: res.id,
    });
  }
  c.header("Cache-Control", "no-store");
  return c.json({ ok: true, format, imported, skipped, asked });
}
