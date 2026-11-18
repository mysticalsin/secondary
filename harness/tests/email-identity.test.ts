/**
 * One email identity for the lookups that still compared stored bytes.
 * Real modules, node:sqlite, nothing stubbed. Stored emails are not rewritten.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { normalEmail, normalizedEmailSql } from "../../src/state/actor.ts";
import { openSqlite, sqliteStorage } from "../runtime/sqlite-storage.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const NOW = 1_700_000_000_000;
const policySpecifier = "../../recovered-source/worker/src/tenant-policy.ts";

/** The padding set, plus the ASCII whitespace SQLite trim() keeps and String.trim() strips. */
const FOLD = [
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x00a0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004,
  0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
] as const;

type Session = { principal: { id: string }; active: boolean };
type Policy = {
  session(input: {
    email: string;
    actAs: null;
    now: number;
    limit: number;
    via?: "entra" | "access" | "internal";
    managed?: boolean;
  }): Promise<Session>;
  sessionCreate(
    idHash: string,
    who: { tid: string; oid: string; email: string; emailIsUpn: boolean; guest: boolean },
    groups: string[],
    now: number,
    managed: boolean,
  ): Promise<{ ok: true; principalId: string } | { ok: false; reason: string }>;
  scimUserCreate(
    input: { userName: string; active: boolean },
    now: number,
  ): Promise<{ ok: true } | { ok: false; code: string }>;
  scimUserPatch(
    id: string,
    change: { userName: string },
    now: number,
  ): Promise<{ ok: true } | { ok: false; code: string }>;
  scimUserList(
    filter: { userName?: string },
    start: number,
    count: number,
  ): { total: number; users: { id: string }[] };
};

function tempFile(): { file: string; remove: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "email-id-"));
  return {
    file: path.join(dir, "tenant.sqlite"),
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}

async function openPolicy(file: string): Promise<{ policy: Policy; db: DatabaseSync }> {
  const db = openSqlite(file);
  const sql = sqliteStorage(db);
  let ready: Promise<void> = Promise.resolve();
  const ctx = {
    storage: {
      sql,
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
    blockConcurrencyWhile(fn: () => Promise<void>) {
      ready = fn();
      return ready;
    },
  };
  const mod = (await import(policySpecifier)) as {
    TenantPolicy: new (ctx: unknown, env: unknown) => Policy;
  };
  const policy = new mod.TenantPolicy(ctx, {});
  await ready;
  return { policy, db };
}

function addPrincipal(db: DatabaseSync, id: string, email: string, subject: string | null = null): void {
  db.prepare("INSERT INTO principals (id, email, subject) VALUES (?, ?, ?)").run(id, email, subject);
}

function addScim(db: DatabaseSync, id: string, principalId: string, userName: string): void {
  db.prepare(
    `INSERT INTO scim_users (id, principal_id, user_name, external_id, display_name, name, emails, created_at, modified_at)
     VALUES (?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)`,
  ).run(id, principalId, userName, NOW, NOW);
}

function emailOf(db: DatabaseSync, id: string): string | undefined {
  const row = db.prepare("SELECT email FROM principals WHERE id = ?").get(id) as { email: string } | undefined;
  return row?.email;
}

function countOf(db: DatabaseSync): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM principals").get() as { n: number }).n;
}

function scimCount(db: DatabaseSync): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM scim_users").get() as { n: number }).n;
}

function captureWarn(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const prev = console.warn;
  console.warn = (line?: unknown) => {
    lines.push(String(line));
  };
  return {
    lines,
    restore: () => {
      console.warn = prev;
    },
  };
}

function ambiguous(lines: string[]): { at?: string; reason?: string; ids?: string[] } {
  const hit = lines
    .map((line) => JSON.parse(line) as { at?: string; reason?: string; ids?: string[] })
    .find((line) => line.reason === "ambiguous_principal");
  assert.ok(hit, "ambiguous_principal was not logged");
  assert.deepEqual(Object.keys(hit).sort(), ["at", "ids", "reason"]);
  assert.equal(JSON.stringify(hit).toLowerCase().includes("@"), false);
  return hit;
}

