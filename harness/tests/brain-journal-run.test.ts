/**
 * A journal run that cannot save the page returns that refusal.
 * It does not report the page id of a page it left unchanged.
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
const AT = Date.parse(`${DAY}T12:00:00Z`);
const storeSpecifier = "../../src/worker/brains/store.ts";

type JournalRun =
  | { pageId: string | null; created: boolean }
  | { ok: false; code: string; message: string };

type Brain = {
  sql: SqlStorage;
  brainJournalRun(date: string, now: number): JournalRun;
};

function tempFile(): { file: string; remove: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "brain-journal-"));
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
      actor TEXT, at INTEGER NOT NULL, proposal_id TEXT, PRIMARY KEY (page_id, revision));
    CREATE VIRTUAL TABLE wiki_fts USING fts5(title, summary, body, id UNINDEXED);
    CREATE TABLE wiki_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL,
      kind TEXT NOT NULL, detail TEXT NOT NULL);
    CREATE TABLE items (id TEXT PRIMARY KEY, body TEXT);
  `);
  const mod = (await import(storeSpecifier)) as { BrainBase: { prototype: Brain } };
  const brain = Object.create(mod.BrainBase.prototype) as Brain;
  brain.sql = sqliteStorage(db);
  return { db, brain };
}

test("brain journal: a save refused because the page is archived returns that refusal", async () => {
  const { file, remove } = tempFile();
  try {
    const { db, brain } = await openBrain(file);
    db.prepare(
      "INSERT INTO wiki_pages (id, type, title, markdown, summary, revision, status, origin, created_at, updated_at) VALUES ('journal-2023-11-14', 'journal', 'Journal 2023-11-14', 'old', '', 1, 'archived', 'human', ?, ?)",
    ).run(AT, AT);
    db.prepare("INSERT INTO wiki_log (at, actor, kind, detail) VALUES (?, 'ada', 'wiki_ingest.proposed', '{}')").run(
      AT,
    );
    const ran = brain.brainJournalRun(DAY, AT);
    assert.equal("ok" in ran && ran.ok === false, true);
    if ("ok" in ran && !ran.ok) assert.equal(ran.code, "archived");
    const page = db.prepare("SELECT status, markdown FROM wiki_pages WHERE id = 'journal-2023-11-14'").get() as {
      status: string;
      markdown: string;
    };
    assert.equal({ ...page }.status, "archived");
    assert.equal({ ...page }.markdown, "old");
    const logs = db.prepare("SELECT kind FROM wiki_log").all() as { kind: string }[];
    assert.deepEqual(
      logs.map((row) => ({ ...row }).kind),
      ["wiki_ingest.proposed"],
    );
    db.close();
  } finally {
    remove();
  }
});
