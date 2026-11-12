/**
 * Every workspace table is either primary or derived.
 * Wipe empties every derived table, and the erasure path clears a planted secret from each one.
 * A new table fails until it is classified, and a new derived table fails until both paths clear it.
 */

import assert from "node:assert/strict";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sqliteStorage } from "../runtime/sqlite-storage.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const NOW = 1_700_000_000_000;
const workspaceSpecifier = "../../recovered-source/worker/src/workspace.ts";

/** SQLite bookkeeping. Named exactly; a new internal table is unclassified until it is listed here. */
const SQLITE_INTERNAL = ["sqlite_sequence"];

/** FTS5 shadow tables for items_fts, source_fts, and wiki_fts. */
const FTS_SHADOWS = [
  "items_fts_config",
  "items_fts_content",
  "items_fts_data",
  "items_fts_docsize",
  "items_fts_idx",
  "source_fts_config",
  "source_fts_content",
  "source_fts_data",
  "source_fts_docsize",
  "source_fts_idx",
  "wiki_fts_config",
  "wiki_fts_content",
  "wiki_fts_data",
  "wiki_fts_docsize",
  "wiki_fts_idx",
];

const PRIMARY = [
  "approvals",
  "brain_coach",
  "brain_members",
  "comments",
  "contributions",
  "edits",
  "items",
  "outbox",
  "source_items",
  "wiki_facts",
  "wiki_findings",
  "wiki_jobs",
  "wiki_log",
  "wiki_meta",
  "wiki_pages",
  "wiki_promotions",
  "wiki_schema",
  "wiki_sources",
];

const DERIVED = [
  "brain_fields",
  "items_fts",
  "revisions",
  "source_fts",
  "wiki_fts",
  "wiki_page_revisions",
];

type Workspace = {
  wipe(): number;
  wikiForgetSources(ids: string[], now: number): { facts: number; pages: number; proposals: number };
  purgeExpired(cutoffs: Record<string, number>): number;
  pseudonymise(from: string, to: string, aliases?: string[]): {
    items: number;
    comments: number;
    approvals: number;
    edits: number;
  };
};

function openCtx(db: DatabaseSync): { ctx: unknown; ready: () => Promise<unknown> } {
  let ready: Promise<unknown> = Promise.resolve();
  return {
    ctx: {
      storage: {
        sql: sqliteStorage(db),
        transactionSync<T>(fn: () => T): T {
          return fn();
        },
        setAlarm() {},
      },
      blockConcurrencyWhile(fn: () => Promise<unknown>) {
        ready = fn();
        return ready;
      },
    },
    ready: () => ready,
  };
}

async function openWorkspace(db: DatabaseSync): Promise<Workspace> {
  const { ctx, ready } = openCtx(db);
  const mod = (await import(workspaceSpecifier)) as {
    Workspace: new (ctx: unknown, env: unknown) => Workspace;
  };
  const ws = new mod.Workspace(ctx, { WIKI_ALARMS: "off" });
  await ready();
  return ws;
}

function schemaTables(db: DatabaseSync): string[] {
  return (
    db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual') ORDER BY name`,
      )
      .all() as { name: string }[]
  ).map((row) => row.name);
}

function coverage(db: DatabaseSync): {
  found: string[];
  unclassified: string[];
  missing: string[];
  overlap: string[];
  unknownExclusion: string[];
} {
  const all = schemaTables(db);
  const excluded = [...SQLITE_INTERNAL, ...FTS_SHADOWS];
  const skip = new Set(excluded);
  const primary = new Set(PRIMARY);
  const derived = new Set(DERIVED);
  const present = all.filter((name) => !skip.has(name));
  return {
    found: present.filter((name) => derived.has(name)),
    unclassified: present.filter((name) => !primary.has(name) && !derived.has(name)),
    missing: [...PRIMARY, ...DERIVED].filter((name) => !present.includes(name)),
    overlap: PRIMARY.filter((name) => derived.has(name)),
    unknownExclusion: excluded.filter((name) => !all.includes(name)),
  };
}

function count(db: DatabaseSync, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return row.n;
}

function dump(db: DatabaseSync, table: string): string {
  return JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all());
}

