/**
 * One erasure path owns the derived stores review and search still serve.
 * A source scrub must not leave the proposal snapshot. A person's email must
 * not stay in source text or source search. A retention purge must not leave
 * the note in its revisions.
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
const workspaceSpecifier = "../../recovered-source/worker/src/workspace.ts";

type Revision = { revision: number; label: string; body: string | null };

type SourceHit = { id: string; title: string };

type Workspace = {
  wikiForgetSources(ids: string[], now: number): { facts: number; pages: number; proposals: number };
  history(id: string): Revision[];
  pseudonymise(from: string, to: string, aliases?: string[]): {
    items: number;
    comments: number;
    approvals: number;
    edits: number;
  };
  sourceGet(id: string): { title: string; body: string | null } | null;
  sourceSearch(match: string, limit: number): SourceHit[];
  purgeExpired(cutoffs: Record<string, number>): number;
};

function proposal(title: string, sourceId: string): string {
  return JSON.stringify({
    v: 1,
    kind: "wiki_ingest",
    title,
    rationale: "SECRET_SOURCE_BODY",
    origin: "human",
    pages: [{ pageId: "p1", type: "note", title, markdown: "SECRET_SOURCE_BODY", baseRevision: 1 }],
    facts: [],
    invalidate: [],
    confirm: [],
    archive: [],
    reingest: [],
    sources: [{ id: sourceId, hash: "h", title: "T" }],
    findingKey: null,
    titleSources: [sourceId],
  });
}

function reviewCurrent(
  revision: number,
  history: Revision[],
  item: { label: string; body: string | null },
): { label: string; body: string | null } {
  const byRev = new Map(history.map((row) => [row.revision, row]));
  const snap = byRev.get(revision);
  return snap ? { label: snap.label, body: snap.body } : { label: item.label, body: item.body };
}

async function openWorkspace(db: DatabaseSync): Promise<Workspace> {
  let ready: Promise<unknown> = Promise.resolve();
  const ctx = {
    storage: {
      sql: sqliteStorage(db),
      transactionSync<T>(fn: () => T): T {
        return fn();
      },
      setAlarm() {},
    },
    blockConcurrencyWhile(fn: () => Promise<unknown>) {
      ready = fn();
      return ready;
    },
  };
  const mod = (await import(workspaceSpecifier)) as {
    Workspace: new (ctx: unknown, env: unknown) => Workspace;
  };
  const ws = new mod.Workspace(ctx, { WIKI_ALARMS: "off" });
  await ready;
  return ws;
}

test("a source scrub removes the proposal snapshot review serves", async () => {
  const db = new DatabaseSync(":memory:");
  const ws = await openWorkspace(db);
  const body = proposal("Quote", "src_secret");
  db.prepare(
    `INSERT INTO items (id, label, kind, plane, origin, status, revision, author_id, body, created_at, updated_at)
     VALUES ('cand:core:abcd1234', 'Quote', 'wiki_ingest', 'INTERNAL', 'human', 'candidate', 1, 'ada', ?, 1, 1)`,
  ).run(body);
  db.prepare(
    "INSERT INTO revisions (item_id, revision, label, body, actor_id, at) VALUES ('cand:core:abcd1234', 1, 'Quote', ?, 'ada', 1)",
  ).run(body);
  const forgotten = ws.wikiForgetSources(["src_secret"], NOW);
  const again = ws.wikiForgetSources(["src_secret"], NOW + 1);
  const item = db.prepare("SELECT revision, label, body FROM items WHERE id = 'cand:core:abcd1234'").get() as {
    revision: number;
    label: string;
    body: string;
  };
  const served = reviewCurrent(item.revision, ws.history("cand:core:abcd1234"), item);
  assert.deepEqual(
    {
      proposals: forgotten.proposals,
      again: again.proposals,
      live: String(item.body).includes("SECRET_SOURCE_BODY"),
      served,
    },
    {
      proposals: 1,
      again: 0,
      live: false,
      served: { label: "Erased source", body: item.body },
    },
  );
  db.close();
});

test("person erasure removes the email from served source text and source search", async () => {
  const db = new DatabaseSync(":memory:");
  const ws = await openWorkspace(db);
  const email = "ada.lovelace@example.invalid";
  const insert = db.prepare(
    `INSERT INTO source_items (id, source_id, gate_node_id, plane, title, body, size, etag, synced_at)
     VALUES (?, ?, 'gate', 'INTERNAL', ?, ?, 1, 'e', 1)`,
  );
  insert.run("mail", "src_mail", `Mail from ${email}`, `${email} wrote the note`);
  insert.run("other", "src_other", "Notes for bea@example.com", "bea@example.com kept this");
  const index = db.prepare("INSERT INTO source_fts (title, body, id) VALUES (?, ?, ?)");
  index.run(`Mail from ${email}`, `${email} wrote the note`, "mail");
  index.run("Notes for bea@example.com", "bea@example.com kept this", "other");
  ws.pseudonymise("user_1", "pz_user", [email]);
  const second = ws.pseudonymise("user_1", "pz_user", [email]);
  const text = (row: { title: string; body: string | null } | null) =>
    row === null ? null : { title: row.title, body: row.body };
  const mail = text(ws.sourceGet("mail"));
  const other = text(ws.sourceGet("other"));
  const found = ws.sourceSearch("lovelace", 10).map((row) => ({ id: row.id, title: row.title }));
  assert.deepEqual(
    { mail, other, found, second },
    {
      mail: { title: "Mail from pz_user", body: "pz_user wrote the note" },
      other: { title: "Notes for bea@example.com", body: "bea@example.com kept this" },
      found: [],
      second: { items: 0, comments: 0, approvals: 0, edits: 0 },
    },
  );
  db.close();
});

test("a retention purge removes the personal note from its revisions", async () => {
  const db = new DatabaseSync(":memory:");
  const ws = await openWorkspace(db);
  const item = db.prepare(
    `INSERT INTO items (id, label, kind, plane, origin, status, revision, author_id, tags, body, created_at, updated_at)
     VALUES (?, ?, 'personalitem', 'PERSONAL', 'human', 'published', 1, 'user_1', ?, ?, 1, ?)`,
  );
  item.run("old", "Private note", '["note"]', "SECRET-NOTE", 1);
  item.run("fresh", "Fresh", '["note"]', "kept fresh", NOW);
  const revision = db.prepare(
    "INSERT INTO revisions (item_id, revision, label, body, actor_id, at) VALUES (?, 1, ?, ?, 'user_1', 1)",
  );
  revision.run("old", "Private note", "SECRET-NOTE");
  revision.run("fresh", "Fresh", "kept fresh");
  ws.purgeExpired({ note: 1_000, brief: 1_000, draft: 1_000, view: 1_000 });
  const second = ws.purgeExpired({ note: 1_000, brief: 1_000, draft: 1_000, view: 1_000 });
  const oldItem = db.prepare("SELECT id FROM items WHERE id = 'old'").get() ?? null;
  const text = (rows: Revision[]) => rows.map((row) => ({ label: row.label, body: row.body }));
  assert.deepEqual(
    { oldItem, oldHistory: text(ws.history("old")), freshHistory: text(ws.history("fresh")), second },
    {
      oldItem: null,
      oldHistory: [],
      freshHistory: [{ label: "Fresh", body: "kept fresh" }],
      second: 0,
    },
  );
  db.close();
});
