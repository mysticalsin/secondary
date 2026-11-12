/**
 * A throw inside the nightly journal leaves the watermark and still re-arms the alarm.
 * The next alarm retries that day and advances once the run succeeds.
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

const DAY_MS = 86_400_000;
const storeSpecifier = "../../recovered-source/worker/src/brains/store.ts";

type JournalRun = { pageId: string | null; created: boolean } | { ok: false; code: string; message: string };

type Brain = {
  sql: SqlStorage;
  alarm(): Promise<void>;
  brainJournalRun(date: string, now: number): JournalRun;
};

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

function tempFile(): { file: string; remove: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "brain-daily-throw-"));
  return {
    file: path.join(dir, "brain.sqlite"),
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("brain daily: a thrown journal run keeps the watermark, re-arms, and retries that day", async () => {
  const { file, remove } = tempFile();
  const now = Date.now();
  const prior = isoDay(now - 2 * DAY_MS);
  const db = openSqlite(file);
  let rearmed = 0;
  let parent: { alarm?: () => Promise<void> } | null = null;
  let original: (() => Promise<void>) | undefined;
  try {
    db.exec(`
      CREATE TABLE wiki_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE wiki_pages (id TEXT PRIMARY KEY);
      CREATE TABLE brain_fields (
        page_id TEXT NOT NULL, field_key TEXT NOT NULL, value TEXT, written_at INTEGER NOT NULL);
    `);
    db.prepare("INSERT INTO wiki_meta (key, value) VALUES ('scope_id', 'brain-ada')").run();
    db.prepare("INSERT INTO wiki_meta (key, value) VALUES ('tenant_id', 'ten')").run();
    db.prepare("INSERT INTO wiki_meta (key, value) VALUES ('brain_journal_through', ?)").run(prior);
    const mod = (await import(storeSpecifier)) as { BrainBase: { prototype: Brain } };
    const brain = Object.create(mod.BrainBase.prototype) as Brain;
    brain.sql = sqliteStorage(db);
    parent = Object.getPrototypeOf(mod.BrainBase.prototype) as { alarm?: () => Promise<void> };
    original = parent.alarm;
    parent.alarm = async () => {
      rearmed += 1;
    };
    const seen: string[] = [];
    let fail = true;
    brain.brainJournalRun = (date) => {
      seen.push(date);
      if (fail) throw new Error("journal down");
      return { pageId: null, created: false };
    };
    await brain.alarm();
    const watermark = (): string | undefined => {
      const row = db.prepare("SELECT value FROM wiki_meta WHERE key = 'brain_journal_through'").get() as
        | { value: string }
        | undefined;
      return row ? { ...row }.value : undefined;
    };
    assert.equal(watermark(), prior);
    assert.equal(rearmed, 1);
    assert.equal(seen.length, 1);
    fail = false;
    await brain.alarm();
    assert.equal(seen.length, 2);
    assert.equal(seen[1], seen[0]);
    assert.equal(watermark(), seen[0]);
    assert.notEqual(watermark(), prior);
    assert.equal(rearmed, 2);
    db.close();
  } finally {
    if (parent && original) parent.alarm = original;
    remove();
  }
});
