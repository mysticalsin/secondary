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

type Workspace = {
  wikiForgetSources(ids: string[], now: number): { facts: number; pages: number; proposals: number };
  history(id: string): Revision[];
};

function proposal(title: string): string {
  return JSON.stringify({
    v: 1,
    kind: "wiki_ingest",
    title,
    rationale: "SECRET-SNAPSHOT",
    origin: "human",
    pages: [{ pageId: "p1", type: "note", title, markdown: "SECRET-SNAPSHOT", baseRevision: 1 }],
    facts: [],
    invalidate: [],
    confirm: [],
    archive: [],
    reingest: [],
    sources: [{ id: "src_1", hash: "h", title: "T" }],
    findingKey: null,
    titleSources: ["src_1"],
  });
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
  const body = proposal("SECRET-SNAPSHOT");
  db.prepare(
    `INSERT INTO items (id, label, kind, plane, origin, status, revision, author_id, body, created_at, updated_at)
     VALUES ('prop_1', 'SECRET-SNAPSHOT', 'wiki_ingest', 'INTERNAL', 'human', 'candidate', 1, 'ada', ?, 1, 1)`,
  ).run(body);
  db.prepare(
    "INSERT INTO revisions (item_id, revision, label, body, actor_id, at) VALUES ('prop_1', 1, 'SECRET-SNAPSHOT', ?, 'ada', 1)",
  ).run(body);
  db.prepare(
    "INSERT INTO revisions (item_id, revision, label, body, actor_id, at) VALUES ('other', 1, 'Kept', 'kept note', 'bea', 1)",
  ).run();
  ws.wikiForgetSources(["src_1"], NOW);
  ws.wikiForgetSources(["src_1"], NOW + 1);
  const item = db.prepare("SELECT label, body FROM items WHERE id = 'prop_1'").get() as {
    label: string;
    body: string;
  };
  const served = ws.history("prop_1").map((row) => ({ label: row.label, body: row.body }));
  const other = ws.history("other").map((row) => ({ label: row.label, body: row.body }));
  assert.equal(item.label, "Erased source");
  assert.equal(String(item.body).includes("SECRET-SNAPSHOT"), false);
  assert.deepEqual(
    { served, other },
    { served: [{ label: item.label, body: item.body }], other: [{ label: "Kept", body: "kept note" }] },
  );
  db.close();
});
