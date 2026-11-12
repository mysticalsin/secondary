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
  search(match: string, limit: number): { id: string; rank: number }[];
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

test("a source scrub updates only the proposals it scrubbed", async () => {
  const db = new DatabaseSync(":memory:");
  const ws = await openWorkspace(db);
  const item = db.prepare(
    `INSERT INTO items (id, label, kind, plane, origin, status, revision, author_id, body, created_at, updated_at)
     VALUES (?, ?, 'wiki_ingest', 'INTERNAL', 'human', 'candidate', 1, 'ada', ?, 1, 1)`,
  );
  const revision = db.prepare(
    "INSERT INTO revisions (item_id, revision, label, body, actor_id, at) VALUES (?, 1, ?, ?, 'ada', 1)",
  );
  const kept = "ALREADY_ERASED";
  item.run("kept", "Erased source", kept);
  revision.run("kept", "Original title", "KEEP_HISTORY");
  const first = proposal("Quote", "src_secret");
  const secondBody = proposal("Other", "src_secret");
  item.run("scrub_a", "Quote", first);
  item.run("scrub_b", "Other", secondBody);
  revision.run("scrub_a", "Quote", first);
  revision.run("scrub_b", "Other", secondBody);
  ws.wikiForgetSources(["src_secret"], NOW);
  ws.wikiForgetSources(["src_secret"], NOW + 1);
  const live = (id: string) =>
    db.prepare("SELECT label, body FROM items WHERE id = ?").get(id) as { label: string; body: string };
  const historyOf = (id: string) => ws.history(id).map((row) => ({ label: row.label, body: row.body }));
  assert.deepEqual(
    { kept: historyOf("kept"), scrubA: historyOf("scrub_a"), scrubB: historyOf("scrub_b") },
    {
      kept: [{ label: "Original title", body: "KEEP_HISTORY" }],
      scrubA: [{ label: "Erased source", body: live("scrub_a").body }],
      scrubB: [{ label: "Erased source", body: live("scrub_b").body }],
    },
  );
  db.close();
});

test("person erasure removes the email from served source text and source search", async () => {
  const db = new DatabaseSync(":memory:");
  const ws = await openWorkspace(db);
  const email = "ada@example.invalid";
  db.prepare(
    `INSERT INTO items (id, label, kind, plane, origin, status, revision, author_id, body, created_at, updated_at)
     VALUES ('cand_1', 'Candidate', 'candidate', 'INTERNAL', 'human', 'candidate', 1, 'user_1', ?, 1, 1)`,
  ).run(`ping ${email}`);
  db.prepare(
    "INSERT INTO revisions (item_id, revision, label, body, actor_id, at) VALUES ('cand_1', 1, 'Candidate', ?, 'user_1', 1)",
  ).run(`ping ${email}`);
  db.prepare(
    "INSERT INTO comments (item_id, author_id, text, at) VALUES ('cand_1', 'user_1', ?, 1)",
  ).run(`ping ${email}`);
  db.prepare(
    `INSERT INTO source_items (id, source_id, gate_node_id, plane, title, body, size, etag, synced_at)
     VALUES ('file_1', 'src_mail', 'gate', 'INTERNAL', ?, ?, 1, 'e', 1)`,
  ).run(`file ${email}`, `body ${email}`);
  db.prepare("INSERT INTO source_fts (title, body, id) VALUES (?, ?, 'file_1')").run(
    `file ${email}`,
    `body ${email}`,
  );
  db.prepare(
    "INSERT INTO brain_fields (page_id, field_key, value, written_by, written_at) VALUES ('page_kept', 'note', ?, 'bea', 1)",
  ).run(email);
  db.prepare(
    "INSERT INTO brain_fields (page_id, field_key, value, written_by, written_at) VALUES ('page_other', 'note', 'bea@example.com', 'bea', 1)",
  ).run();
  ws.pseudonymise("user_1", "pz_user", [email]);
  const second = ws.pseudonymise("user_1", "pz_user", [email]);
  const item = db.prepare("SELECT body FROM items WHERE id = 'cand_1'").get() as { body: string };
  const revision = db.prepare("SELECT body FROM revisions WHERE item_id = 'cand_1'").get() as { body: string };
  const comment = db.prepare("SELECT author_id, text FROM comments WHERE item_id = 'cand_1'").get() as {
    author_id: string;
    text: string;
  };
  const source = db.prepare("SELECT title, body FROM source_items WHERE id = 'file_1'").get() as {
    title: string;
    body: string;
  };
  const fields = db
    .prepare("SELECT page_id, value FROM brain_fields ORDER BY page_id")
    .all()
    .map((row) => ({ ...(row as { page_id: string; value: string }) }));
  const found = ws.sourceSearch("ada", 10).map((row) => row.title);
  assert.deepEqual(
    {
      item: item.body,
      revision: revision.body,
      comment: { ...comment },
      source: { ...source },
      fields,
      found,
      second,
    },
    {
      item: "ping pz_user",
      revision: "ping pz_user",
      comment: { author_id: "pz_user", text: "ping pz_user" },
      source: { title: "file pz_user", body: "body pz_user" },
      fields: [
        { page_id: "page_kept", value: "pz_user" },
        { page_id: "page_other", value: "bea@example.com" },
      ],
      found: [],
      second: { items: 0, comments: 0, approvals: 0, edits: 0 },
    },
  );
  db.close();
});

