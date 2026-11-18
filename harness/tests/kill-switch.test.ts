/**
 * Kill switch on the real TenantPolicy and node:sqlite.
 * The cases that match today's flag stay. Corrupt, unknown, and unreadable inputs must fail closed.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { SECOND_PERSON_TTL_MS } from "../../src/state/quorum.ts";
import { SecurityJournal } from "../../recovered-source/worker/src/security-journal.ts";
import { openSqlite, sqliteStorage } from "../runtime/sqlite-storage.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const NOW = 1_700_000_000_000;
const policySpecifier = "../../recovered-source/worker/src/tenant-policy.ts";

type SwitchResult = { status: "applied" | "pending" | "replay" | "refused"; sameActor?: boolean };
type SwitchName = "mcp" | "connector" | "ai" | "contribute";

type Policy = {
  setSwitch(
    name: string,
    enabled: boolean,
    actor: string,
    now: number,
    twoPerson: boolean,
    email?: string,
  ): SwitchResult;
  switchStatus(now: number): {
    switches: Record<SwitchName, { enabled: boolean; changedAt: number | null }>;
    pending: { switch: string; requestedAt: number }[];
  };
};

function tempFile(): { file: string; remove: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "kill-switch-"));
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
        return fn();
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

function row(db: DatabaseSync, name: string): { enabled: number | string; changed_by: string } | undefined {
  const found = db.prepare("SELECT enabled, changed_by FROM switches WHERE name = ?").get(name) as
    | { enabled: number | string; changed_by: string }
    | undefined;
  return found ? { enabled: found.enabled, changed_by: found.changed_by } : undefined;
}

function pending(db: DatabaseSync, name: string): { requested_by: string } | undefined {
  return db.prepare("SELECT requested_by FROM pending_ops WHERE key = ?").get(`switch:${name}`) as
    | { requested_by: string }
    | undefined;
}

function journal(db: DatabaseSync, name: string): number[] {
  const rows = db.prepare("SELECT v FROM security_journal WHERE kind = 'switch' AND a = ? ORDER BY seq").all(name) as {
    v: number;
  }[];
  return rows.map((entry) => entry.v);
}

function replay(db: DatabaseSync): void {
  new SecurityJournal(sqliteStorage(db)).replay();
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

test("kill switch: absence is on, and turning it off writes canonical off", async () => {
  const { file, remove } = tempFile();
  try {
    const { policy, db } = await openPolicy(file);
    const before = policy.switchStatus(NOW);
    assert.equal(before.switches.mcp.enabled, true);
    assert.equal(before.switches.connector.enabled, true);
    assert.equal(before.switches.ai.enabled, true);
    assert.equal(before.switches.contribute.enabled, true);
    assert.equal(before.switches.mcp.changedAt, null);
    assert.deepEqual(before.pending, []);
    const off = policy.setSwitch("mcp", false, "ada", NOW, false);
    assert.deepEqual(off, { status: "applied" });
    assert.equal(policy.switchStatus(NOW).switches.mcp.enabled, false);
    assert.equal(policy.switchStatus(NOW).switches.ai.enabled, true);
    assert.deepEqual(row(db, "mcp"), { enabled: 0, changed_by: "ada" });
    assert.deepEqual(journal(db, "mcp"), [0]);
    assert.equal(pending(db, "mcp"), undefined);
    db.close();
  } finally {
    remove();
  }
});

test("kill switch: turning on an already-on switch does not write", async () => {
  const { file, remove } = tempFile();
  try {
    const { policy, db } = await openPolicy(file);
    const absent = policy.setSwitch("ai", true, "ada", NOW, true);
    assert.deepEqual(absent, { status: "applied" });
    assert.equal(row(db, "ai"), undefined);
    assert.deepEqual(journal(db, "ai"), []);
    policy.setSwitch("ai", false, "ada", NOW, false);
    policy.setSwitch("ai", true, "bea", NOW, false);
    const again = policy.setSwitch("ai", true, "cy", NOW, true);
    assert.deepEqual(again, { status: "applied" });
    assert.deepEqual(row(db, "ai"), { enabled: 1, changed_by: "bea" });
    db.close();
  } finally {
    remove();
  }
});

test("kill switch: turning off an already-off switch rewrites it and clears a pending ask", async () => {
  const { file, remove } = tempFile();
  try {
    const { policy, db } = await openPolicy(file);
    policy.setSwitch("connector", false, "ada", NOW, false);
    const first = policy.setSwitch("connector", true, "ada", NOW, true);
    assert.equal(first.status, "pending");
    assert.equal(first.sameActor, false);
    assert.equal(pending(db, "connector")?.requested_by, "ada");
    const off = policy.setSwitch("connector", false, "bea", NOW + 5, false);
    assert.deepEqual(off, { status: "applied" });
    assert.equal(policy.switchStatus(NOW + 5).switches.connector.enabled, false);
    assert.equal(pending(db, "connector"), undefined);
    assert.deepEqual(row(db, "connector"), { enabled: 0, changed_by: "bea" });
    db.close();
  } finally {
    remove();
  }
});

test("kill switch: a direct turn-on enables an off switch and leaves a stale ask", async () => {
  const { file, remove } = tempFile();
  try {
    const { policy, db } = await openPolicy(file);
    policy.setSwitch("contribute", false, "ada", NOW, false);
    db.prepare("INSERT INTO pending_ops (key, requested_by, requested_at) VALUES (?, ?, ?)").run(
      "switch:contribute",
      "ada",
      NOW,
    );
    const on = policy.setSwitch("contribute", true, "bea", NOW + 1, false);
    assert.deepEqual(on, { status: "applied" });
    assert.equal(policy.switchStatus(NOW + 1).switches.contribute.enabled, true);
    assert.equal(pending(db, "contribute")?.requested_by, "ada");
    assert.deepEqual(journal(db, "contribute"), [0, 1]);
    db.close();
  } finally {
    remove();
  }
});

test("kill switch: prod re-enable waits for a different person, and an expired ask is a new request", async () => {
  const { file, remove } = tempFile();
  try {
    const { policy, db } = await openPolicy(file);
    policy.setSwitch("mcp", false, "ada", NOW, false);
    const recorded = policy.setSwitch("mcp", true, "ada", NOW, true, "ada@a.example");
    assert.deepEqual(recorded, { status: "pending", sameActor: false });
    assert.equal(policy.switchStatus(NOW).switches.mcp.enabled, false);
    const same = policy.setSwitch("mcp", true, "ada", NOW + 1, true, "ada@a.example");
    assert.deepEqual(same, { status: "pending", sameActor: true });
    assert.equal(row(db, "mcp")?.enabled, 0);
    const confirmed = policy.setSwitch("mcp", true, "bea", NOW + 2, true, "bea@b.example");
    assert.deepEqual(confirmed, { status: "applied" });
    assert.equal(policy.switchStatus(NOW + 2).switches.mcp.enabled, true);
    assert.equal(pending(db, "mcp"), undefined);
    assert.equal(row(db, "mcp")?.changed_by, "bea");

    policy.setSwitch("ai", false, "ada", NOW, false);
    policy.setSwitch("ai", true, "ada", NOW, true);
    const expired = policy.setSwitch("ai", true, "bea", NOW + SECOND_PERSON_TTL_MS, true);
    assert.deepEqual(expired, { status: "pending", sameActor: false });
    assert.equal(policy.switchStatus(NOW + SECOND_PERSON_TTL_MS).switches.ai.enabled, false);
    assert.equal(pending(db, "ai")?.requested_by, "bea");
    assert.deepEqual(policy.switchStatus(NOW + SECOND_PERSON_TTL_MS).pending, [
      { switch: "ai", requestedAt: NOW + SECOND_PERSON_TTL_MS },
    ]);
    db.close();
  } finally {
    remove();
  }
});

test("kill switch: a corrupt enabled value stays off and turn-on is refused", async () => {
  const { file, remove } = tempFile();
  const warn = captureWarn();
  try {
    const { policy, db } = await openPolicy(file);
    db.prepare("INSERT INTO switches (name, enabled, changed_by, changed_at) VALUES (?, ?, ?, ?)").run(
      "ai",
      2,
      "ada",
      NOW,
    );
    const status = policy.switchStatus(NOW);
    assert.equal(status.switches.ai.enabled, false);
    const on = policy.setSwitch("ai", true, "bea", NOW + 1, false);
    assert.deepEqual(on, { status: "refused" });
    assert.equal(row(db, "ai")?.enabled, 2);
    assert.equal(policy.switchStatus(NOW + 1).switches.ai.enabled, false);
    const logged = warn.lines.map((line) => JSON.parse(line) as { at?: string; machine?: string; reason?: string });
    assert.equal(
      logged.some((line) => line.at === "illegal_transition" && line.machine === "kill_switch" && line.reason === "corrupt_value"),
      true,
    );
    assert.equal(warn.lines.some((line) => line.includes("2")), false);
    db.close();
  } finally {
    warn.restore();
    remove();
  }
});

test("kill switch: turning a corrupt value off writes canonical off", async () => {
  const { file, remove } = tempFile();
  const warn = captureWarn();
  try {
    const { policy, db } = await openPolicy(file);
    db.prepare("INSERT INTO switches (name, enabled, changed_by, changed_at) VALUES (?, ?, ?, ?)").run(
      "mcp",
      "yes",
      "ada",
      NOW,
    );
    const off = policy.setSwitch("mcp", false, "bea", NOW + 1, false);
    assert.deepEqual(off, { status: "applied" });
    assert.deepEqual(row(db, "mcp"), { enabled: 0, changed_by: "bea" });
    assert.equal(policy.switchStatus(NOW + 1).switches.mcp.enabled, false);
    const logged = warn.lines.map((line) => JSON.parse(line) as { reason?: string });
    assert.equal(logged.some((line) => line.reason === "corrupt_value"), true);
    assert.equal(warn.lines.some((line) => line.includes("yes")), false);
    db.close();
  } finally {
    warn.restore();
    remove();
  }
});

test("kill switch: an unknown name, a bad clock, and a non-boolean do not write", async () => {
  const { file, remove } = tempFile();
  const warn = captureWarn();
  try {
    const { policy, db } = await openPolicy(file);
    const unknown = policy.setSwitch("not-a-switch", false, "ada", NOW, false);
    assert.deepEqual(unknown, { status: "refused" });
    assert.equal(row(db, "not-a-switch"), undefined);
    const clock = policy.setSwitch("mcp", false, "ada", Number.NaN, false);
    assert.deepEqual(clock, { status: "refused" });
    assert.equal(row(db, "mcp"), undefined);
    const enabled = policy.setSwitch("mcp", "yes" as unknown as boolean, "ada", NOW, false);
    assert.deepEqual(enabled, { status: "refused" });
    assert.equal(row(db, "mcp"), undefined);
    const text = warn.lines.join("\n");
    assert.equal(text.includes("not-a-switch"), false);
    assert.equal(text.includes("yes"), false);
    assert.equal(text.includes("NaN"), false);
    db.close();
  } finally {
    warn.restore();
    remove();
  }
});

test("kill switch: a pending ask whose name is not a switch is omitted", async () => {
  const { file, remove } = tempFile();
  try {
    const { policy, db } = await openPolicy(file);
    db.prepare("INSERT INTO pending_ops (key, requested_by, requested_at) VALUES (?, ?, ?)").run(
      "switch:not-a-switch",
      "ada",
      NOW,
    );
    db.prepare("INSERT INTO pending_ops (key, requested_by, requested_at) VALUES (?, ?, ?)").run(
      "switch:ai",
      "bea",
      NOW,
    );
    const status = policy.switchStatus(NOW);
    assert.deepEqual(status.pending, [{ switch: "ai", requestedAt: NOW }]);
    db.close();
  } finally {
    remove();
  }
});

test("kill switch: replaying a journal on over a corrupt cell writes canonical on and leaves the ask", async () => {
  const { file, remove } = tempFile();
  try {
    const { db } = await openPolicy(file);
    db.prepare(
      "INSERT INTO switches (name, enabled, changed_by, changed_at) VALUES ('ai', 2, 'ada', ?)",
    ).run(NOW);
    db.prepare("INSERT INTO security_journal (at, kind, a, v) VALUES (?, 'switch', 'ai', 1)").run(NOW);
    db.prepare(
      "INSERT INTO pending_ops (key, requested_by, requested_at) VALUES ('switch:ai', 'bea', ?)",
    ).run(NOW);
    replay(db);
    assert.deepEqual(row(db, "ai"), { enabled: 1, changed_by: "journal" });
    assert.equal(pending(db, "ai")?.requested_by, "bea");
    db.close();
  } finally {
    remove();
  }
});

test("kill switch: replaying an off journal entry cancels the pending ask", async () => {
  const { file, remove } = tempFile();
  try {
    const { policy, db } = await openPolicy(file);
    assert.deepEqual(policy.setSwitch("mcp", false, "ada", NOW, false), { status: "applied" });
    db.prepare("UPDATE switches SET enabled = 1, changed_by = 'snapshot' WHERE name = 'mcp'").run();
    db.prepare(
      "INSERT INTO pending_ops (key, requested_by, requested_at) VALUES ('switch:mcp', 'bea', ?)",
    ).run(NOW);
    replay(db);
    assert.deepEqual(row(db, "mcp"), { enabled: 0, changed_by: "journal" });
    assert.equal(pending(db, "mcp"), undefined);
    db.close();
  } finally {
    remove();
  }
});

test("kill switch: a quorum refusal is not a pending ask", async () => {
  const { file, remove } = tempFile();
  try {
    const { policy, db } = await openPolicy(file);
    policy.setSwitch("mcp", false, "ada", NOW, false);
    const again = policy.setSwitch("mcp", true, "", NOW + 1, true);
    assert.deepEqual(again, { status: "refused" });
    assert.equal(row(db, "mcp")?.enabled, 0);
    assert.equal(pending(db, "mcp"), undefined);
    db.close();
  } finally {
    remove();
  }
});

test("kill switch route: replay and refused are 409, and pending is the only 202", () => {
  const text = readFileSync(
    new URL("../../recovered-source/worker/src/ops-admin.ts", import.meta.url),
    "utf8",
  );
  const start = text.indexOf('r.post("/switches"');
  const route = text.slice(start, text.indexOf("rights/export", start));
  assert.equal(route.includes('res.status === "refused" || res.status === "replay"'), true);
  assert.equal(route.includes('needs: "second_person"'), true);
  const refusedAt = route.indexOf('res.status === "refused" || res.status === "replay"');
  const pendingAt = route.indexOf('res.status === "pending"');
  assert.equal(refusedAt >= 0 && pendingAt > refusedAt, true);
});

test("kill switch: a stored unknown name is logged once and is not echoed", async () => {
  const { file, remove } = tempFile();
  const warn = captureWarn();
  try {
    const { policy, db } = await openPolicy(file);
    db.prepare(
      "INSERT INTO switches (name, enabled, changed_by, changed_at) VALUES (?, ?, ?, ?)",
    ).run("not-a-switch", 0, "ada", NOW);
    db.prepare(
      "INSERT INTO switches (name, enabled, changed_by, changed_at) VALUES (?, ?, ?, ?)",
    ).run("also-unknown", 1, "bea", NOW);
    const status = policy.switchStatus(NOW);
    assert.equal(status.switches.mcp.enabled, true);
    assert.equal(status.switches.connector.enabled, true);
    assert.equal(status.switches.ai.enabled, true);
    assert.equal(status.switches.contribute.enabled, true);
    const unknownLines = () =>
      warn.lines
        .map((line) => JSON.parse(line) as { reason?: string; machine?: string })
        .filter((line) => line.reason === "unknown_name");
    const first = unknownLines();
    assert.equal(first.length, 2);
    assert.equal(first.every((line) => line.machine === "kill_switch"), true);
    const text = warn.lines.join("\n");
    assert.equal(text.includes("not-a-switch"), false);
    assert.equal(text.includes("also-unknown"), false);
    const marked = warn.lines.length;
    policy.switchStatus(NOW + 1);
    assert.equal(warn.lines.length, marked);
    assert.equal(unknownLines().length, 2);
    db.close();
  } finally {
    warn.restore();
    remove();
  }
});