test("wipe empties every derived table the schema creates", async () => {
  const db = new DatabaseSync(":memory:");
  const ws = await openWorkspace(db);
  const schema = coverage(db);
  const found = schema.found;
  db.prepare(
    "INSERT INTO brain_fields (page_id, field_key, value, written_by, written_at) VALUES ('p', 'note', 'SECRET-FIELD', 'ada', 1)",
  ).run();
  db.prepare("INSERT INTO items_fts (label, id) VALUES ('SECRET-ITEM', 'item')").run();
  db.prepare(
    "INSERT INTO revisions (item_id, revision, label, body, actor_id, at) VALUES ('item', 1, 'SECRET-REV', 'SECRET-REV', 'ada', 1)",
  ).run();
  db.prepare("INSERT INTO source_fts (title, body, id) VALUES ('SECRET-SOURCE', 'SECRET-SOURCE', 'src')").run();
  db.prepare("INSERT INTO wiki_fts (title, summary, body, id) VALUES ('SECRET-WIKI', '', 'SECRET-WIKI', 'page')").run();
  db.prepare(
    "INSERT INTO wiki_page_revisions (page_id, revision, title, markdown, actor, at) VALUES ('page', 1, 'Page', 'SECRET-PAGE', 'ada', 1)",
  ).run();
  ws.wipe();
  ws.wipe();
  assert.deepEqual(
    {
      schema: {
        unclassified: schema.unclassified,
        missing: schema.missing,
        overlap: schema.overlap,
        unknownExclusion: schema.unknownExclusion,
      },
      found,
      left: found.map((table) => count(db, table)),
    },
    {
      schema: { unclassified: [], missing: [], overlap: [], unknownExclusion: [] },
      found: DERIVED,
      left: DERIVED.map(() => 0),
    },
  );
  db.close();
});

test("the erasure path clears every derived table the schema creates", async () => {
  const db = new DatabaseSync(":memory:");
  const ws = await openWorkspace(db);
  const schema = coverage(db);
  const found = schema.found;
  db.prepare(
    `INSERT INTO wiki_pages (id, type, title, markdown, summary, revision, status, created_at, updated_at)
     VALUES ('kept', 'concept', 'Kept', ?, '', 1, 'published', 1, 1)`,
  ).run("Keep\nSECRET-PAGE {src:src_1}");
  db.prepare(
    "INSERT INTO wiki_page_revisions (page_id, revision, title, markdown, actor, at) VALUES ('kept', 1, 'Kept', ?, 'ada', 1)",
  ).run("Keep\nSECRET-PAGE {src:src_1}");
  db.prepare("INSERT INTO wiki_fts (title, summary, body, id) VALUES ('Kept', '', 'SECRET-PAGE', 'kept')").run();
  db.prepare(
    `INSERT INTO wiki_pages (id, type, title, markdown, summary, revision, status, created_at, updated_at)
     VALUES ('gone', 'concept', 'Gone', '{src:src_1}', '', 1, 'published', 1, 1)`,
  ).run();
  db.prepare(
    "INSERT INTO brain_fields (page_id, field_key, value, written_by, written_at) VALUES ('gone', 'note', 'SECRET-FIELD', 'ada', 1)",
  ).run();
  db.prepare(
    `INSERT INTO items (id, label, kind, plane, origin, status, revision, author_id, tags, body, created_at, updated_at)
     VALUES ('draft1', 'draft page', 'personalitem', 'PERSONAL', 'human', 'draft', 1, 'bea', '["draft"]', 'body', 1, 1)`,
  ).run();
  db.prepare(
    "INSERT INTO revisions (item_id, revision, label, body, actor_id, at) VALUES ('draft1', 1, 'draft page', 'SECRET-REV', 'bea', 1)",
  ).run();
  db.prepare("INSERT INTO items_fts (label, id) VALUES ('SECRET-ITEM', 'draft1')").run();
  db.prepare(
    `INSERT INTO source_items (id, source_id, gate_node_id, plane, title, body, size, etag, synced_at)
     VALUES ('srcrow', 'src', 'gate', 'PERSONAL', 'SECRET-SOURCE', 'body', 1, 'e', 1)`,
  ).run();
  db.prepare("INSERT INTO source_fts (title, body, id) VALUES ('SECRET-SOURCE', 'body', 'srcrow')").run();

  ws.wikiForgetSources(["src_1"], NOW);
  ws.wikiForgetSources(["src_1"], NOW + 1);
  const purged = ws.purgeExpired({ draft: NOW });
  const again = ws.purgeExpired({ draft: NOW });
  ws.pseudonymise("SECRET-SOURCE", "pz_source");
  ws.pseudonymise("SECRET-SOURCE", "pz_source");

  const left = Object.fromEntries(found.map((table) => [table, dump(db, table)]));
  const leaked = found.filter((table) => /SECRET-/.test(left[table] ?? ""));
  assert.deepEqual(
    {
      schema: {
        unclassified: schema.unclassified,
        missing: schema.missing,
        overlap: schema.overlap,
        unknownExclusion: schema.unknownExclusion,
      },
      found,
      purged,
      again,
      leaked,
      kept: left.wiki_page_revisions,
    },
    {
      schema: { unclassified: [], missing: [], overlap: [], unknownExclusion: [] },
      found: DERIVED,
      purged: 1,
      again: 0,
      leaked: [],
      kept: JSON.stringify([
        {
          page_id: "kept",
          revision: 1,
          title: "Kept",
          markdown: "Keep",
          actor: "ada",
          at: 1,
          proposal_id: null,
          hidden_at: null,
          hidden_by: null,
          hidden_reason: null,
        },
      ]),
    },
  );
  db.close();
});