test("email identity: access hijack sees the subject of Ada@A.example", async () => {
  const { file, remove } = tempFile();
  try {
    const { policy, db } = await openPolicy(file);
    addPrincipal(db, "ada", "Ada@A.example", "contoso:ada");
    addPrincipal(db, "plain", "Ada@Plain.example", null);
    const session = await policy.session({
      email: "ada@a.example",
      actAs: null,
      now: NOW,
      limit: 100,
      via: "access",
      managed: false,
    });
    assert.equal(session.principal.id, "ada");
    assert.equal(session.active, false);
    const known = await policy.session({
      email: "ada@plain.example",
      actAs: null,
      now: NOW,
      limit: 100,
      via: "access",
      managed: false,
    });
    assert.equal(known.principal.id, "plain");
    assert.equal(known.active, true);
    db.close();
  } finally {
    remove();
  }
});

test("email identity: a managed tenant does not lock out Ada@A.example", async () => {
  const { file, remove } = tempFile();
  try {
    const { policy, db } = await openPolicy(file);
    addPrincipal(db, "ada", "Ada@A.example", "contoso:ada");
    const session = await policy.session({
      email: "ada@a.example",
      actAs: null,
      now: NOW,
      limit: 100,
      managed: true,
    });
    assert.equal(session.principal.id, "ada");
    assert.equal(session.active, true);
    db.close();
  } finally {
    remove();
  }
});

test("email identity: an entra session matches the exact-address outcome", async () => {
  const { file, remove } = tempFile();
  try {
    const { policy, db } = await openPolicy(file);
    addPrincipal(db, "ada", "Ada@A.example", "contoso:ada");
    addPrincipal(db, "exact", "ada@exact.example", "contoso:exact");
    const twin = await policy.session({
      email: "ada@a.example",
      actAs: null,
      now: NOW,
      limit: 100,
      via: "entra",
      managed: true,
    });
    const exact = await policy.session({
      email: "ada@exact.example",
      actAs: null,
      now: NOW,
      limit: 100,
      via: "entra",
      managed: true,
    });
    assert.equal(twin.principal.id, "ada");
    assert.equal(exact.principal.id, "exact");
    assert.equal(twin.active, exact.active);
    assert.equal(exact.active, true);
    const signed = await policy.sessionCreate(
      "entra-ada",
      { tid: "contoso", oid: "ada", email: "ada@a.example", emailIsUpn: true, guest: false },
      [],
      NOW,
      false,
    );
    assert.equal(signed.ok, true);
    if (signed.ok) assert.equal(signed.principalId, "ada");
    assert.equal(countOf(db), 2);
    assert.equal(emailOf(db, "ada"), "Ada@A.example");
    db.close();
  } finally {
    remove();
  }
});

test("email identity: rename refuses an address that differs only by case or padding", async () => {
  const { file, remove } = tempFile();
  try {
    const { policy, db } = await openPolicy(file);
    addPrincipal(db, "case", "Ada@R.example");
    addScim(db, "su-case", "case", "Ada@R.example");
    addPrincipal(db, "pad", " ada@pad.example\u00A0");
    addScim(db, "su-pad", "pad", " ada@pad.example\u00A0");
    addPrincipal(db, "bea", "bea@r.example");
    addScim(db, "su-bea", "bea", "bea@r.example");
    const toCase = await policy.scimUserPatch("su-bea", { userName: "ada@r.example" }, NOW);
    assert.equal(toCase.ok, false);
    if (!toCase.ok) assert.equal(toCase.code, "uniqueness");
    assert.equal(emailOf(db, "bea"), "bea@r.example");
    assert.equal(emailOf(db, "case"), "Ada@R.example");
    const toPad = await policy.scimUserPatch("su-bea", { userName: "ada@pad.example" }, NOW);
    assert.equal(toPad.ok, false);
    if (!toPad.ok) assert.equal(toPad.code, "uniqueness");
    assert.equal(emailOf(db, "pad"), " ada@pad.example\u00A0");
    db.close();
  } finally {
    remove();
  }
});

