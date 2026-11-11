/**
 * A proposal decision compares the status it read.
 * An unknown word writes nothing. A finding changes only from open.
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
const storeSpecifier = "../../recovered-source/worker/src/wiki/store.ts";

type Decide = { ok: true; status: string } | { ok: false; code: string; message: string };
type Edited = { ok: true; revision: number } | { ok: false; code: string; message: string };

type Wiki = {
  sql: ReturnType<typeof sqliteStorage>;
  ctx: { storage: { transactionSync: <T>(fn: () => T) => T } };
  get(id: string): unknown;
  wikiMeta(): { scopeId: string; tenantId: string } | null;
  proposalHash(item: { id: string; revision: number; body: string | null }): Promise<string>;
  applyProposal(): { pages: string[]; facts: number; invalidated: number; archived: number };
  wikiDecide(
    id: string,
    decision: "approve" | "reject",
    actorId: string,
    now: number,
    opts: { revisionHash?: string },
  ): Promise<Decide>;
  wikiEditProposal(
    id: string,
    actorId: string,
    pageId: string,
    markdown: string,
    now: number,
  ): Edited;
};

function proposal(page: boolean): string {
  return JSON.stringify({
    v: 1,
    kind: "wiki_ingest",
    title: "Home",
    rationale: "",
    origin: "human",
    pages: page
      ? [{ pageId: "home", type: "topic", title: "Home", baseRevision: null, markdown: "Old" }]
      : [],
    facts: [],
    invalidate: [],
    confirm: [],
    archive: [],
    reingest: [],
    sources: [],
    findingKey: "contra:1",
  });
}

function item(status: string, revision = 1): Record<string, unknown> & { body: string } {
  return {
    id: "prop_1",
    label: "Home",
    kind: "wiki_ingest",
    plane: "internal",
    origin: "human",
    status,
    revision,
    authorId: "bea",
    tags: [],
    body: proposal(false),
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
}

function openWiki(): { db: DatabaseSync; wiki: Wiki } {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE wiki_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE wiki_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL,
      kind TEXT NOT NULL, detail TEXT NOT NULL);
    CREATE TABLE approvals (
      item_id TEXT NOT NULL, revision INTEGER NOT NULL, actor_id TEXT NOT NULL,
      kind TEXT NOT NULL, at INTEGER NOT NULL, verdict TEXT,
      PRIMARY KEY (item_id, revision, actor_id, kind));
    CREATE TABLE edits (item_id TEXT NOT NULL, revision INTEGER NOT NULL, actor_id TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE TABLE items (
      id TEXT PRIMARY KEY, status TEXT NOT NULL, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL, body TEXT);
    CREATE TABLE wiki_findings (
      key TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, proposal_id TEXT, at INTEGER);
  `);
  db.prepare("INSERT INTO wiki_meta (key, value) VALUES ('scope_id', 'team:mantu')").run();
  db.prepare("INSERT INTO wiki_meta (key, value) VALUES ('tenant_id', 'ten')").run();
  return { db, wiki: null as unknown as Wiki };
}

async function wikiOf(db: DatabaseSync, row: Record<string, unknown>): Promise<Wiki> {
  const mod = (await import(storeSpecifier)) as { WikiBase: { prototype: Wiki } };
  const wiki = Object.create(mod.WikiBase.prototype) as Wiki;
  wiki.sql = sqliteStorage(db);
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
  wiki.get = (id: string) => (id === row.id ? row : null);
  wiki.wikiMeta = () => ({ scopeId: "team:mantu", tenantId: "ten" });
  wiki.applyProposal = () => ({ pages: [], facts: 0, invalidated: 0, archived: 0 });
  return wiki;
}

function storedStatus(db: DatabaseSync): string {
  const row = db.prepare("SELECT status FROM items WHERE id = 'prop_1'").get() as { status: string };
  return { ...row }.status;
}

function findingStatus(db: DatabaseSync): string {
  const row = db.prepare("SELECT status FROM wiki_findings WHERE key = 'contra:1'").get() as { status: string };
  return { ...row }.status;
}

test("proposal review: an unknown item status writes nothing", async () => {
  const { db } = openWiki();
  db.prepare("INSERT INTO items (id, status, revision, updated_at, body) VALUES ('prop_1', 'legacy', 1, ?, ?)").run(
    NOW,
    proposal(false),
  );
  const row = item("legacy");
  const wiki = await wikiOf(db, row);
  const result = await wiki.wikiDecide("prop_1", "reject", "ada", NOW, {});
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "state_unreadable");
  assert.equal(storedStatus(db), "legacy");
  db.close();
});

test("proposal review: a reject that loses the candidate compare-and-set writes nothing", async () => {
  const { db } = openWiki();
  db.prepare("INSERT INTO items (id, status, revision, updated_at, body) VALUES ('prop_1', 'approved', 1, ?, ?)").run(
    NOW,
    proposal(false),
  );
  const wiki = await wikiOf(db, item("candidate"));
  const result = await wiki.wikiDecide("prop_1", "reject", "ada", NOW, {});
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "replay");
  assert.equal(storedStatus(db), "approved");
  db.close();
});

test("proposal review: approving does not resolve a dismissed finding", async () => {
  const { db } = openWiki();
  const row = item("candidate");
  db.prepare("INSERT INTO items (id, status, revision, updated_at, body) VALUES ('prop_1', 'candidate', 1, ?, ?)").run(
    NOW,
    row.body,
  );
  db.prepare(
    "INSERT INTO wiki_findings (key, kind, status, proposal_id, at) VALUES ('contra:1', 'wiki_ingest', 'dismissed', 'prop_1', ?)",
  ).run(NOW);
  const wiki = await wikiOf(db, row);
  const hash = await wiki.proposalHash(row as { id: string; revision: number; body: string | null });
  const result = await wiki.wikiDecide("prop_1", "approve", "ada", NOW, { revisionHash: hash });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.status, "approved");
  assert.equal(storedStatus(db), "approved");
  assert.equal(findingStatus(db), "dismissed");
  db.close();
});

test("proposal review: approving does not overwrite an unknown finding status", async () => {
  const { db } = openWiki();
  const row = item("candidate");
  db.prepare("INSERT INTO items (id, status, revision, updated_at, body) VALUES ('prop_1', 'candidate', 1, ?, ?)").run(
    NOW,
    row.body,
  );
  db.prepare(
    "INSERT INTO wiki_findings (key, kind, status, proposal_id, at) VALUES ('contra:1', 'wiki_ingest', 'legacy', 'prop_1', ?)",
  ).run(NOW);
  const wiki = await wikiOf(db, row);
  const hash = await wiki.proposalHash(row as { id: string; revision: number; body: string | null });
  const result = await wiki.wikiDecide("prop_1", "approve", "ada", NOW, { revisionHash: hash });
  assert.equal(result.ok, true);
  assert.equal(findingStatus(db), "legacy");
  db.close();
});

test("proposal review: an edit that loses the revision compare-and-set writes nothing", async () => {
  const { db } = openWiki();
  const body = proposal(true);
  db.prepare("INSERT INTO items (id, status, revision, updated_at, body) VALUES ('prop_1', 'candidate', 2, ?, 'stored')").run(
    NOW,
  );
  const row = item("candidate", 1);
  row.body = body;
  const wiki = await wikiOf(db, row);
  const result = wiki.wikiEditProposal("prop_1", "ada", "home", "A short page.", NOW);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "replay");
  const stored = db.prepare("SELECT body, revision FROM items WHERE id = 'prop_1'").get() as {
    body: string;
    revision: number;
  };
  assert.equal({ ...stored }.body, "stored");
  assert.equal({ ...stored }.revision, 2);
  db.close();
});

test("proposal review: wikiDecide counts distinct approvers and does not use the quorum clock", () => {
  const src = readFileSync(new URL("../../recovered-source/worker/src/wiki/store.ts", import.meta.url), "utf8");
  const decide = src.slice(src.indexOf("async wikiDecide("), src.indexOf("wikiEditProposal("));
  assert.doesNotMatch(decide, /commitQuorum\(/);
  assert.match(decide, /approvers: \[\.\.\.prior, actorId\]/);
  assert.match(decide, /commitProposal\(/);
  assert.match(decide, /AND status = 'candidate'/);
  assert.match(decide, /SET status = 'dismissed' WHERE key = \? AND status = 'open'/);
  assert.match(decide, /SET status = 'resolved' WHERE key = \? AND status = 'open'/);
});
