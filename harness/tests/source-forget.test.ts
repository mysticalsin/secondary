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

const storeSpecifier = "../../recovered-source/worker/src/workspace.ts";

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
  const mod = (await import(storeSpecifier)) as { Workspace: new (ctx: unknown, env: unknown) => Wiki };
  const wiki = new mod.Workspace(ctx, {});
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
  const verified = {
    ...(db.prepare("SELECT subject, verified_by FROM wiki_facts").get() as {
      subject: string;
      verified_by: string;
    }),
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

test("source forget: a shorter pseudonym replaces the name once", async () => {
  const db = new DatabaseSync(":memory:");
  const wiki = await openWiki(db);
  page(db, "pub", "Jonathan", "Jonathan wrote it");
  const first = wiki.wikiPseudonymise("Jonathan", "Jon");
  const second = wiki.wikiPseudonymise("Jonathan", "Jon");
  const stored = db
    .prepare("SELECT id, title, markdown FROM wiki_pages")
    .all()
    .map((row) => ({ ...(row as { id: string; title: string; markdown: string }) }));
  assert.deepEqual(
    { first: first > 0, second, stored },
    {
      first: true,
      second: 0,
      stored: [{ id: "pub", title: "Jon", markdown: "Jon wrote it" }],
    },
  );
  db.close();
});

test("source forget: an unreadable fact list is removed only when it names the source", async () => {
  const db = new DatabaseSync(":memory:");
  const wiki = await openWiki(db);
  fact(db, "cites", '["src_1"]');
  fact(db, "keeps", '["src_1","src_9"]', "nope");
  fact(db, "other", '["src_9"]');
  fact(db, "quoted", 'not-json "src_1" more');
  fact(db, "neighbour", 'not-json "src_10"');
  fact(db, "blank", "{");
  let thrown: string | null = null;
  try {
    wiki.wikiForgetSources(["src_1"], 5);
    wiki.wikiForgetSources(["src_1"], 6);
  } catch (e) {
    thrown = e instanceof Error ? e.message : String(e);
  }
  const facts = db
    .prepare("SELECT subject, source_ids, source_hashes FROM wiki_facts ORDER BY id")
    .all()
    .map((row) => ({ ...(row as { subject: string; source_ids: string; source_hashes: string }) }));
  const logs = db.prepare("SELECT kind FROM wiki_log").all().map((row) => (row as { kind: string }).kind);
  assert.deepEqual(
    { thrown, facts, logs },
    {
      thrown: null,
      facts: [
        { subject: "keeps", source_ids: '["src_9"]', source_hashes: "{}" },
        { subject: "other", source_ids: '["src_9"]', source_hashes: "{}" },
        { subject: "neighbour", source_ids: 'not-json "src_10"', source_hashes: "{}" },
        { subject: "blank", source_ids: "{", source_hashes: "{}" },
      ],
      logs: ["sources.forgotten"],
    },
  );
  db.close();
});

test("source forget: a search row that survived the page write is rebuilt, and a legacy page stays out", async () => {
  const db = new DatabaseSync(":memory:");
  const wiki = await openWiki(db);
  page(db, "old", "Old", "Old note", "legacy");
  page(db, "pub", "Public", "Public line");
  db.prepare(
    "INSERT INTO wiki_page_revisions (page_id, revision, title, markdown, actor, at) VALUES ('pub', 1, 'Public', ?, 'a', 1)",
  ).run("Keep\nSecret line {src:src_1}");
  db.prepare("INSERT INTO wiki_fts (title, summary, body, id) VALUES ('Old', '', 'Old note', 'old')").run();
  db.prepare("INSERT INTO wiki_fts (title, summary, body, id) VALUES ('Public', 'Secret line', 'Secret line', 'pub')").run();
  let thrown: string | null = null;
  try {
    wiki.wikiForgetSources(["src_1"], 5);
    wiki.wikiForgetSources(["src_1"], 6);
  } catch (e) {
    thrown = e instanceof Error ? e.message : String(e);
  }
  const pages = db
    .prepare("SELECT id, title, markdown, status FROM wiki_pages ORDER BY id")
    .all()
    .map((row) => ({ ...(row as { id: string; title: string; markdown: string; status: string }) }));
  const revisions = db
    .prepare("SELECT page_id, revision, markdown FROM wiki_page_revisions ORDER BY page_id, revision")
    .all()
    .map((row) => ({ ...(row as { page_id: string; revision: number; markdown: string }) }));
  const search = db
    .prepare("SELECT id, title, summary, body FROM wiki_fts ORDER BY id")
    .all()
    .map((row) => ({ ...(row as { id: string; title: string; summary: string; body: string }) }));
  assert.deepEqual(
    { thrown, pages, revisions, search },
    {
      thrown: null,
      pages: [
        { id: "old", title: "Old", markdown: "Old note", status: "legacy" },
        { id: "pub", title: "Public", markdown: "Public line", status: "published" },
      ],
      revisions: [{ page_id: "pub", revision: 1, markdown: "Keep" }],
      search: [{ id: "pub", title: "Public", summary: "Public line", body: "Public line" }],
    },
  );
  db.close();
});

test("source forget: an orphan search row does not survive, and a live page's row stays", async () => {
  const db = new DatabaseSync(":memory:");
  const wiki = await openWiki(db);
  page(db, "live", "Steady", "Steady note");
  db.prepare(
    "INSERT INTO wiki_fts (title, summary, body, id) VALUES ('Steady', 'Steady note', 'Steady note', 'live')",
  ).run();
  db.prepare(
    "INSERT INTO wiki_fts (title, summary, body, id) VALUES ('Gone', '', 'secret {src:src_1}', 'gone')",
  ).run();
  db.prepare(
    "INSERT INTO wiki_fts (title, summary, body, id) VALUES ('Other', '', 'unrelated', 'other')",
  ).run();
  let thrown: string | null = null;
  try {
    wiki.wikiForgetSources(["src_1"], 5);
    wiki.wikiForgetSources(["src_1"], 6);
  } catch (e) {
    thrown = e instanceof Error ? e.message : String(e);
  }
  const search = db
    .prepare("SELECT id, title, summary, body FROM wiki_fts ORDER BY id")
    .all()
    .map((row) => ({ ...(row as { id: string; title: string; summary: string; body: string }) }));
  assert.deepEqual(
    { thrown, search },
    {
      thrown: null,
      search: [{ id: "live", title: "Steady", summary: "Steady note", body: "Steady note" }],
    },
  );
  db.close();
});

test("the production pseudonym is not a strict prefix of the id", async () => {
  const id = "Jonathan";
  const spec = "../../recovered-source/worker/src/ops-rights.ts";
  const { pseudonymFor } = (await import(spec)) as {
    pseudonymFor: (
      env: { PSEUDONYM_KEY?: string },
      tenantId: string,
      principalId: string,
    ) => Promise<string | null>;
  };
  const env = { PSEUDONYM_KEY: "0123456789abcdef0123456789abcdef" };
  const first = await pseudonymFor(env, "acme", id);
  const second = await pseudonymFor(env, "acme", id);
  const prefix = first !== null && id.startsWith(first) && first.length < id.length;
  assert.deepEqual(
    {
      same: first === second,
      longer: first !== null && first.length > id.length,
      prefix,
      form: first !== null && /^pz_[0-9a-f]{32}$/.test(first),
    },
    { same: true, longer: true, prefix: false, form: true },
  );
});