test("person erasure drops the name and the email from item search", async () => {
  const db = new DatabaseSync(":memory:");
  const ws = await openWorkspace(db);
  const email = "ada@example.invalid";
  const item = db.prepare(
    `INSERT INTO items (id, label, kind, plane, origin, status, revision, author_id, body, created_at, updated_at)
     VALUES (?, ?, 'candidate', 'INTERNAL', 'human', 'candidate', 1, 'bea', '', 1, 1)`,
  );
  item.run("named", "Meet Ada");
  item.run("mailed", email);
  const index = db.prepare("INSERT INTO items_fts (label, id) VALUES (?, ?)");
  index.run("Meet Ada", "named");
  index.run(email, "mailed");
  ws.pseudonymise("user_1", "pz_user", ["Ada", email]);
  ws.pseudonymise("user_1", "pz_user", ["Ada", email]);
  const hits = (match: string) => ws.search(match, 10).map((row) => row.id).sort();
  assert.deepEqual(
    { name: hits("Ada"), email: hits("example AND invalid") },
    { name: [], email: [] },
  );
  db.close();
});

test("a two-character name is erased on a word boundary", async () => {
  const db = new DatabaseSync(":memory:");
  const ws = await openWorkspace(db);
  db.prepare(
    `INSERT INTO items (id, label, kind, plane, origin, status, revision, author_id, body, created_at, updated_at)
     VALUES ('note', 'Body text', 'candidate', 'INTERNAL', 'human', 'candidate', 1, 'bea', 'see Bo now', 1, 1)`,
  ).run();
  db.prepare("INSERT INTO comments (item_id, author_id, text, at) VALUES ('note', 'bea', 'Bo wrote', 1)").run();
  ws.pseudonymise("user_1", "pz_user", ["Bo"]);
  ws.pseudonymise("user_1", "pz_user", ["Bo"]);
  const item = db.prepare("SELECT label, body FROM items WHERE id = 'note'").get() as {
    label: string;
    body: string;
  };
  const comment = db.prepare("SELECT text FROM comments").get() as { text: string };
  assert.deepEqual(
    { item: { ...item }, comment: comment.text },
    { item: { label: "Body text", body: "see pz_user now" }, comment: "pz_user wrote" },
  );
  db.close();
});

