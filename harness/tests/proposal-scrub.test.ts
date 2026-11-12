/**
 * Forgetting a source scrubs the proposals that cite it.
 * Any status other than approved or rejected becomes rejected.
 * The body is emptied in that same write, and the write matches the prior status.
 * A job is matched by its subject. A running job is cancelled, not deleted.
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
const SOURCE = "src_1";
const storeSpecifier = "../../recovered-source/worker/src/wiki/store.ts";

type Wiki = {
  sql: ReturnType<typeof sqliteStorage>;
  get(id: string): unknown;
  wikiForgetSources(ids: string[], now: number): { facts: number; pages: number; proposals: number };
};

type ItemRow = { id: string; label: string; status: string; body: string };
type JobRow = {
  id: number;
  kind: string;
  payload: string;
  state: string;
  result: string | null;
  subject: string | null;
  run_at: number;
};

function schema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE wiki_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, source_ids TEXT NOT NULL, source_hashes TEXT NOT NULL);
    CREATE TABLE wiki_pages (
      id TEXT PRIMARY KEY, markdown TEXT NOT NULL, title TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'published');
    CREATE TABLE wiki_page_revisions (page_id TEXT, revision INTEGER, markdown TEXT);
    CREATE TABLE items (
      id TEXT PRIMARY KEY, label TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL,
      body TEXT, origin TEXT NOT NULL DEFAULT 'human', updated_at INTEGER NOT NULL);
    CREATE VIRTUAL TABLE items_fts USING fts5(label, id UNINDEXED);
    CREATE TABLE wiki_sources (source_id TEXT PRIMARY KEY);
    CREATE TABLE wiki_jobs (
      id INTEGER PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL, run_at INTEGER NOT NULL,
      state TEXT NOT NULL, result TEXT, subject TEXT, attempts INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE wiki_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL,
      kind TEXT NOT NULL, detail TEXT NOT NULL);
  `);
}

function proposal(title: string, sourceIds: string[]): string {
  return JSON.stringify({
    v: 1,
    kind: "wiki_ingest",
    title,
    rationale: "",
    origin: "human",
    pages: [],
    facts: [],
    invalidate: [],
    confirm: [],
    archive: [],
    reingest: [],
    sources: sourceIds.map((id) => ({ id, hash: "h", title: "T" })),
    findingKey: null,
    titleSources: sourceIds,
  });
}

function mention(sourceId: string): string {
  return JSON.stringify({
    v: 1,
    kind: "wiki_ingest",
    title: `notes mention ${sourceId}`,
    rationale: "SECRET-MENTION",
    origin: "human",
    pages: [],
    facts: [],
    invalidate: [],
    confirm: [],
    archive: [],
    reingest: [],
    sources: [],
    findingKey: null,
    titleSources: [],
  });
}

function insertItem(db: DatabaseSync, id: string, status: string, body: string, kind = "wiki_ingest"): void {
  db.prepare("INSERT INTO items (id, label, kind, status, body, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    id,
    "Home",
    kind,
    status,
    body,
    1,
  );
}

function readItem(db: DatabaseSync, id: string): ItemRow & { title: string; rationale: string } {
  const row = db.prepare("SELECT id, label, status, body FROM items WHERE id = ?").get(id) as ItemRow;
  const body = JSON.parse(row.body) as { title?: string; rationale?: string };
  return { ...row, title: body.title ?? "", rationale: body.rationale ?? "" };
}

function readJobs(db: DatabaseSync): JobRow[] {
  return db
    .prepare("SELECT id, kind, payload, state, result, subject, run_at FROM wiki_jobs ORDER BY id")
    .all()
    .map((row) => ({ ...(row as JobRow) }));
}

async function openWiki(db: DatabaseSync): Promise<Wiki> {
  const mod = (await import(storeSpecifier)) as { WikiBase: { prototype: Wiki } };
  const wiki = Object.create(mod.WikiBase.prototype) as Wiki;
  wiki.sql = sqliteStorage(db);
  wiki.get = (id: string) => {
    const row = db.prepare("SELECT id, label, kind, status, body, origin, updated_at FROM items WHERE id = ?").get(id) as
      | { id: string; label: string; kind: string; status: string; body: string; origin: string; updated_at: number }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      label: row.label,
      kind: row.kind,
      plane: "internal",
      origin: row.origin,
      status: row.status,
      revision: 1,
      authorId: null,
      tags: [],
      body: row.body,
      targetNode: null,
      releaseTarget: "scope",
      userValidated: null,
      sensitivityFlags: [],
      reviewedBy2: false,
      approvals: 0,
      required: 1,
      createdAt: NOW,
      updatedAt: row.updated_at,
    };
  };
  return wiki;
}

test("proposal scrub: legacy and unknown words become rejected and the body is emptied", async () => {
  const db = new DatabaseSync(":memory:");
  schema(db);
  insertItem(db, "legacy", "legacy", proposal("SECRET-LEGACY", [SOURCE]));
  insertItem(db, "unknown", "nope", proposal("SECRET-UNKNOWN", [SOURCE]));
  const wiki = await openWiki(db);
  wiki.wikiForgetSources([SOURCE], NOW);
  const legacy = readItem(db, "legacy");
  const unknown = readItem(db, "unknown");
  assert.deepEqual(
    {
      legacy: { status: legacy.status, label: legacy.label, title: legacy.title, rationale: legacy.rationale },
      unknown: { status: unknown.status, label: unknown.label, title: unknown.title, rationale: unknown.rationale },
      legacyKept: legacy.body.includes("SECRET-LEGACY"),
      unknownKept: unknown.body.includes("SECRET-UNKNOWN"),
    },
    {
      legacy: { status: "rejected", label: "Erased source", title: "Erased source", rationale: "" },
      unknown: { status: "rejected", label: "Erased source", title: "Erased source", rationale: "" },
      legacyKept: false,
      unknownKept: false,
    },
  );
  db.close();
});

test("proposal scrub: approved keeps its word and loses its body", async () => {
  const db = new DatabaseSync(":memory:");
  schema(db);
  insertItem(db, "kept", "approved", proposal("SECRET-APPROVED", [SOURCE]));
  const wiki = await openWiki(db);
  wiki.wikiForgetSources([SOURCE], NOW);
  const row = readItem(db, "kept");
  assert.equal(row.status, "approved");
  assert.equal(row.label, "Erased source");
  assert.equal(row.title, "Erased source");
  assert.equal(row.body.includes("SECRET-APPROVED"), false);
  db.close();
});

test("proposal scrub: rejected stays rejected and loses its body", async () => {
  const db = new DatabaseSync(":memory:");
  schema(db);
  insertItem(db, "kept", "rejected", proposal("SECRET-REJECTED", [SOURCE]));
  const wiki = await openWiki(db);
  wiki.wikiForgetSources([SOURCE], NOW);
  const row = readItem(db, "kept");
  assert.equal(row.status, "rejected");
  assert.equal(row.label, "Erased source");
  assert.equal(row.title, "Erased source");
  assert.equal(row.body.includes("SECRET-REJECTED"), false);
  db.close();
});

test("proposal scrub: a running job is cancelled and only queued or failed jobs are deleted", async () => {
  const db = new DatabaseSync(":memory:");
  schema(db);
  const insert = db.prepare(
    "INSERT INTO wiki_jobs (id, kind, payload, run_at, state, result, subject) VALUES (?, 'ingest', ?, 50, ?, ?, ?)",
  );
  insert.run(1, JSON.stringify({ sourceId: SOURCE }), "pending", null, SOURCE);
  insert.run(2, JSON.stringify({ sourceId: SOURCE }), "failed", "err", SOURCE);
  insert.run(3, JSON.stringify({ sourceId: SOURCE, marker: "RUN" }), "running", "claim-1", SOURCE);
  insert.run(4, JSON.stringify({ sourceId: SOURCE }), "done", "ok", SOURCE);
  const wiki = await openWiki(db);
  wiki.wikiForgetSources([SOURCE], NOW);
  assert.deepEqual(readJobs(db), [
    {
      id: 3,
      kind: "ingest",
      payload: JSON.stringify({ sourceId: SOURCE, marker: "RUN" }),
      state: "cancelled",
      result: "claim-1",
      subject: SOURCE,
      run_at: 50,
    },
    {
      id: 4,
      kind: "ingest",
      payload: JSON.stringify({ sourceId: SOURCE }),
      state: "done",
      result: "ok",
      subject: SOURCE,
      run_at: 50,
    },
  ]);
  db.close();
});

test("proposal scrub: a row or job that only mentions the source id is left alone", async () => {
  const db = new DatabaseSync(":memory:");
  schema(db);
  const mentioned = mention(SOURCE);
  insertItem(db, "mention", "candidate", mentioned);
  insertItem(db, "record", "candidate", mentioned, "record");
  db.prepare(
    "INSERT INTO wiki_jobs (id, kind, payload, run_at, state, result, subject) VALUES (1, 'ingest', ?, 50, 'pending', NULL, 'src_9')",
  ).run(JSON.stringify({ note: `${SOURCE} is mentioned` }));
  const wiki = await openWiki(db);
  wiki.wikiForgetSources([SOURCE], NOW);
  assert.deepEqual(
    {
      mention: readItem(db, "mention"),
      record: readItem(db, "record"),
      jobs: readJobs(db),
    },
    {
      mention: {
        id: "mention",
        label: "Home",
        status: "candidate",
        body: mentioned,
        title: `notes mention ${SOURCE}`,
        rationale: "SECRET-MENTION",
      },
      record: {
        id: "record",
        label: "Home",
        status: "candidate",
        body: mentioned,
        title: `notes mention ${SOURCE}`,
        rationale: "SECRET-MENTION",
      },
      jobs: [
        {
          id: 1,
          kind: "ingest",
          payload: JSON.stringify({ note: `${SOURCE} is mentioned` }),
          state: "pending",
          result: null,
          subject: "src_9",
          run_at: 50,
        },
      ],
    },
  );
  db.close();
});

test("proposal scrub: a status that changes before the write is not clobbered", async () => {
  const db = new DatabaseSync(":memory:");
  schema(db);
  const raced = proposal("SECRET-RACE", [SOURCE]);
  insertItem(db, "a_citing", "candidate", proposal("first", [SOURCE]));
  insertItem(db, "b_raced", "candidate", raced);
  db.exec(`
    CREATE TRIGGER flip_raced AFTER UPDATE ON items
    WHEN NEW.id = 'a_citing'
    BEGIN
      UPDATE items SET status = 'live' WHERE id = 'b_raced';
    END;
  `);
  const wiki = await openWiki(db);
  wiki.wikiForgetSources([SOURCE], NOW);
  const row = readItem(db, "b_raced");
  assert.equal(row.status, "live");
  assert.equal(row.label, "Home");
  assert.equal(row.body, raced);
  db.close();
});
