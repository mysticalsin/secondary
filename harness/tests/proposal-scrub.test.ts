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
  wikiJobsDue(now: number, limit: number): { id: number; kind: string; payload: Record<string, unknown>; runAt: number }[];
  wikiEnqueue(kind: "ingest" | "lint" | "dream", payload: Record<string, unknown>, now: number, runAt?: number): Promise<void>;
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

async function openMigrated(db: DatabaseSync): Promise<Wiki> {
  let ready: Promise<unknown> = Promise.resolve();
  const ctx = {
    storage: { sql: sqliteStorage(db) },
    blockConcurrencyWhile(fn: () => Promise<unknown>) {
      ready = fn();
      return ready;
    },
  };
  const mod = (await import(storeSpecifier)) as {
    WikiBase: new (ctx: unknown, env: unknown) => Wiki;
  };
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

function plantLegacyJobs(db: DatabaseSync, withSubject: boolean): void {
  const subject = withSubject ? ", subject TEXT" : "";
  db.exec(`
    CREATE TABLE wiki_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, payload TEXT NOT NULL,
      run_at INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending', result TEXT${subject});
  `);
  const insert = db.prepare(
    "INSERT INTO wiki_jobs (kind, payload, run_at, state) VALUES ('ingest', ?, 1, ?)",
  );
  insert.run(JSON.stringify({ sourceId: SOURCE }), "pending");
  insert.run(JSON.stringify({ sourceId: SOURCE }), "failed");
  insert.run(JSON.stringify({ sourceId: "" }), "pending");
}

test("proposal scrub: a job stored before the subject column is still forgotten", async () => {
  const db = new DatabaseSync(":memory:");
  plantLegacyJobs(db, false);
  const wiki = await openMigrated(db);
  wiki.wikiForgetSources([SOURCE], NOW);
  assert.deepEqual(
    readJobs(db).map((job) => ({ state: job.state, subject: job.subject, payload: job.payload })),
    [{ state: "pending", subject: null, payload: JSON.stringify({ sourceId: "" }) }],
  );
  db.close();
});

test("proposal scrub: a null subject is filled when the column is already there", async () => {
  const db = new DatabaseSync(":memory:");
  plantLegacyJobs(db, true);
  const wiki = await openMigrated(db);
  wiki.wikiForgetSources([SOURCE], NOW);
  assert.deepEqual(
    readJobs(db).map((job) => ({ state: job.state, subject: job.subject, payload: job.payload })),
    [{ state: "pending", subject: null, payload: JSON.stringify({ sourceId: "" }) }],
  );
  db.close();
});

test("proposal scrub: a blank or whitespace source id stays unattributed and is not claimed", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE wiki_jobs (
    id INTEGER PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL,
    run_at INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending', result TEXT)`);
  const now = Date.now();
  const insert = db.prepare(
    "INSERT INTO wiki_jobs (id, kind, payload, run_at) VALUES (?, 'ingest', ?, ?)",
  );
  insert.run(1, JSON.stringify({ sourceId: " " }), now);
  insert.run(2, JSON.stringify({ sourceId: "" }), now);
  insert.run(3, JSON.stringify({ sourceId: "  src_1  " }), now);
  db.prepare("INSERT INTO wiki_jobs (id, kind, payload, run_at) VALUES (4, 'lint', '{}', ?)").run(now);
  const wiki = await openMigrated(db);
  wiki.wikiForgetSources([SOURCE], NOW);
  const claimed = wiki.wikiJobsDue(now, 10).map((job) => job.id);
  const left = readJobs(db).map((job) => ({
    id: job.id,
    state: job.state,
    result: job.result,
    subject: job.subject,
  }));
  assert.deepEqual(
    { claimed, left },
    {
      claimed: [4],
      left: [
        { id: 1, state: "failed", result: "unattributed", subject: null },
        { id: 2, state: "failed", result: "unattributed", subject: null },
        { id: 4, state: "running", result: left.find((job) => job.id === 4)?.result ?? null, subject: null },
      ],
    },
  );
  db.close();
});

test("proposal scrub: a whitespace subject copied earlier is cleared and not claimed", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE wiki_jobs (
    id INTEGER PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL,
    run_at INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending', result TEXT, subject TEXT)`);
  const now = Date.now();
  db.prepare(
    "INSERT INTO wiki_jobs (id, kind, payload, run_at, subject) VALUES (1, 'ingest', ?, ?, ' ')",
  ).run(JSON.stringify({ sourceId: " " }), now);
  const wiki = await openMigrated(db);
  const claimed = wiki.wikiJobsDue(now, 10).map((job) => job.id);
  const job = readJobs(db)[0];
  assert.deepEqual(
    { claimed, subject: job?.subject, state: job?.state, result: job?.result },
    { claimed: [], subject: null, state: "failed", result: "unattributed" },
  );
  db.close();
});

test("proposal scrub: an ingest job with no subject is refused and lint still runs", async () => {
  const db = new DatabaseSync(":memory:");
  schema(db);
  const now = Date.now();
  const insert = db.prepare(
    "INSERT INTO wiki_jobs (id, kind, payload, run_at, state, result, subject) VALUES (?, ?, ?, ?, 'pending', NULL, NULL)",
  );
  insert.run(1, "ingest", JSON.stringify({ secret: "PAYLOAD-SECRET" }), now);
  insert.run(2, "lint", "{}", now);
  insert.run(3, "dream", "{}", now);
  const wiki = await openWiki(db);
  const claimed = wiki.wikiJobsDue(now, 10).map((job) => job.kind).sort();
  const ingest = readJobs(db).find((job) => job.id === 1);
  const log = db
    .prepare("SELECT detail FROM wiki_log")
    .all()
    .map((row) => (row as { detail: string }).detail)
    .join("\n");
  assert.deepEqual(
    {
      claimed,
      ingest: { state: ingest?.state, result: ingest?.result },
      leaked: `${ingest?.result ?? ""}\n${log}`.includes("PAYLOAD-SECRET"),
      loggedId: log.includes("1"),
    },
    {
      claimed: ["dream", "lint"],
      ingest: { state: "failed", result: "unattributed" },
      leaked: false,
      loggedId: true,
    },
  );
  db.close();
});

async function scrubCitation(body: string): Promise<{
  completed: boolean;
  sourceDeleted: boolean;
  status: string;
  body: string;
}> {
  const db = new DatabaseSync(":memory:");
  schema(db);
  insertItem(db, "prop", "candidate", body);
  db.prepare("INSERT INTO wiki_sources (source_id) VALUES (?)").run(SOURCE);
  const wiki = await openWiki(db);
  let completed = true;
  try {
    wiki.wikiForgetSources([SOURCE], NOW);
  } catch {
    completed = false;
  }
  const source = db.prepare("SELECT source_id FROM wiki_sources WHERE source_id = ?").get(SOURCE);
  const item = db.prepare("SELECT status, body FROM items WHERE id = 'prop'").get() as { status: string; body: string };
  const out = { completed, sourceDeleted: source === undefined, status: item.status, body: item.body };
  db.close();
  return out;
}

function citation(extra: Record<string, unknown>): string {
  return JSON.stringify({
    v: 1,
    kind: "wiki_ingest",
    title: "KEEP-ME",
    rationale: "",
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
    ...extra,
  });
}

test("proposal scrub: a string titleSources value still scrubs and the delete finishes", async () => {
  const out = await scrubCitation(citation({ titleSources: SOURCE }));
  assert.deepEqual(
    { completed: out.completed, sourceDeleted: out.sourceDeleted, status: out.status, kept: out.body.includes("KEEP-ME") },
    { completed: true, sourceDeleted: true, status: "rejected", kept: false },
  );
});

test("proposal scrub: a string reingest value still scrubs and the delete finishes", async () => {
  const out = await scrubCitation(citation({ reingest: SOURCE }));
  assert.deepEqual(
    { completed: out.completed, sourceDeleted: out.sourceDeleted, status: out.status, kept: out.body.includes("KEEP-ME") },
    { completed: true, sourceDeleted: true, status: "rejected", kept: false },
  );
});

test("proposal scrub: sources stored as strings still scrub and the delete finishes", async () => {
  const out = await scrubCitation(citation({ sources: [SOURCE] }));
  assert.deepEqual(
    { completed: out.completed, sourceDeleted: out.sourceDeleted, status: out.status, kept: out.body.includes("KEEP-ME") },
    { completed: true, sourceDeleted: true, status: "rejected", kept: false },
  );
});

test("proposal scrub: a string sourceIds value still scrubs and the delete finishes", async () => {
  const out = await scrubCitation(citation({ facts: [{ sourceIds: SOURCE }] }));
  assert.deepEqual(
    { completed: out.completed, sourceDeleted: out.sourceDeleted, status: out.status, kept: out.body.includes("KEEP-ME") },
    { completed: true, sourceDeleted: true, status: "rejected", kept: false },
  );
});

test("proposal scrub: an invalid body that names the source still scrubs and the delete finishes", async () => {
  const out = await scrubCitation(`not-json "${SOURCE}" KEEP-ME`);
  assert.deepEqual(
    { completed: out.completed, sourceDeleted: out.sourceDeleted, status: out.status, kept: out.body.includes("KEEP-ME") },
    { completed: true, sourceDeleted: true, status: "rejected", kept: false },
  );
});

test("proposal scrub: a non-array citation that names only a longer id does not abort", async () => {
  const body = citation({ titleSources: "src_10" });
  const out = await scrubCitation(body);
  assert.deepEqual(
    { completed: out.completed, sourceDeleted: out.sourceDeleted, status: out.status, body: out.body },
    { completed: true, sourceDeleted: true, status: "candidate", body },
  );
});

test("proposal scrub: a sources array of a longer id does not throw and stays", async () => {
  const body = citation({ sources: ["src_10"] });
  const out = await scrubCitation(body);
  assert.deepEqual(
    { completed: out.completed, sourceDeleted: out.sourceDeleted, status: out.status, body: out.body },
    { completed: true, sourceDeleted: true, status: "candidate", body },
  );
});

test("proposal scrub: a rationale equal to the source id stays", async () => {
  const body = citation({ rationale: SOURCE });
  const out = await scrubCitation(body);
  assert.deepEqual(
    { completed: out.completed, sourceDeleted: out.sourceDeleted, status: out.status, body: out.body },
    { completed: true, sourceDeleted: true, status: "candidate", body },
  );
});

test("proposal scrub: a finding key equal to the source id stays", async () => {
  const body = citation({ findingKey: SOURCE });
  const out = await scrubCitation(body);
  assert.deepEqual(
    { completed: out.completed, sourceDeleted: out.sourceDeleted, status: out.status, body: out.body },
    { completed: true, sourceDeleted: true, status: "candidate", body },
  );
});

test("proposal scrub: a nested source title equal to the source id stays", async () => {
  const body = citation({ sources: [{ id: "src_9", hash: "h", title: SOURCE }] });
  const out = await scrubCitation(body);
  assert.deepEqual(
    { completed: out.completed, sourceDeleted: out.sourceDeleted, status: out.status, body: out.body },
    { completed: true, sourceDeleted: true, status: "candidate", body },
  );
});

test("proposal scrub: a malformed body that names only a longer id stays", async () => {
  const body = `not-json "src_10" KEEP-OTHER`;
  const out = await scrubCitation(body);
  assert.deepEqual(
    { completed: out.completed, sourceDeleted: out.sourceDeleted, status: out.status, body: out.body },
    { completed: true, sourceDeleted: true, status: "candidate", body },
  );
});

async function forgetJob(state: string): Promise<{ left: JobRow[]; claimed: string[] }> {
  const db = new DatabaseSync(":memory:");
  schema(db);
  const now = Date.now();
  db.prepare(
    "INSERT INTO wiki_jobs (id, kind, payload, run_at, state, result, subject) VALUES (1, 'ingest', ?, ?, ?, NULL, ?)",
  ).run(JSON.stringify({ sourceId: SOURCE }), now, state, SOURCE);
  const wiki = await openWiki(db);
  wiki.wikiForgetSources([SOURCE], NOW);
  const claimed = wiki.wikiJobsDue(now, 10).map((job) => job.kind);
  const left = readJobs(db);
  db.close();
  return { left, claimed };
}

test("proposal scrub: a queued job for a forgotten source is deleted and not claimed", async () => {
  const out = await forgetJob("queued");
  assert.deepEqual(out, { left: [], claimed: [] });
});

test("proposal scrub: a cancelled job stays and is not claimed", async () => {
  const out = await forgetJob("cancelled");
  assert.deepEqual(
    { state: out.left.map((job) => job.state), claimed: out.claimed },
    { state: ["cancelled"], claimed: [] },
  );
});

test("proposal scrub: an unknown job word stays and is not claimed", async () => {
  const out = await forgetJob("unknown");
  assert.deepEqual(
    { state: out.left.map((job) => job.state), claimed: out.claimed },
    { state: ["unknown"], claimed: [] },
  );
});

test("proposal scrub: an enqueued source id is trimmed and a blank one is refused", async () => {
  const db = new DatabaseSync(":memory:");
  const wiki = await openMigrated(db);
  const now = Date.now();
  await wiki.wikiEnqueue("ingest", { sourceId: " src_1 " }, now, now);
  await wiki.wikiEnqueue("ingest", { sourceId: "   " }, now, now);
  const claimed = wiki.wikiJobsDue(now, 10).map((job) => job.id);
  const left = readJobs(db).map((job) => ({
    id: job.id,
    subject: job.subject,
    state: job.state,
    result: job.state === "running" ? "claimed" : job.result,
  }));
  assert.deepEqual(
    { claimed, left },
    {
      claimed: [1],
      left: [
        { id: 1, subject: "src_1", state: "running", result: "claimed" },
        { id: 2, subject: null, state: "failed", result: "unattributed" },
      ],
    },
  );
  db.close();
});
