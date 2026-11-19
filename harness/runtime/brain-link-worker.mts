import { register } from "node:module";
import { parentPort, workerData } from "node:worker_threads";

register(new URL("./register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const { openSqlite, sqliteStorage } = await import("./sqlite-storage.ts");

const data = workerData as {
  file: string;
  id: string;
  actor: string;
  role: "owner";
  now: number;
  proposal: {
    kind: "member_add";
    payload: Record<string, unknown>;
    scopeKey: string;
    scope: {
      type: "department";
      id: string;
      dept: null;
      label: string;
      restricted: boolean;
      nda: boolean;
      subspace: null;
    };
    needsSecond: boolean;
    proposedBy: string;
    label: string;
  };
  barrier: Int32Array;
};

const db = openSqlite(data.file);
const sql = sqliteStorage(db);
let armed = true;
const gated = {
  exec(query: string, ...bindings: Parameters<SqlStorage["exec"]> extends [string, ...infer B] ? B : never) {
    const result = sql.exec(query, ...bindings);
    if (armed && query.includes("SELECT role, state, at, claim_key FROM brain_members WHERE principal_id")) {
      armed = false;
      const arrived = Atomics.add(data.barrier, 0, 1);
      if (arrived === 0) {
        const woke = Atomics.wait(data.barrier, 0, 1, 5_000);
        if (woke === "timed-out") throw new Error("brain link barrier timed out");
      } else {
        Atomics.notify(data.barrier, 0);
      }
    }
    return result;
  },
};

const storeMod = await import("../../src/worker/brains/store.ts");
const govMod = await import("../../src/worker/admin/store.ts");
const journalMod = await import("../../src/worker/security-journal.ts");
const gov = Object.create(govMod.GovStore.prototype) as {
  sql: SqlStorage;
  tx: <T>(fn: () => T) => T;
  bump: () => number;
  journal: unknown;
  propose(a: typeof data.proposal, now: number): unknown;
};
gov.sql = gated as unknown as SqlStorage;
gov.tx = (fn) => fn();
gov.bump = () => 1;
gov.journal = new journalMod.SecurityJournal(gated as unknown as SqlStorage);
const brain = Object.create(storeMod.BrainBase.prototype) as {
  sql: SqlStorage;
  brainMemberSet(
    principalId: string,
    role: string,
    state: "active" | "pending",
    actor: string,
    now: number,
  ): { ok: true; state: "active" | "pending" } | { ok: false; code: string };
};
brain.sql = gated as unknown as SqlStorage;

const result = await storeMod.placeScopedMember(
  gov,
  brain,
  data.proposal,
  data.id,
  data.role,
  data.actor,
  data.now,
);
db.close();
parentPort?.postMessage(result);