test("email identity: resolveEntra does not create a principal for a case or padding twin", async () => {
  const { file, remove } = tempFile();
  try {
    const { policy, db } = await openPolicy(file);
    addPrincipal(db, "case", "Ada@A.example", "contoso:stored");
    addPrincipal(db, "pad", "\u00A0ada@pad.example ", null);
    addPrincipal(db, "edge", "ada@edge.example\n", null);
    const caseSignIn = await policy.sessionCreate(
      "case",
      { tid: "contoso", oid: "fresh", email: "ada@a.example", emailIsUpn: true, guest: false },
      [],
      NOW,
      false,
    );
    assert.equal(caseSignIn.ok, false);
    if (!caseSignIn.ok) assert.equal(caseSignIn.reason, "identity_conflict");
    assert.equal(countOf(db), 3);
    assert.equal(emailOf(db, "case"), "Ada@A.example");
    const padSignIn = await policy.sessionCreate(
      "pad",
      { tid: "contoso", oid: "pad", email: "ada@pad.example", emailIsUpn: true, guest: false },
      [],
      NOW,
      false,
    );
    assert.equal(padSignIn.ok, true);
    if (padSignIn.ok) assert.equal(padSignIn.principalId, "pad");
    assert.equal(countOf(db), 3);
    assert.equal(emailOf(db, "pad"), "\u00A0ada@pad.example ");
    const edgeSignIn = await policy.sessionCreate(
      "edge",
      { tid: "contoso", oid: "edge", email: "ada@edge.example", emailIsUpn: true, guest: false },
      [],
      NOW,
      false,
    );
    assert.equal(edgeSignIn.ok, true);
    if (edgeSignIn.ok) assert.equal(edgeSignIn.principalId, "edge");
    assert.equal(countOf(db), 3);
    assert.equal(emailOf(db, "edge"), "ada@edge.example\n");
    db.close();
  } finally {
    remove();
  }
});

test("email identity: two normalized matches are refused and the log holds ids only", async () => {
  const { file, remove } = tempFile();
  const warn = captureWarn();
  try {
    const { policy, db } = await openPolicy(file);
    addPrincipal(db, "p1", "Ada@Multi.example");
    addPrincipal(db, "p2", " ada@multi.example ");
    addPrincipal(db, "bea", "bea@multi.example");
    addScim(db, "su-bea", "bea", "bea@multi.example");
    const renamed = await policy.scimUserPatch("su-bea", { userName: "ada@multi.example" }, NOW);
    assert.equal(renamed.ok, false);
    if (!renamed.ok) assert.equal(renamed.code, "uniqueness");
    assert.equal(emailOf(db, "bea"), "bea@multi.example");
    assert.equal(countOf(db), 3);
    const logged = ambiguous(warn.lines);
    assert.deepEqual(logged.ids, ["p1", "p2"]);
    db.close();
  } finally {
    warn.restore();
    remove();
  }
});

test("email identity: resolveEntra refuses two case twins and does not insert", async () => {
  const { file, remove } = tempFile();
  const warn = captureWarn();
  try {
    const { policy, db } = await openPolicy(file);
    addPrincipal(db, "p1", "Ada@Twin.example", null);
    addPrincipal(db, "p2", "ada@twin.example\t", null);
    const signed = await policy.sessionCreate(
      "twin",
      { tid: "contoso", oid: "new", email: "ada@twin.example", emailIsUpn: true, guest: false },
      [],
      NOW,
      false,
    );
    assert.equal(signed.ok, false);
    if (!signed.ok) assert.equal(signed.reason, "identity_conflict");
    assert.equal(countOf(db), 2);
    const logged = ambiguous(warn.lines);
    assert.deepEqual(logged.ids, ["p1", "p2"]);
    db.close();
  } finally {
    warn.restore();
    remove();
  }
});

