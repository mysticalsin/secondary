/**
 * A finish whose role already matches the grant still clears the in-flight claim.
 * The next place of a different role is a new claim.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { openSqlite, sqliteStorage } from "../runtime/sqlite-storage.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const NOW = 1_700_000_000_000;
const storeSpecifier = "../../src/worker/brains/store.ts";

const proposal = {
  kind: "member_add" as const,
  payload: { principalId: "ada", scope: { type: "department", id: "eng" }, subspace: null },
  scopeKey: "department:eng",
  scope: {
    type: "department" as const,
    id: "eng",
    dept: null,
    label: "Engineering",
    restricted: false,
    nda: false,
    subspace: null,
  },
  needsSecond: true,
  proposedBy: "bea",
  label: "Adding a member of Engineering",
};

type Place =
  | { ok: true; status: "applied" | "pending"; changeId: string }
  | { ok: false; status: number; code: string };

type Brain = { sql: SqlStorage };

function tempFile(): { file: string; remove: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "brain-reapply-"));
  return {
    file: path.join(dir, "brain.sqlite"),
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("brain finish: a same-role apply clears the claim so the next role can be placed", async () => {
  const { file, remove } = tempFile();
  try {
    const db = openSqlite(file);
    db.exec(`
      CREATE TABLE brain_members (
        principal_id TEXT PRIMARY KEY, role TEXT NOT NULL, state TEXT NOT NULL,
        added_by TEXT NOT NULL, at INTEGER NOT NULL, change_id TEXT, claim_key TEXT);
      CREATE TABLE wiki_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL,
        kind TEXT NOT NULL, detail TEXT NOT NULL);
    `);
    db.prepare(
      `INSERT INTO brain_members (principal_id, role, state, added_by, at)
       VALUES ('ada', 'reader', 'active', 'bea', 1)`,
    ).run();
    const sql = sqliteStorage(db);
    const mod = (await import(storeSpecifier)) as {
      BrainBase: { prototype: Brain };
      placeScopedMember: (
        gov: unknown,
        brain: Brain,
        proposal: unknown,
        principalId: string,
        role: string,
        actor: string,
        now: number,
      ) => Promise<Place>;
    };
    const brain = Object.create(mod.BrainBase.prototype) as Brain;
    brain.sql = sql;
    let n = 0;
    const changes = new Map<string, { id: string; status: string }>();
    const gov = {
      propose(input: { claimKey?: string }) {
        n += 1;
        const id = `chg_${n}`;
        changes.set(input.claimKey ?? "", { id, status: "applied" });
        return { ok: true as const, change: { id }, applied: true };
      },
      changeByKey(key: string) {
        return changes.get(key) ?? null;
      },
    };
    const first = await mod.placeScopedMember(gov, brain, proposal, "ada", "reader", "bea", NOW);
    const afterFirst = db
      .prepare(
        `SELECT role, state, pending_role, pending_at FROM brain_members WHERE principal_id = 'ada'`,
      )
      .get() as Record<string, unknown>;
    const second = await mod.placeScopedMember(gov, brain, proposal, "ada", "owner", "bea", NOW + 1);
    const afterSecond = db
      .prepare(
        `SELECT role, state, pending_role, pending_at FROM brain_members WHERE principal_id = 'ada'`,
      )
      .get() as Record<string, unknown>;
    assert.deepEqual(
      {
        first: first.ok ? first.status : first.code,
        afterFirst: { ...afterFirst },
        second: second.ok ? second.status : second.code,
        afterSecond: { ...afterSecond },
      },
      {
        first: "applied",
        afterFirst: { role: "reader", state: "active", pending_role: null, pending_at: null },
        second: "applied",
        afterSecond: { role: "owner", state: "active", pending_role: null, pending_at: null },
      },
    );
    db.close();
  } finally {
    remove();
  }
});
