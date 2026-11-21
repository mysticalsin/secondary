/**
 * SB1-16. Changes, revisions and ingests apply a cap before the caller can
 * drop rows the caller cannot see. A newer hidden row then fills the cap and
 * an older visible row never comes back.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { openSqlite, sqliteStorage } from "../runtime/sqlite-storage.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const storeSpecifier = "../../src/worker/brains/store.ts";

type ChangeRow = { pageId: string };
type InsightRaw = {
  revisions: { pageId: string; at: number }[];
  ingested: { sourceId: string; at: number }[];
};

type Brain = {
  sql: SqlStorage;
  brainChangesSince(since: number, limit: number, visibleIds?: readonly string[]): ChangeRow[];
  brainInsightRaw(
    since: number,
    historyFrom: number,
    citedIds: string[],
    light?: boolean,
    view?: { pages?: readonly string[]; sources?: readonly string[] },
  ): InsightRaw;
};

function tempFile(): { file: string; remove: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "brain-caps-"));
  return {
    file: path.join(dir, "brain.sqlite"),
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}

async function openBrain(file: string): Promise<{ db: DatabaseSync; brain: Brain }> {
  const db = openSqlite(file);
  db.exec(`
    CREATE TABLE wiki_pages (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, markdown TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'published', origin TEXT NOT NULL DEFAULT 'human',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE wiki_page_revisions (
      page_id TEXT NOT NULL, revision INTEGER NOT NULL, title TEXT NOT NULL, markdown TEXT NOT NULL,
      actor TEXT, at INTEGER NOT NULL, proposal_id TEXT,
      hidden_at INTEGER, hidden_by TEXT, hidden_reason TEXT,
      PRIMARY KEY (page_id, revision));
    CREATE TABLE wiki_sources (
      source_id TEXT PRIMARY KEY, hash TEXT NOT NULL, title TEXT NOT NULL,
      ingested_hash TEXT, ingested_at INTEGER, gate_node_id TEXT);
    CREATE TABLE items (
      id TEXT PRIMARY KEY, kind TEXT, status TEXT, created_at INTEGER, updated_at INTEGER, body TEXT);
    CREATE TABLE approvals (
      item_id TEXT NOT NULL, revision INTEGER NOT NULL, actor_id TEXT NOT NULL,
      kind TEXT NOT NULL, at INTEGER NOT NULL, verdict TEXT);
    CREATE TABLE wiki_promotions (
      candidate_id TEXT PRIMARY KEY, title TEXT NOT NULL, at INTEGER NOT NULL, page_id TEXT);
    CREATE TABLE wiki_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, subject TEXT NOT NULL, predicate TEXT NOT NULL,
      object TEXT NOT NULL, valid_at TEXT NOT NULL, invalid_at TEXT, recorded_at TEXT NOT NULL,
      checked_at TEXT NOT NULL, source_ids TEXT NOT NULL, source_hashes TEXT NOT NULL,
      confidence REAL NOT NULL, origin TEXT NOT NULL, verified_by TEXT, proposal_id TEXT);
    CREATE TABLE source_items (id TEXT PRIMARY KEY);
  `);
  const mod = (await import(storeSpecifier)) as { BrainBase: { prototype: Brain } };
  const brain = Object.create(mod.BrainBase.prototype) as Brain;
  brain.sql = sqliteStorage(db);
  return { db, brain };
}

function insertPage(db: DatabaseSync, id: string, at: number): void {
  db.prepare(
    `INSERT INTO wiki_pages (id, type, title, markdown, summary, revision, status, origin, created_at, updated_at)
     VALUES (?, 'topic', ?, ?, '', 1, 'published', 'human', ?, ?)`,
  ).run(id, id, id, at, at);
  db.prepare(
    `INSERT INTO wiki_page_revisions (page_id, revision, title, markdown, actor, at, proposal_id, hidden_at)
     VALUES (?, 1, ?, ?, 'ada', ?, NULL, NULL)`,
  ).run(id, id, id, at);
}

test("brain caps: a zero limit keeps no row", async () => {
  const { file, remove } = tempFile();
  try {
    const { db, brain } = await openBrain(file);
    insertPage(db, "visible-page", 1);
    const changes = brain.brainChangesSince(0, 0, ["visible-page"]);
    assert.equal(changes.length, 0, `zero cap returned ${changes.length}`);
    const mod = (await import(storeSpecifier)) as {
      takeVisible: <T>(rows: readonly T[], visible: (row: T) => boolean, limit: number) => T[];
    };
    const kept = mod.takeVisible([{ id: "visible-page" }, { id: "other-page" }], () => true, 0);
    assert.equal(kept.length, 0, `takeVisible zero cap returned ${kept.length}`);
    db.close();
  } finally {
    remove();
  }
});

test("brain caps: 50 newer hidden edits hide visible-page", async () => {
  const { file, remove } = tempFile();
  try {
    const { db, brain } = await openBrain(file);
    insertPage(db, "visible-page", 1);
    for (let i = 0; i < 50; i += 1) insertPage(db, `hidden-${i}`, 100 + i);
    const changes = brain.brainChangesSince(0, 50, ["visible-page"]);
    const ids = changes.map((row) => row.pageId);
    assert.equal(ids.includes("visible-page"), true, `visible-page absent, sql=50, rows=${ids.length}`);
    const route = readFileSync(new URL("../../src/worker/brains/routes.ts", import.meta.url), "utf8");
    assert.match(route, /brainChangesSince\(\s*since,\s*50,\s*x\.visible\.map\(\(p\) => p\.id\)/);
    db.close();
  } finally {
    remove();
  }
});

test("brain caps: a visible revision past 20000 hidden edits is kept", async () => {
  const { file, remove } = tempFile();
  try {
    const { db, brain } = await openBrain(file);
    insertPage(db, "hidden-page", 1);
    insertPage(db, "visible-page", 20_001);
    const add = db.prepare(
      `INSERT INTO wiki_page_revisions (page_id, revision, title, markdown, actor, at, proposal_id, hidden_at)
       VALUES ('hidden-page', ?, 'hidden-page', 'hidden', 'ada', ?, NULL, NULL)`,
    );
    db.exec("BEGIN");
    for (let i = 2; i <= 20_000; i += 1) add.run(i, i);
    db.exec("COMMIT");
    const raw = brain.brainInsightRaw(0, 0, [], true, { pages: ["visible-page"] });
    assert.equal(
      raw.revisions.some((row) => row.pageId === "visible-page"),
      true,
      `visible-page absent from ${raw.revisions.length} revisions`,
    );
    db.close();
  } finally {
    remove();
  }
});

test("brain caps: a visible ingest past 2000 hidden sources is kept", async () => {
  const { file, remove } = tempFile();
  try {
    const { db, brain } = await openBrain(file);
    const add = db.prepare(
      `INSERT INTO wiki_sources (source_id, hash, title, ingested_hash, ingested_at, gate_node_id)
       VALUES (?, 'h', ?, 'h', ?, 'core')`,
    );
    db.exec("BEGIN");
    for (let i = 0; i < 2_000; i += 1) add.run(`hidden-${i}`, `hidden-${i}`, 1_000 + i);
    add.run("src-visible", "src-visible", 1);
    db.exec("COMMIT");
    const raw = brain.brainInsightRaw(0, 0, [], false, { sources: ["src-visible"] });
    assert.equal(
      raw.ingested.some((row) => row.sourceId === "src-visible"),
      true,
      `src-visible absent from ${raw.ingested.length} ingests`,
    );
    db.close();
  } finally {
    remove();
  }
});