test("email identity: ensurePrincipal rolls back an insert when the second lookup finds another id", async () => {
  const { file, remove } = tempFile();
  const warn = captureWarn();
  try {
    const { policy, db } = await openPolicy(file);
    db.exec(`
      CREATE TRIGGER fork_principal AFTER INSERT ON principals
      WHEN NEW.email = 'ada@race.example'
      BEGIN
        INSERT INTO principals (id, email) VALUES ('other-race', 'Ada@Race.example');
      END;
    `);
    const created = await policy.scimUserCreate({ userName: "ada@race.example", active: true }, NOW);
    assert.equal(created.ok, false);
    if (!created.ok) assert.equal(created.code, "ambiguous");
    assert.equal(countOf(db), 0);
    const logged = ambiguous(warn.lines);
    assert.deepEqual(logged.ids, ["other-race"]);
    db.close();
  } finally {
    warn.restore();
    remove();
  }
});

test("email identity: sql and js fold one list, including tab, newline, blank, and spaces", () => {
  const db = new DatabaseSync(":memory:");
  const expr = normalizedEmailSql("?");
  const codes = [...expr.matchAll(/char\((\d+)\)/g)].map((match) => Number(match[1]));
  assert.deepEqual(codes, [...FOLD]);
  const sqlEmail = (value: string): string | null =>
    (db.prepare(`SELECT ${expr} AS v`).get(value) as { v: string | null }).v;
  const samples = ["", "   ", "\t", "\n", "\t\n \r", " \u00A0 ", "Ada@Fold.example"];
  for (const code of FOLD) {
    const ch = String.fromCharCode(code);
    samples.push(ch, `${ch}Ada@Fold.example${ch}`, `a${ch}da@fold.example`);
  }
  for (const sample of samples) {
    assert.equal(sqlEmail(sample), normalEmail(sample), JSON.stringify(sample));
  }
  assert.equal(normalEmail(""), null);
  assert.equal(normalEmail("   "), null);
  assert.equal(normalEmail("\t\n"), null);
  assert.equal(sqlEmail(""), null);
  assert.equal(sqlEmail("   "), null);
  assert.equal(sqlEmail("\t\n"), null);
  db.close();
});

test("email identity: kelvin sign and dotted I do not match an ASCII principal", async () => {
  const kelvin = `\u212A@ascii.example`;
  const dotted = `\u0130@ascii.example`;
  const mem = new DatabaseSync(":memory:");
  const expr = normalizedEmailSql("?");
  const sqlEmail = (value: string): string | null =>
    (mem.prepare(`SELECT ${expr} AS v`).get(value) as { v: string | null }).v;
  assert.equal(sqlEmail(kelvin), normalEmail(kelvin));
  assert.equal(sqlEmail(dotted), normalEmail(dotted));
  assert.notEqual(normalEmail(kelvin), "k@ascii.example");
  assert.notEqual(normalEmail(dotted), "i@ascii.example");
  const dottedFold = normalEmail(dotted);
  assert.equal(typeof dottedFold, "string");
  assert.equal(dottedFold?.includes("\u0307"), false);
  mem.close();

  const { file, remove } = tempFile();
  try {
    const { policy, db } = await openPolicy(file);
    addPrincipal(db, "kay", "k@ascii.example");
    addPrincipal(db, "aye", "i@ascii.example");
    const kelvinSign = await policy.sessionCreate(
      "hash-kelvin",
      { tid: "contoso", oid: "oid-kelvin", email: kelvin, emailIsUpn: true, guest: false },
      [],
      NOW,
      false,
    );
    const dottedSign = await policy.sessionCreate(
      "hash-dotted",
      { tid: "contoso", oid: "oid-dotted", email: dotted, emailIsUpn: true, guest: false },
      [],
      NOW,
      false,
    );
    assert.equal(kelvinSign.ok, true);
    assert.equal(dottedSign.ok, true);
    if (kelvinSign.ok) assert.notEqual(kelvinSign.principalId, "kay");
    if (dottedSign.ok) assert.notEqual(dottedSign.principalId, "aye");
    assert.equal(emailOf(db, "kay"), "k@ascii.example");
    assert.equal(emailOf(db, "aye"), "i@ascii.example");
    assert.equal(countOf(db), 4);
    db.close();
  } finally {
    remove();
  }
});