test("a two-character name is erased from history and wiki text", async () => {
  const db = new DatabaseSync(":memory:");
  const ws = await openWorkspace(db);
  db.prepare(
    `INSERT INTO items (id, label, kind, plane, origin, status, revision, author_id, body, created_at, updated_at)
     VALUES ('hist', 'Body text', 'candidate', 'INTERNAL', 'human', 'candidate', 1, 'bea', 'see Bo now', 1, 1)`,
  ).run();
  db.prepare(
    "INSERT INTO revisions (item_id, revision, label, body, actor_id, at) VALUES ('hist', 1, 'Body text', 'see Bo now', 'bea', 1)",
  ).run();
  db.prepare(
    `INSERT INTO wiki_pages (id, type, title, markdown, summary, revision, status, created_at, updated_at)
     VALUES ('page', 'note', 'Body page', 'Bo wrote it. Body stays.', '', 1, 'published', 1, 1)`,
  ).run();
  ws.pseudonymise("user_1", "pz_user", ["Bo"]);
  ws.pseudonymise("user_1", "pz_user", ["Bo"]);
  const history = ws.history("hist").map((row) => ({ label: row.label, body: row.body }));
  const page = db.prepare("SELECT title, markdown FROM wiki_pages WHERE id = 'page'").get() as {
    title: string;
    markdown: string;
  };
  assert.deepEqual(
    { history, page: { ...page } },
    {
      history: [{ label: "Body text", body: "see pz_user now" }],
      page: { title: "Body page", markdown: "pz_user wrote it. Body stays." },
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
  item.run("old", "draft note", '["draft"]', "PRIVATE_NOTE", 1);
  item.run("fresh", "brief note", '["brief"]', "kept brief", NOW);
  const revision = db.prepare(
    "INSERT INTO revisions (item_id, revision, label, body, actor_id, at) VALUES (?, 1, ?, ?, 'user_1', 1)",
  );
  revision.run("old", "draft note", "PRIVATE_NOTE");
  revision.run("fresh", "brief note", "kept brief");
  const purged = ws.purgeExpired({ draft: 1_000, brief: 1_000 });
  const second = ws.purgeExpired({ draft: 1_000, brief: 1_000 });
  const left = db.prepare("SELECT COUNT(*) AS n FROM items").get() as { n: number };
  const text = (rows: Revision[]) => rows.map((row) => ({ label: row.label, body: row.body }));
  assert.deepEqual(
    { purged, left: left.n, oldHistory: text(ws.history("old")), freshHistory: text(ws.history("fresh")), second },
    {
      purged: 1,
      left: 1,
      oldHistory: [],
      freshHistory: [{ label: "brief note", body: "kept brief" }],
      second: 0,
    },
  );
  db.close();
});

test("deleting a cited page removes its brain fields without a later field purge", async () => {
  const db = new DatabaseSync(":memory:");
  const ws = await openWorkspace(db);
  const page = db.prepare(
    `INSERT INTO wiki_pages (id, type, title, markdown, summary, revision, status, created_at, updated_at)
     VALUES (?, 'note', ?, ?, '', 1, 'published', 1, 1)`,
  );
  page.run("page_gone", "Gone", "{src:src_secret}");
  page.run("page_kept", "Kept", "# Kept\n\nstill here");
  const field = db.prepare(
    "INSERT INTO brain_fields (page_id, field_key, value, written_by, written_at) VALUES (?, 'note', ?, 'ada', 1)",
  );
  field.run("page_gone", "SECRET_FIELD");
  field.run("page_kept", "kept field");
  ws.wikiForgetSources(["src_secret"], NOW);
  ws.wikiForgetSources(["src_secret"], NOW + 1);
  const fields = db
    .prepare("SELECT page_id, value FROM brain_fields ORDER BY page_id")
    .all()
    .map((row) => ({ ...(row as { page_id: string; value: string }) }));
  const gone = db.prepare("SELECT id FROM wiki_pages WHERE id = 'page_gone'").get() ?? null;
  assert.deepEqual({ gone, fields }, { gone: null, fields: [{ page_id: "page_kept", value: "kept field" }] });
  db.close();
});
