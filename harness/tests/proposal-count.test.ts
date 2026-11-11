/**
 * Wiki approval counts distinct people. It does not read the wall clock.
 * A second person releases a two-person proposal at one hour and at 48 hours.
 * The same person twice leaves the row candidate. Personal review releases on one approval.
 */

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { register } from "node:module";
import test from "node:test";
import { sqliteStorage } from "../runtime/sqlite-storage.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;
const storeSpecifier = "../../recovered-source/worker/src/wiki/store.ts";

type Decide = { ok: true; status: string } | { ok: false; code: string; message: string };

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
};

function body(): string {
  return JSON.stringify({
    v: 1,
    kind: "wiki_ingest",
    title: "Home",
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
  });
}

function item(required: number): Record<string, unknown> & { body: string } {
  return {
    id: "prop_1",
    label: "Home",
    kind: "wiki_ingest",
    plane: "internal",
    origin: "human",
    status: "candidate",
    revision: 1,
    authorId: "bea",
    tags: [],
    body: body(),
    targetNode: null,
    releaseTarget: null,
    userValidated: null,
    sensitivityFlags: [],
    reviewedBy2: false,
    approvals: 0,
    required,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function openWiki(scopeId: string): { db: DatabaseSync; row: ReturnType<typeof item> } {
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
  db.prepare("INSERT INTO wiki_meta (key, value) VALUES ('scope_id', ?)").run(scopeId);
  db.prepare("INSERT INTO wiki_meta (key, value) VALUES ('tenant_id', 'ten')").run();
  return { db, row: item(scopeId.startsWith("personal:") ? 2 : 2) };
}

async function wikiOf(db: DatabaseSync, row: Record<string, unknown>, scopeId: string): Promise<Wiki> {
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
  wiki.wikiMeta = () => ({ scopeId, tenantId: "ten" });
  wiki.applyProposal = () => ({ pages: [], facts: 0, invalidated: 0, archived: 0 });
  return wiki;
}

function storedStatus(db: DatabaseSync): string {
  const row = db.prepare("SELECT status, updated_at FROM items WHERE id = 'prop_1'").get() as {
    status: string;
    updated_at: number;
  };
  return { ...row }.status;
}

function approvalCount(db: DatabaseSync): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM approvals WHERE kind = 'approve'").get() as { n: number };
  return { ...row }.n;
}

async function decide(wiki: Wiki, row: { id: string; revision: number; body: string }, actor: string, now: number) {
  const hash = await wiki.proposalHash(row);
  return wiki.wikiDecide(row.id, "approve", actor, now, { revisionHash: hash });
}

async function seed(scopeId: string): Promise<{ db: DatabaseSync; wiki: Wiki; row: ReturnType<typeof item> }> {
  const { db, row } = openWiki(scopeId);
  db.prepare("INSERT INTO items (id, status, revision, updated_at, body) VALUES ('prop_1', 'candidate', 1, ?, ?)").run(
    NOW,
    row.body,
  );
  const wiki = await wikiOf(db, row, scopeId);
  return { db, wiki, row };
}

test("proposal count: a second distinct approver at 48 hours releases a two-person proposal", async () => {
  const { db, wiki, row } = await seed("team:mantu");
  const first = await decide(wiki, row, "ada", NOW);
  assert.equal(first.ok, true);
  if (first.ok) assert.equal(first.status, "pending");
  assert.equal(storedStatus(db), "candidate");
  const second = await decide(wiki, row, "cy", NOW + 48 * HOUR);
  assert.equal(second.ok, true);
  if (second.ok) assert.equal(second.status, "approved");
  assert.equal(storedStatus(db), "approved");
  db.close();
});

test("proposal count: a second distinct approver at one hour releases a two-person proposal", async () => {
  const { db, wiki, row } = await seed("team:mantu");
  const first = await decide(wiki, row, "ada", NOW);
  assert.equal(first.ok, true);
  if (first.ok) assert.equal(first.status, "pending");
  const second = await decide(wiki, row, "cy", NOW + HOUR);
  assert.equal(second.ok, true);
  if (second.ok) assert.equal(second.status, "approved");
  assert.equal(storedStatus(db), "approved");
  db.close();
});

test("proposal count: the same person twice leaves the proposal candidate", async () => {
  const { db, wiki, row } = await seed("team:mantu");
  const first = await decide(wiki, row, "ada", NOW);
  assert.equal(first.ok, true);
  if (first.ok) assert.equal(first.status, "pending");
  const second = await decide(wiki, row, "ada", NOW + 48 * HOUR);
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.code, "already_done");
  assert.equal(storedStatus(db), "candidate");
  assert.equal(approvalCount(db), 1);
  db.close();
});

test("proposal count: a personal review releases on one approval", async () => {
  const { db, wiki, row } = await seed("personal:ada");
  const result = await decide(wiki, row, "ada", NOW + 48 * HOUR);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.status, "approved");
  assert.equal(storedStatus(db), "approved");
  assert.equal(approvalCount(db), 1);
  db.close();
});