test("email identity: the same folded name back to back does not add a principal", async () => {
  const { file, remove } = tempFile();
  try {
    const { policy, db } = await openPolicy(file);
    const first = await policy.scimUserCreate({ userName: "ada@back.example", active: true }, NOW);
    assert.equal(first.ok, true);
    const second = await policy.scimUserCreate({ userName: "ADA@back.example", active: true }, NOW);
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.code, "uniqueness");
    assert.equal(countOf(db), 1);
    const other = await policy.scimUserCreate({ userName: "bea@back.example", active: true }, NOW);
    assert.equal(other.ok, true);
    const id = db.prepare("SELECT id FROM scim_users WHERE user_name = ?").get("bea@back.example") as {
      id: string;
    };
    const renamed = await policy.scimUserPatch(id.id, { userName: "Ada@back.example" }, NOW);
    assert.equal(renamed.ok, false);
    if (!renamed.ok) assert.equal(renamed.code, "uniqueness");
    assert.equal(countOf(db), 2);
    db.close();
  } finally {
    remove();
  }
});

test("email identity: SCIM create and patch keep kelvin and dotted I off the ASCII principals", async () => {
  const kelvin = "\u212A@scim.example";
  const dotted = "\u0130@scim.example";
  const { file, remove } = tempFile();
  try {
    const { policy, db } = await openPolicy(file);
    addPrincipal(db, "kay", "k@scim.example");
    addScim(db, "su-kay", "kay", "k@scim.example");
    addPrincipal(db, "aye", "i@scim.example");
    addScim(db, "su-aye", "aye", "i@scim.example");
    addPrincipal(db, "bea", "bea@scim.example");
    addScim(db, "su-bea", "bea", "bea@scim.example");
    const created = await policy.scimUserCreate({ userName: kelvin, active: true }, NOW);
    assert.equal(created.ok, true);
    const createdName = db.prepare("SELECT user_name, principal_id FROM scim_users WHERE user_name = ?").get(kelvin) as
      | { user_name: string; principal_id: string }
      | undefined;
    assert.equal(createdName?.user_name, kelvin);
    assert.notEqual(createdName?.principal_id, "kay");
    const patched = await policy.scimUserPatch("su-bea", { userName: dotted }, NOW);
    assert.equal(patched.ok, true);
    const patchedName = db.prepare("SELECT user_name FROM scim_users WHERE id = ?").get("su-bea") as {
      user_name: string;
    };
    assert.equal(patchedName.user_name, dotted);
    assert.equal(emailOf(db, "kay"), "k@scim.example");
    assert.equal(emailOf(db, "aye"), "i@scim.example");
    db.close();
  } finally {
    remove();
  }
});

test("email identity: a patch of an address with no local part is invalid", async () => {
  const { file, remove } = tempFile();
  try {
    const { policy, db } = await openPolicy(file);
    addPrincipal(db, "bea", "bea@blank.example");
    addScim(db, "su-bea", "bea", "bea@blank.example");
    for (const userName of ["@ascii.example", "@"]) {
      const patched = await policy.scimUserPatch("su-bea", { userName }, NOW);
      assert.equal(patched.ok, false);
      if (!patched.ok) assert.equal(patched.code, "invalid");
    }
    assert.equal(emailOf(db, "bea"), "bea@blank.example");
    const stored = db.prepare("SELECT user_name FROM scim_users WHERE id = ?").get("su-bea") as {
      user_name: string;
    };
    assert.equal(stored.user_name, "bea@blank.example");
    db.close();
  } finally {
    remove();
  }
});

