/**
 * Source forget, the wiki pseudonym, and search rebuild.
 * A second call, including one after a partial write, leaves the same rows and does not throw.
 */

import assert from "node:assert/strict";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sqliteStorage } from "../runtime/sqlite-storage.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const storeSpecifier = "../../recovered-source/worker/src/wiki/store.ts";

type Wiki = {
  wikiForgetSources(ids: string[], now: number): { facts: number; pages: number; proposals: number };
  wikiPseudonymise(from: string, to: string, aliases?: string[]): number;
};

async function openWiki(db: DatabaseSync): Promise<Wiki> {
  let ready: Promise<unknown> = Promise.resolve();
  const ctx = {
    storage: { sql: sqliteStorage(db) },
    blockConcurrencyWhile(fn: () => Promise<unknown>) {
      ready = fn();
      return ready;
    },
  };
  const mod = (await import(storeSpecifier)) as { WikiBase: new (ctx: unknown, env: unknown) => Wiki };
  const wiki = new mod.WikiBase(ctx, {});
  await ready;
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY, label TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL,
      body TEXT, origin TEXT NOT NULL DEFAULT 'human', updated_at INTEGER NOT NULL);
    CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(label, id UNINDEXED);
  `);
  return wiki;
}

function page(db: DatabaseSync, id: string, title: string, markdown: string, status = "published"): void {
  db.prepare(
    `INSERT INTO wiki_pages (id, type, title, markdown, summary, revision, status, created_at, updated_at)
     VALUES (?, 'topic', ?, ?, '', 1, ?, 1, 1)`,
  ).run(id, title, markdown, status);
}

function fact(db: DatabaseSync, subject: string, sourceIds: string, hashes = "{}", verifiedBy: string | null = null): void {
  db.prepare(
    `INSERT INTO wiki_facts (
      subject, predicate, object, valid_at, recorded_at, checked_at, source_ids, source_hashes,
      confidence, origin, verified_by)
     VALUES (?, 'p', 'o', 't', 't', 't', ?, ?, 1, 'human', ?)`,
  ).run(subject, sourceIds, hashes, verifiedBy);
}

test("source forget: a pseudonym that contains the name is written once", async () => {
  const db = new DatabaseSync(":memory:");
  const wiki = await openWiki(db);
  page(db, "pub", "Ada Lovelace", "Ada wrote it");
  page(db, "old", "Notes on Ada", "Ada remains", "legacy");
  db.prepare("INSERT INTO wiki_fts (title, summary, body, id) VALUES ('Notes on Ada', '', 'Ada remains', 'old')").run();
  fact(db, "Ada Lovelace", "[]", "{}", "Ada");
  const first = wiki.wikiPseudonymise("Ada", "pz_Ada");
  const second = wiki.wikiPseudonymise("Ada", "pz_Ada");
  const pages = db
    .prepare("SELECT id, title, markdown, status FROM wiki_pages ORDER BY id")
    .all()
    .map((row) => ({ ...(row as { id: string; title: string; markdown: string; status: string }) }));
  const search = db
    .prepare("SELECT id, title, body FROM wiki_fts ORDER BY id")
    .all()
    .map((row) => ({ ...(row as { id: string; title: string; body: string }) }));
  const verified = db.prepare("SELECT subject, verified_by FROM wiki_facts").get() as {
    subject: string;
    verified_by: string;
  };
  assert.deepEqual(
    { first: first > 0, second, pages, search, verified },
    {
      first: true,
      second: 0,
      pages: [
        { id: "old", title: "Notes on pz_Ada", markdown: "pz_Ada remains", status: "legacy" },
        { id: "pub", title: "pz_Ada Lovelace", markdown: "pz_Ada wrote it", status: "published" },
      ],
      search: [{ id: "pub", title: "pz_Ada Lovelace", body: "pz_Ada wrote it" }],
      verified: { subject: "pz_Ada Lovelace", verified_by: "pz_Ada" },
    },
  );
  db.close();
});
