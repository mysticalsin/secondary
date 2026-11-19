import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { normalEmail } from "../../src/state/actor.ts";
import { openSqlite, sqliteStorage } from "../runtime/sqlite-storage.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const NOW = 1_700_000_000_000;
const policySpecifier = "../../src/worker/tenant-policy.ts";

type Policy = {
  pilotSave(
    cohort: { id: string; name: string; members: string[]; flags: Record<string, boolean> },
    create: boolean,
    now: number,
  ): "ok" | "not_found" | "too_many";
  flagsFor(email: string): { imports: boolean };
};

function tempFile(): { file: string; remove: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "pilot-email-"));
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

test("pilot cohort: a kelvin member does not turn the flag on for the ASCII address", async () => {
  const { file, remove } = tempFile();
  try {
    const { policy, db } = await openPolicy(file);
    const kelvin = "\u212A@pilot.example";
    assert.equal(normalEmail(kelvin), kelvin);
    assert.equal(
      policy.pilotSave(
        { id: "c1", name: "Synthetic", members: [kelvin], flags: { imports: true } },
        true,
        NOW,
      ),
      "ok",
    );
    assert.equal(policy.flagsFor(kelvin).imports, true);
    assert.equal(policy.flagsFor("k@pilot.example").imports, false);
    db.close();
  } finally {
    remove();
  }
});