test("email identity: a patch of a blank folded name writes nothing", async () => {
  const { file, remove } = tempFile();
  try {
    const { policy, db } = await openPolicy(file);
    addPrincipal(db, "bea", "bea@blank.example");
    addScim(db, "su-bea", "bea", "bea@blank.example");
    const patched = await policy.scimUserPatch("su-bea", { userName: "\u00A0\u00A0" }, NOW);
    assert.equal(patched.ok, false);
    if (!patched.ok) assert.equal(patched.code, "invalid");
    assert.equal(emailOf(db, "bea"), "bea@blank.example");
    const stored = db.prepare("SELECT user_name FROM scim_users WHERE id = ?").get("su-bea") as {
      user_name: string;
    };
    assert.equal(stored.user_name, "bea@blank.example");
    assert.equal(countOf(db), 1);
    db.close();
  } finally {
    remove();
  }
});

test("email identity: a folded SCIM user name is one person and does not insert another", async () => {
  const { file, remove } = tempFile();
  try {
    const { policy, db } = await openPolicy(file);
    addPrincipal(db, "stored", "other@same.example");
    addScim(db, "su-stored", "stored", "Ada@Same.example");
    const created = await policy.scimUserCreate({ userName: "ada@same.example", active: true }, NOW);
    assert.equal(created.ok, false);
    if (!created.ok) assert.equal(created.code, "uniqueness");
    assert.equal(countOf(db), 1);
    assert.equal(scimCount(db), 1);
    assert.equal(emailOf(db, "stored"), "other@same.example");

    addPrincipal(db, "ada", "ada@scim.example");
    addScim(db, "su-ada", "ada", "ada@scim.example");
    const signed = await policy.sessionCreate(
      "hash-scim-case",
      { tid: "contoso", oid: "oid-ada", email: "Ada@Scim.example", emailIsUpn: true, guest: false },
      [],
      NOW,
      true,
    );
    assert.equal(signed.ok, true);
    if (signed.ok) assert.equal(signed.principalId, "ada");
    assert.equal(countOf(db), 2);
    assert.equal(emailOf(db, "ada"), "ada@scim.example");

    const listed = policy.scimUserList({ userName: " Ada@Scim.example " }, 1, 20);
    assert.equal(listed.total, 1);
    assert.equal(listed.users[0]?.id, "su-ada");
    const blank = policy.scimUserList({ userName: " \u00A0 " }, 1, 20);
    assert.equal(blank.total, 0);

    addPrincipal(db, "bea", "bea@other.example");
    addScim(db, "su-bea", "bea", "bea@other.example");
    const renamed = await policy.scimUserPatch("su-bea", { userName: "ada@same.example" }, NOW);
    assert.equal(renamed.ok, false);
    if (!renamed.ok) assert.equal(renamed.code, "uniqueness");
    assert.equal(emailOf(db, "bea"), "bea@other.example");
    assert.equal(countOf(db), 3);

    addPrincipal(db, "self", "kept@self.example");
    addScim(db, "su-self", "self", "Ada@Self.example");
    const foldedSelf = await policy.scimUserPatch("su-self", { userName: "ada@self.example" }, NOW);
    assert.equal(foldedSelf.ok, true);
    assert.equal(countOf(db), 4);

    const missing = await policy.sessionCreate(
      "hash-scim-missing",
      { tid: "contoso", oid: "oid-missing", email: "other@scim.example", emailIsUpn: true, guest: false },
      [],
      NOW,
      true,
    );
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.reason, "not_provisioned");
    assert.equal(countOf(db), 4);
    db.close();
  } finally {
    remove();
  }
});
