/**
 * A personal auto-accept stays a draft. Publishing is an explicit action
 * and compares the previous item status.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sqliteStorage } from "../runtime/sqlite-storage.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const NOW = 1_700_000_000_000;
const storeSpecifier = "../../src/worker/wiki/store.ts";

type ProposeResult =
  | { ok: true; created: false; reason: string }
  | { ok: true; created: true; id: string; autoAccepted: boolean }
  | { ok: false; code: string; message: string };

type Wiki = {
  sql: ReturnType<typeof sqliteStorage>;
  env: { ENVIRONMENT: string };
  ctx: { storage: { transactionSync: <T>(fn: () => T) => T } };
  create: (n: { id: string; status: string; body: string }, now: number) => { id: string; status: string };
  wikiPropose: (
    input: Record<string, unknown>,
    authorId: string,
    now: number,
    opts: { plane: string; autoAccept?: boolean; publishDirect?: boolean; readable?: string[] },
  ) => Promise<ProposeResult>;
};

function schema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE wiki_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE wiki_schema (id INTEGER PRIMARY KEY, body TEXT NOT NULL);
    CREATE TABLE wiki_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, subject TEXT NOT NULL, predicate TEXT NOT NULL,
      object TEXT NOT NULL, valid_at TEXT NOT NULL, invalid_at TEXT, recorded_at TEXT NOT NULL,
      checked_at TEXT NOT NULL, source_ids TEXT NOT NULL, source_hashes TEXT NOT NULL,
      confidence REAL NOT NULL, origin TEXT NOT NULL, verified_by TEXT, proposal_id TEXT);
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
    CREATE TABLE wiki_findings (
      key TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, proposal_id TEXT, at INTEGER);
    CREATE TABLE items (
      id TEXT PRIMARY KEY, kind TEXT, status TEXT NOT NULL, updated_at INTEGER NOT NULL, body TEXT);
  `);
  db.prepare("INSERT INTO wiki_meta (key, value) VALUES ('scope_id', 'personal:ada')").run();
  db.prepare("INSERT INTO wiki_meta (key, value) VALUES ('tenant_id', 'ten')").run();
  db.prepare("INSERT INTO wiki_meta (key, value) VALUES ('auto_accept', '1')").run();
}

async function openWiki(stored: string): Promise<{ db: DatabaseSync; wiki: Wiki }> {
  const db = new DatabaseSync(":memory:");
  schema(db);
  const mod = (await import(storeSpecifier)) as { WikiBase: { prototype: Wiki } };
  const wiki = Object.create(mod.WikiBase.prototype) as Wiki;
  wiki.sql = sqliteStorage(db);
  wiki.env = { ENVIRONMENT: "test" };
  wiki.ctx = {
    storage: {
      transactionSync<T>(fn: () => T): T {
        db.exec("BEGIN IMMEDIATE");
        try {
          const result = fn();
          db.exec("COMMIT");
          return result;
        } catch (err) {
          db.exec("ROLLBACK");
          throw err;
        }
      },
    },
  };
  wiki.create = (n) => {
    db.prepare("INSERT INTO items (id, kind, status, updated_at, body) VALUES (?, 'wiki_ingest', ?, ?, ?)").run(
      n.id,
      stored,
      NOW,
      n.body,
    );
    return { id: n.id, status: stored };
  };
  return { db, wiki };
}

function proposal(): Record<string, unknown> {
  return {
    kind: "wiki_ingest",
    title: "Import: Home",
    rationale: "Imported from outline",
    origin: "human",
    pages: [
      {
        pageId: "home",
        type: "topic",
        title: "Home",
        baseRevision: null,
        markdown: "A short page.",
      },
    ],
    facts: [],
    invalidate: [],
    confirm: [],
    archive: [],
    reingest: [],
    sources: [],
    findingKey: null,
  };
}

function itemStatus(db: DatabaseSync): string | undefined {
  const row = db.prepare("SELECT status FROM items").get() as { status: string } | undefined;
  return row ? { ...row }.status : undefined;
}

function pageStatus(db: DatabaseSync, id: string): string | undefined {
  const row = db.prepare("SELECT status FROM wiki_pages WHERE id = ?").get(id) as
    | { status: string }
    | undefined;
  return row ? { ...row }.status : undefined;
}

test("import publish: a personal auto-accept stays a draft", async () => {
  const { db, wiki } = await openWiki("candidate");
  const result = await wiki.wikiPropose(proposal(), "ada", NOW, {
    plane: "personal",
    autoAccept: true,
    readable: [],
  });
  assert.equal(result.ok, true);
  if (result.ok && result.created) assert.equal(result.autoAccepted, false);
  assert.equal(itemStatus(db), "candidate");
  assert.equal(pageStatus(db, "home"), undefined);
  db.close();
});

test("import publish: an explicit publish from a candidate publishes that page", async () => {
  const { db, wiki } = await openWiki("candidate");
  const result = await wiki.wikiPropose(proposal(), "ada", NOW, {
    plane: "personal",
    publishDirect: true,
    readable: [],
  });
  assert.equal(result.ok, true);
  if (result.ok && result.created) assert.equal(result.autoAccepted, true);
  assert.equal(itemStatus(db), "approved");
  assert.equal(pageStatus(db, "home"), "published");
  db.close();
});

test("import publish: an unknown stored status writes nothing", async () => {
  const { db, wiki } = await openWiki("legacy");
  const result = await wiki.wikiPropose(proposal(), "ada", NOW, {
    plane: "personal",
    publishDirect: true,
    readable: [],
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "state_unreadable");
  assert.equal(itemStatus(db), "legacy");
  assert.equal(pageStatus(db, "home"), undefined);
  db.close();
});

test("import publish: a lost compare-and-set writes nothing", async () => {
  const { db, wiki } = await openWiki("candidate");
  const insert = wiki.create;
  wiki.create = (n, now) => {
    const made = insert(n, now);
    db.prepare("UPDATE items SET status = 'gone' WHERE id = ?").run(n.id);
    return made;
  };
  const result = await wiki.wikiPropose(proposal(), "ada", NOW, {
    plane: "personal",
    publishDirect: true,
    readable: [],
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "replay");
  assert.equal(itemStatus(db), "gone");
  assert.equal(pageStatus(db, "home"), undefined);
  db.close();
});

test("import publish: publishing a row that is not a draft is refused", async () => {
  const { db, wiki } = await openWiki("approved");
  const result = await wiki.wikiPropose(proposal(), "ada", NOW, {
    plane: "personal",
    publishDirect: true,
    readable: [],
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "not_draft");
  assert.equal(itemStatus(db), "approved");
  assert.equal(pageStatus(db, "home"), undefined);
  db.close();
});

test("import publish: the dry run and the real import both report publishMode(false)", () => {
  const data = readFileSync(new URL("../../src/worker/brains/data.ts", import.meta.url), "utf8");
  assert.match(data, /const reported = publishMode\(false\)/);
  assert.equal(data.match(/state: reported/g)?.length, 2);
  assert.doesNotMatch(data, /const publishDirect = b\.personal && verdict\.verdict === "ingest" && !cur/);
  assert.doesNotMatch(data, /publishDirect: true/);
});
