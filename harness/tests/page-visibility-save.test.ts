/**
 * Saving an archived page must not publish it.
 * The compare-and-set is the previous status, so an archive that lands first wins.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { openSqlite, sqliteStorage } from "../runtime/sqlite-storage.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const NOW = 1_700_000_000_000;
const storeSpecifier = "../../recovered-source/worker/src/wiki/store.ts";
const utilSpecifier = "../../recovered-source/worker/src/ux/util.ts";

type PageWrite = { ok: true; wrote: boolean } | { ok: false; code: string; message: string };

type Wiki = {
  sql: SqlStorage;
  ctx: { storage: { transactionSync: <T>(fn: () => T) => T } };
  savePage(
    page: { id: string; type: string; title: string; markdown: string },
    actor: string | null,
    proposalId: string | null,
    now: number,
  ): PageWrite;
  unarchivePage(id: string, now: number): PageWrite;
  wikiDecide(
    id: string,
    decision: "approve" | "reject",
    actorId: string,
    now: number,
    opts: { revisionHash?: string },
  ): Promise<{ ok: true; status: string } | { ok: false; code: string; message: string }>;
  get(id: string): unknown;
  wikiMeta(): { scopeId: string; tenantId: string } | null;
  proposalHash(item: { id: string; revision: number; body: string | null }): Promise<string>;
};

function tempFile(): { file: string; remove: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "page-visibility-"));
  return {
    file: path.join(dir, "wiki.sqlite"),
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function schema(db: DatabaseSync): void {
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
    CREATE TABLE approvals (
      item_id TEXT NOT NULL, revision INTEGER NOT NULL, actor_id TEXT NOT NULL,
      kind TEXT NOT NULL, at INTEGER NOT NULL, verdict TEXT,
      PRIMARY KEY (item_id, revision, actor_id, kind));
    CREATE TABLE wiki_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, subject TEXT NOT NULL, predicate TEXT NOT NULL,
      object TEXT NOT NULL, valid_at TEXT NOT NULL, invalid_at TEXT, recorded_at TEXT NOT NULL,
      checked_at TEXT NOT NULL, source_ids TEXT NOT NULL, source_hashes TEXT NOT NULL,
      confidence REAL NOT NULL, origin TEXT NOT NULL, verified_by TEXT, proposal_id TEXT);
    CREATE TABLE wiki_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL,
      kind TEXT NOT NULL, detail TEXT NOT NULL);
    CREATE TABLE items (id TEXT PRIMARY KEY, status TEXT NOT NULL, updated_at INTEGER NOT NULL);
  `);
}

async function openWiki(file: string): Promise<{ db: DatabaseSync; wiki: Wiki }> {
  const db = openSqlite(file);
  schema(db);
  const mod = (await import(storeSpecifier)) as { WikiBase: { prototype: Wiki } };
  const wiki = Object.create(mod.WikiBase.prototype) as Wiki;
  wiki.sql = sqliteStorage(db);
  wiki.ctx = { storage: { transactionSync: (fn) => fn() } };
  return { db, wiki };
}

function statusOf(db: DatabaseSync, id: string): string | undefined {
  const row = db.prepare("SELECT status FROM wiki_pages WHERE id = ?").get(id) as
    | { status: string }
    | undefined;
  return row ? { ...row }.status : undefined;
}

function revisions(db: DatabaseSync, id: string): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM wiki_page_revisions WHERE page_id = ?").get(id) as {
    n: number;
  };
  return { ...row }.n;
}

function approvalCount(db: DatabaseSync): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM approvals").get() as { n: number };
  return { ...row }.n;
}

function rolling(db: DatabaseSync): Wiki["ctx"] {
  return {
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
}

test("page save: a missing page is inserted as published", async () => {
  const { file, remove } = tempFile();
  try {
    const { db, wiki } = await openWiki(file);
    const saved = wiki.savePage({ id: "home", type: "topic", title: "Home", markdown: "Hello" }, "ada", null, NOW);
    assert.equal(saved.ok, true);
    if (saved.ok) assert.equal(saved.wrote, true);
    assert.equal(statusOf(db, "home"), "published");
    assert.equal(revisions(db, "home"), 1);
    db.close();
  } finally {
    remove();
  }
});

test("page save: a published page with the same text is not written again", async () => {
  const { file, remove } = tempFile();
  try {
    const { db, wiki } = await openWiki(file);
    db.prepare(
      "INSERT INTO wiki_pages (id, type, title, markdown, summary, revision, status, origin, created_at, updated_at) VALUES ('home', 'topic', 'Home', 'Hello', '', 1, 'published', 'human', ?, ?)",
    ).run(NOW, NOW);
    const saved = wiki.savePage({ id: "home", type: "topic", title: "Home", markdown: "Hello" }, "ada", null, NOW);
    assert.equal(saved.ok, true);
    if (saved.ok) assert.equal(saved.wrote, false);
    assert.equal(statusOf(db, "home"), "published");
    assert.equal(revisions(db, "home"), 0);
    db.close();
  } finally {
    remove();
  }
});

test("page save: a published page with new text stays published", async () => {
  const { file, remove } = tempFile();
  try {
    const { db, wiki } = await openWiki(file);
    db.prepare(
      "INSERT INTO wiki_pages (id, type, title, markdown, summary, revision, status, origin, created_at, updated_at) VALUES ('home', 'topic', 'Home', 'Hello', '', 1, 'published', 'human', ?, ?)",
    ).run(NOW, NOW);
    const saved = wiki.savePage({ id: "home", type: "topic", title: "Home", markdown: "Hello again" }, "ada", null, NOW);
    assert.equal(saved.ok, true);
    if (saved.ok) assert.equal(saved.wrote, true);
    assert.equal(statusOf(db, "home"), "published");
    assert.equal(revisions(db, "home"), 1);
    db.close();
  } finally {
    remove();
  }
});

test("page save: an archived page stays archived and the save is refused", async () => {
  const { file, remove } = tempFile();
  try {
    const { db, wiki } = await openWiki(file);
    db.prepare(
      "INSERT INTO wiki_pages (id, type, title, markdown, summary, revision, status, origin, created_at, updated_at) VALUES ('home', 'topic', 'Home', 'Hello', '', 1, 'archived', 'human', ?, ?)",
    ).run(NOW, NOW);
    const saved = wiki.savePage({ id: "home", type: "topic", title: "Home", markdown: "Hello again" }, "ada", null, NOW);
    assert.equal(statusOf(db, "home"), "archived");
    assert.equal(revisions(db, "home"), 0);
    assert.equal(saved.ok, false);
    if (!saved.ok) assert.equal(saved.code, "archived");
    const fts = db.prepare("SELECT COUNT(*) AS n FROM wiki_fts WHERE id = 'home'").get() as { n: number };
    assert.equal({ ...fts }.n, 0);
    db.close();
  } finally {
    remove();
  }
});

test("page save: an unknown status stays unread and the save is refused", async () => {
  const { file, remove } = tempFile();
  try {
    const { db, wiki } = await openWiki(file);
    db.prepare(
      "INSERT INTO wiki_pages (id, type, title, markdown, summary, revision, status, origin, created_at, updated_at) VALUES ('home', 'topic', 'Home', 'Hello', '', 1, 'legacy', 'human', ?, ?)",
    ).run(NOW, NOW);
    const saved = wiki.savePage({ id: "home", type: "topic", title: "Home", markdown: "Hello again" }, "ada", null, NOW);
    assert.equal(statusOf(db, "home"), "legacy");
    assert.equal(revisions(db, "home"), 0);
    assert.equal(saved.ok, false);
    if (!saved.ok) assert.equal(saved.code, "state_unreadable");
    db.close();
  } finally {
    remove();
  }
});

test("page save: unarchive publishes an archived page, and a second unarchive is refused", async () => {
  const { file, remove } = tempFile();
  try {
    const { db, wiki } = await openWiki(file);
    db.prepare(
      "INSERT INTO wiki_pages (id, type, title, markdown, summary, revision, status, origin, created_at, updated_at) VALUES ('home', 'topic', 'Home', 'Hello', 'sum', 1, 'archived', 'human', ?, ?)",
    ).run(NOW, NOW);
    const opened = wiki.unarchivePage("home", NOW);
    assert.equal(opened.ok, true);
    if (opened.ok) assert.equal(opened.wrote, true);
    assert.equal(statusOf(db, "home"), "published");
    const again = wiki.unarchivePage("home", NOW);
    assert.equal(again.ok, false);
    if (!again.ok) assert.equal(again.code, "not_archived");
    assert.equal(statusOf(db, "home"), "published");
    db.close();
  } finally {
    remove();
  }
});

test("page save: an archive that lands during the save keeps the page archived", async () => {
  const { file, remove } = tempFile();
  try {
    const db = openSqlite(file);
    schema(db);
    db.prepare(
      "INSERT INTO wiki_pages (id, type, title, markdown, summary, revision, status, origin, created_at, updated_at) VALUES ('home', 'topic', 'Home', 'Hello', '', 1, 'published', 'human', ?, ?)",
    ).run(NOW, NOW);
    db.close();
    const barrier = new Int32Array(new SharedArrayBuffer(4));
    const saved = new Promise<PageWrite | boolean>((resolve, reject) => {
      const worker = new Worker(new URL("../runtime/page-save-worker.mts", import.meta.url), {
        execArgv: ["--experimental-strip-types"],
        workerData: { file, id: "home", now: NOW + 1, markdown: "Hello again", barrier },
      });
      worker.once("message", (value: PageWrite | boolean) => resolve(value));
      worker.once("error", reject);
    });
    const woke = Atomics.wait(barrier, 0, 0, 5_000);
    assert.notEqual(woke, "timed-out");
    const race = openSqlite(file);
    const archived = race
      .prepare("UPDATE wiki_pages SET status = 'archived', updated_at = ? WHERE id = 'home' AND status = 'published'")
      .run(NOW + 1);
    assert.equal(archived.changes, 1);
    Atomics.store(barrier, 0, 2);
    Atomics.notify(barrier, 0);
    const result = await saved;
    assert.equal(typeof result, "object");
    if (typeof result !== "object") throw new Error("save returned success");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "replay");
    assert.equal(statusOf(race, "home"), "archived");
    assert.equal(revisions(race, "home"), 0);
    race.close();
  } finally {
    remove();
  }
});

test("page save: approving a proposal that saves an archived page is not success", async () => {
  const { file, remove } = tempFile();
  try {
    const { db, wiki } = await openWiki(file);
    db.prepare(
      "INSERT INTO wiki_pages (id, type, title, markdown, summary, revision, status, origin, created_at, updated_at) VALUES ('home', 'topic', 'Home', 'Hello', '', 1, 'archived', 'human', ?, ?)",
    ).run(NOW, NOW);
    const proposal = {
      v: 1,
      kind: "wiki_ingest",
      title: "Home",
      rationale: "",
      origin: "human",
      pages: [{ pageId: "home", type: "topic", title: "Home", baseRevision: 1, markdown: "Hello again" }],
      facts: [],
      invalidate: [],
      confirm: [],
      archive: [],
      reingest: [],
      sources: [],
      findingKey: null,
    };
    const item = {
      id: "prop_1",
      label: "Home",
      kind: "wiki_ingest",
      plane: "internal",
      origin: "human",
      status: "candidate",
      revision: 1,
      authorId: "bea",
      tags: [],
      body: JSON.stringify(proposal),
      targetNode: null,
      releaseTarget: null,
      userValidated: null,
      sensitivityFlags: [],
      reviewedBy2: false,
      approvals: 0,
      required: 1,
      createdAt: NOW,
      updatedAt: NOW,
    };
    wiki.get = (id: string) => (id === item.id ? item : null);
    wiki.wikiMeta = () => ({ scopeId: "personal:ada", tenantId: "ten" });
    const hash = await wiki.proposalHash(item);
    const res = await wiki.wikiDecide(item.id, "approve", "ada", NOW + 1, { revisionHash: hash });
    assert.equal(statusOf(db, "home"), "archived");
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.code, "archived");
      const util = (await import(utilSpecifier)) as {
        failResponse(
          c: { json: (body: unknown, status: number) => Response },
          f: { code: string; message: string },
        ): Response;
      };
      const http = util.failResponse(
        { json: (body: unknown, status: number) => new Response(JSON.stringify(body), { status }) },
        res,
      );
      assert.equal(http.status, 409);
      const body = (await http.json()) as { error: string };
      assert.equal(body.error, "archived");
    }
    db.close();
  } finally {
    remove();
  }
});

test("page save: a refused approval records no row, and the same person can apply after unarchive", async () => {
  const { file, remove } = tempFile();
  try {
    const { db, wiki } = await openWiki(file);
    wiki.ctx = rolling(db);
    db.prepare(
      "INSERT INTO wiki_pages (id, type, title, markdown, summary, revision, status, origin, created_at, updated_at) VALUES ('home', 'topic', 'Home', 'Hello', '', 1, 'archived', 'human', ?, ?)",
    ).run(NOW, NOW);
    db.prepare("INSERT INTO items (id, status, updated_at) VALUES ('prop_1', 'candidate', ?)").run(NOW);
    const proposal = {
      v: 1,
      kind: "wiki_ingest",
      title: "Home",
      rationale: "",
      origin: "human",
      pages: [{ pageId: "home", type: "topic", title: "Home", baseRevision: 1, markdown: "Hello again" }],
      facts: [],
      invalidate: [],
      confirm: [],
      archive: [],
      reingest: [],
      sources: [],
      findingKey: null,
    };
    const item = {
      id: "prop_1",
      label: "Home",
      kind: "wiki_ingest",
      plane: "internal",
      origin: "human",
      status: "candidate",
      revision: 1,
      authorId: "bea",
      tags: [],
      body: JSON.stringify(proposal),
      targetNode: null,
      releaseTarget: null,
      userValidated: null,
      sensitivityFlags: [],
      reviewedBy2: false,
      approvals: 0,
      required: 1,
      createdAt: NOW,
      updatedAt: NOW,
    };
    wiki.get = (id: string) => (id === item.id ? item : null);
    wiki.wikiMeta = () => ({ scopeId: "personal:ada", tenantId: "ten" });
    const hash = await wiki.proposalHash(item);
    const refused = await wiki.wikiDecide(item.id, "approve", "ada", NOW + 1, { revisionHash: hash });
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.code, "archived");
    assert.equal(statusOf(db, "home"), "archived");
    assert.equal(approvalCount(db), 0);
    const opened = wiki.unarchivePage("home", NOW + 2);
    assert.equal(opened.ok, true);
    const applied = await wiki.wikiDecide(item.id, "approve", "ada", NOW + 3, { revisionHash: hash });
    assert.equal(applied.ok, true);
    if (applied.ok) assert.equal(applied.status, "approved");
    assert.equal(statusOf(db, "home"), "published");
    const page = db.prepare("SELECT markdown FROM wiki_pages WHERE id = 'home'").get() as { markdown: string };
    assert.equal({ ...page }.markdown, "Hello again");
    assert.equal(approvalCount(db), 1);
    const stored = db.prepare("SELECT status FROM items WHERE id = 'prop_1'").get() as { status: string };
    assert.equal({ ...stored }.status, "approved");
    db.close();
  } finally {
    remove();
  }
});
