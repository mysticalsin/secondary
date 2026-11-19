/**
 * Wiki page revisions are scrubbed by the workspace derived path.
 * The wiki store returns the targets and leaves the stored markdown in place.
 */

import assert from "node:assert/strict";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sqliteStorage } from "../runtime/sqlite-storage.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const wikiSpecifier = "../../src/worker/wiki/store.ts";
const workspaceSpecifier = "../../src/worker/workspace.ts";
const SECRET = "Keep\nSecret {src:src_1}";

type RevisionTarget = { pageId: string; revision: number; markdown: string };

type Forget = {
  facts: number;
  pages: number;
  proposals: number;
  revisions?: RevisionTarget[];
};

type Store = {
  wikiForgetSources(ids: string[], now: number): Forget;
};

function openCtx(db: DatabaseSync): {
  ctx: unknown;
  ready: () => Promise<unknown>;
} {
  let ready: Promise<unknown> = Promise.resolve();
  return {
    ctx: {
      storage: { sql: sqliteStorage(db) },
      blockConcurrencyWhile(fn: () => Promise<unknown>) {
        ready = fn();
        return ready;
      },
    },
    ready: () => ready,
  };
}

async function openWiki(): Promise<{ db: DatabaseSync; store: Store }> {
  const db = new DatabaseSync(":memory:");
  const { ctx, ready } = openCtx(db);
  const mod = (await import(wikiSpecifier)) as {
    WikiBase: new (ctx: unknown, env: unknown) => Store;
  };
  const store = new mod.WikiBase(ctx, {});
  await ready();
  return { db, store };
}

async function openWorkspace(): Promise<{ db: DatabaseSync; store: Store }> {
  const db = new DatabaseSync(":memory:");
  const { ctx, ready } = openCtx(db);
  const mod = (await import(workspaceSpecifier)) as {
    Workspace: new (ctx: unknown, env: unknown) => Store;
  };
  const store = new mod.Workspace(ctx, {});
  await ready();
  return { db, store };
}

function plant(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY, label TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL,
      body TEXT, origin TEXT NOT NULL DEFAULT 'human', updated_at INTEGER NOT NULL);
  `);
  db.prepare(
    `INSERT INTO wiki_pages (id, type, title, markdown, summary, revision, status, created_at, updated_at)
     VALUES ('pub', 'concept', 'Public', ?, '', 1, 'published', 1, 1)`,
  ).run(SECRET);
  db.prepare(
    `INSERT INTO wiki_page_revisions (page_id, revision, title, markdown, actor, at)
     VALUES ('pub', 1, 'Public', ?, 'ada', 1)`,
  ).run(SECRET);
}

function markdown(db: DatabaseSync): string {
  const row = db
    .prepare("SELECT markdown FROM wiki_page_revisions WHERE page_id = 'pub' AND revision = 1")
    .get() as { markdown: string };
  return row.markdown;
}

test("page revisions are scrubbed only by the workspace derived path", async () => {
  const bare = await openWiki();
  plant(bare.db);
  const returned = bare.store.wikiForgetSources(["src_1"], 5);
  const bareMarkdown = markdown(bare.db);
  bare.db.close();

  const ws = await openWorkspace();
  plant(ws.db);
  ws.store.wikiForgetSources(["src_1"], 5);
  ws.store.wikiForgetSources(["src_1"], 6);
  const applied = markdown(ws.db);
  ws.db.close();

  assert.deepEqual(
    { bare: bareMarkdown, targets: returned.revisions ?? [], applied },
    {
      bare: SECRET,
      targets: [{ pageId: "pub", revision: 1, markdown: "Keep" }],
      applied: "Keep",
    },
  );
});
