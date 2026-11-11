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
  role: string;
  now: number;
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
        if (woke === "timed-out") throw new Error("brain member barrier timed out");
      } else {
        Atomics.notify(data.barrier, 0);
      }
    }
    return result;
  },
};

const mod = await import("../../recovered-source/worker/src/brains/store.ts");
const store = Object.create(mod.BrainBase.prototype) as {
  sql: SqlStorage;
  brainMemberSet(
    principalId: string,
    role: string,
    state: "active" | "pending",
    actor: string,
    now: number,
  ): { ok: true; state: string } | { ok: false; code: string } | void;
};
store.sql = gated as unknown as SqlStorage;

const result = store.brainMemberSet(data.id, data.role, "active", data.actor, data.now);
db.close();
parentPort?.postMessage(result ?? { ok: false, code: "void" });
