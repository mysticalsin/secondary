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
  now: number;
  barrier: Int32Array;
};

const db = openSqlite(data.file);
const sql = sqliteStorage(db);
let armed = true;
const gated = {
  exec(query: string, ...bindings: Parameters<SqlStorage["exec"]> extends [string, ...infer B] ? B : never) {
    const result = sql.exec(query, ...bindings);
    if (armed && query.includes("SELECT * FROM gov_changes WHERE id")) {
      armed = false;
      const arrived = Atomics.add(data.barrier, 0, 1);
      if (arrived === 0) {
        const woke = Atomics.wait(data.barrier, 0, 1, 5_000);
        if (woke === "timed-out") throw new Error("governance barrier timed out");
      } else {
        Atomics.notify(data.barrier, 0);
      }
    }
    return result;
  },
};

const storeMod = await import("../../src/worker/admin/store.ts");
const journalMod = await import("../../src/worker/security-journal.ts");
const store = Object.create(storeMod.GovStore.prototype) as {
  sql: SqlStorage;
  tx: <T>(fn: () => T) => T;
  bump: () => number;
  journal: unknown;
  decide(
    id: string,
    approve: boolean,
    deciderId: string,
    note: string | null,
    now: number,
  ): { ok: true } | { ok: false; code: string; status: number };
};
store.sql = gated as unknown as SqlStorage;
store.tx = (fn) => fn();
store.bump = () => 1;
store.journal = new journalMod.SecurityJournal(gated as unknown as SqlStorage);

const result = store.decide(data.id, true, data.actor, null, data.now);
db.close();
parentPort?.postMessage(result);
