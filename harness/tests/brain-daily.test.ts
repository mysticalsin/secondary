/**
 * The nightly journal moves its watermark past an archived day and records that skip.
 * Any other refusal leaves the watermark, so the next alarm retries the day.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { openSqlite, sqliteStorage } from "../runtime/sqlite-storage.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const DAY = "2023-11-14";
const THROUGH = "2023-11-13";
const NOW = Date.parse("2023-11-15T12:00:00Z");
const AT = Date.parse(`${DAY}T12:00:00Z`);
const BRAIN = "brain-ada";
const storeSpecifier = "../../recovered-source/worker/src/brains/store.ts";

type Brain = {
  sql: SqlStorage;
  brainDaily(now: number): void;
};

function tempFile(): { file: string; remove: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "brain-daily-"));
  return {
    file: path.join(dir, "brain.sqlite"),
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}

async function openBrain(file: string, status: string): Promise<{ db: DatabaseSync; brain: Brain }> {
  const db = openSqlite(file);
  db.exec(`
    CREATE TABLE wiki_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE wiki_pages (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, markdown TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'published', origin TEXT NOT NULL DEFAULT 'human',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE wiki_page_revisions (
      page_id TEXT NOT NULL, revision INTEGER NOT NULL, title TEXT NOT NULL, markdown TEXT NOT NULL,
      actor TEXT, at INTEGER NOT NULL, proposal_id TEXT, PRIMARY KEY (page_id, revision));
    CREATE VIRTUAL TABLE wiki_fts USING fts5(title, summary, body, id UNINDEXED);
    CREATE TABLE wiki_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL,
      kind TEXT NOT NULL, detail TEXT NOT NULL);
    CREATE TABLE items (id TEXT PRIMARY KEY, body TEXT);
    CREATE TABLE brain_fields (
      page_id TEXT NOT NULL, field_key TEXT NOT NULL, value TEXT, written_at INTEGER NOT NULL);
  `);
  db.prepare("INSERT INTO wiki_meta (key, value) VALUES ('scope_id', ?)").run(BRAIN);
  db.prepare("INSERT INTO wiki_meta (key, value) VALUES ('tenant_id', 'ten')").run();
  db.prepare("INSERT INTO wiki_meta (key, value) VALUES ('brain_journal_through', ?)").run(THROUGH);
  db.prepare(
    "INSERT INTO wiki_pages (id, type, title, markdown, summary, revision, status, origin, created_at, updated_at) VALUES ('journal-2023-11-14', 'journal', 'Journal 2023-11-14', 'old', '', 1, ?, 'human', ?, ?)",
  ).run(status, AT, AT);
  db.prepare("INSERT INTO wiki_log (at, actor, kind, detail) VALUES (?, 'ada', 'wiki_ingest.proposed', '{}')").run(AT);
  const mod = (await import(storeSpecifier)) as { BrainBase: { prototype: Brain } };
  const brain = Object.create(mod.BrainBase.prototype) as Brain;
  brain.sql = sqliteStorage(db);
  return { db, brain };
}

function watermark(db: DatabaseSync): string | undefined {
  const row = db.prepare("SELECT value FROM wiki_meta WHERE key = 'brain_journal_through'").get() as
    | { value: string }
    | undefined;
  return row ? { ...row }.value : undefined;
}

function skips(db: DatabaseSync): { reason: string; brainId: string; pageId: string; day: string }[] {
  return (
    db.prepare("SELECT detail FROM wiki_log WHERE kind = 'journal.skipped' ORDER BY id").all() as {
      detail: string;
    }[]
  ).map((row) => JSON.parse({ ...row }.detail) as { reason: string; brainId: string; pageId: string; day: string });
}

function page(db: DatabaseSync): { status: string; markdown: string } {
  const row = db.prepare("SELECT status, markdown FROM wiki_pages WHERE id = 'journal-2023-11-14'").get() as {
    status: string;
    markdown: string;
  };
  return { ...row };
}

test("brain daily: an archived day advances the watermark and records one skip", async () => {
  const { file, remove } = tempFile();
  try {
    const { db, brain } = await openBrain(file, "archived");
    brain.brainDaily(NOW);
    assert.equal(watermark(db), DAY);
    const events = skips(db);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], {
      reason: "archived",
      brainId: BRAIN,
      pageId: "journal-2023-11-14",
      day: DAY,
    });
    assert.equal(page(db).status, "archived");
    assert.equal(page(db).markdown, "old");
    db.close();
  } finally {
    remove();
  }
});

test("brain daily: an unreadable day leaves the watermark where it was", async () => {
  const { file, remove } = tempFile();
  try {
    const { db, brain } = await openBrain(file, "legacy");
    brain.brainDaily(NOW);
    assert.equal(watermark(db), THROUGH);
    assert.equal(skips(db).length, 0);
    assert.equal(page(db).status, "legacy");
    assert.equal(page(db).markdown, "old");
    db.close();
  } finally {
    remove();
  }
});

test("brain daily: the next alarm retries an unreadable day and writes it once the page is readable", async () => {
  const { file, remove } = tempFile();
  try {
    const { db, brain } = await openBrain(file, "legacy");
    brain.brainDaily(NOW);
    assert.equal(watermark(db), THROUGH);
    db.prepare("UPDATE wiki_pages SET status = 'published' WHERE id = 'journal-2023-11-14'").run();
    brain.brainDaily(NOW);
    assert.equal(watermark(db), DAY);
    assert.equal(page(db).status, "published");
    assert.notEqual(page(db).markdown, "old");
    assert.match(page(db).markdown, /Journal 2023-11-14/);
    assert.equal(skips(db).length, 0);
    db.close();
  } finally {
    remove();
  }
});
