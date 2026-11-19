import assert from "node:assert/strict";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { admittedView } from "../../packages/policy/src/engine.ts";
import { buildOrg } from "../../packages/policy/src/org.ts";
import { persona } from "../../packages/policy/src/personas.ts";
import { ROLES } from "../../packages/policy/src/roles.ts";
import type { Role } from "../../packages/policy/src/types.ts";
import { sqliteStorage } from "../runtime/sqlite-storage.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const NOW = 1_700_000_000_000;

const editorRole: Role = {
  id: "circle_editor",
  label: "Circle editor",
  summary: "Edits the sales circle and is not its lead.",
  grants: [
    {
      scope_type: "circle",
      scope_id: "c_sales",
      actions: ["view_structure", "view_content", "comment", "contribute", "edit", "review"],
      conditions: {},
    },
  ],
  exclusions: [],
  never: [],
};

test("wiki decide: a standing edit or review grant is not enough to decide or direct-publish", async () => {
  const specifier = new URL("../../recovered-source/worker/src/wiki/review.ts", import.meta.url).href;
  const openSpecifier = new URL("../../recovered-source/worker/src/brains/open.ts", import.meta.url).href;
  const { mayDecide } = (await import(specifier)) as {
    mayDecide: (
      view: ReturnType<typeof admittedView>,
      principal: ReturnType<typeof persona>,
      nodeId: string,
    ) => { allowed: boolean };
  };
  const { directPublish } = (await import(openSpecifier)) as {
    directPublish: (
      c: unknown,
      w: {
        personal: boolean;
        vn: { kind: string } | null;
        stub: { brainConfig: () => Promise<{ publication: string }> };
        can: { edit: boolean; decide: boolean };
      },
    ) => Promise<boolean>;
  };
  const org = buildOrg({ roles: { ...ROLES, circle_editor: editorRole } });
  const editor = { ...persona("consultant"), id: "u_editor", roleIds: ["circle_editor"], memberships: [] };
  const view = admittedView(editor, org, { now: NOW });
  const allowed = mayDecide(view, editor, "c_sales").allowed;
  assert.equal(allowed, false);
  let published: boolean | "threw" = "threw";
  try {
    published = await directPublish(
      {},
      {
        personal: false,
        vn: { kind: "circle" },
        stub: { brainConfig: async () => ({ publication: "direct" }) },
        can: { edit: true, decide: allowed },
      },
    );
  } catch {
    published = "threw";
  }
  assert.equal(published, false);

  const lead = persona("acme_lead");
  const leadView = admittedView(lead, org, { now: NOW });
  assert.equal(mayDecide(leadView, lead, "a_acme").allowed, true);
  assert.equal(mayDecide(leadView, lead, "c_sales").allowed, true);
  assert.equal(mayDecide(leadView, lead, "core").allowed, false);
});

type Decide = { ok: true; status: string } | { ok: false; code: string };

test("wiki decide: an alias, a different letter case, and a reject are still the author's", async () => {
  const storeSpecifier = new URL("../../recovered-source/worker/src/wiki/store.ts", import.meta.url).href;
  const mod = (await import(storeSpecifier)) as { WikiBase: { prototype: object } };
  const body = JSON.stringify({
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
  const open = async (authorId: string) => {
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
    `);
    db.prepare("INSERT INTO wiki_meta (key, value) VALUES ('scope_id', 'team:mantu')").run();
    db.prepare(
      "INSERT INTO items (id, status, revision, updated_at, body) VALUES ('prop_1', 'candidate', 1, ?, ?)",
    ).run(NOW, body);
    const row = {
      id: "prop_1",
      kind: "wiki_ingest",
      status: "candidate",
      revision: 1,
      authorId,
      body,
      approvals: 0,
      required: 1,
    };
    const wiki = Object.create(mod.WikiBase.prototype) as {
      sql: ReturnType<typeof sqliteStorage>;
      ctx: { storage: { transactionSync: <T>(fn: () => T) => T } };
      get(id: string): unknown;
      wikiMeta(): { scopeId: string };
      wikiDecide(
        id: string,
        decision: "approve" | "reject",
        actorId: string,
        now: number,
        opts: { sameHuman?: string[] },
      ): Promise<Decide>;
    };
    wiki.sql = sqliteStorage(db);
    wiki.ctx = { storage: { transactionSync: (fn) => fn() } };
    wiki.get = (id) => (id === row.id ? row : null);
    wiki.wikiMeta = () => ({ scopeId: "team:mantu" });
    return { db, wiki };
  };

  const alias = await open("alias-1");
  const aliasResult = await alias.wiki.wikiDecide("prop_1", "approve", "u_lead", NOW, {
    sameHuman: ["alias-1"],
  });
  assert.equal(aliasResult.ok, false);
  if (!aliasResult.ok) assert.equal(aliasResult.code, "self_approval");
  alias.db.close();

  const folded = await open("Ada");
  const foldedResult = await folded.wiki.wikiDecide("prop_1", "reject", "ada", NOW, {});
  assert.equal(foldedResult.ok, false);
  if (!foldedResult.ok) assert.equal(foldedResult.code, "self_approval");
  const stored = folded.db.prepare("SELECT status FROM items WHERE id = 'prop_1'").get() as { status: string };
  assert.equal(stored.status, "candidate");
  folded.db.close();
});
