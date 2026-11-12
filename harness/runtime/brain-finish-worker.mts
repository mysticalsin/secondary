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
  key: string;
  changeId: string;
  previousState: string;
  barrier: Int32Array;
};

const db = openSqlite(data.file);
const sql = sqliteStorage(db);
let armed = true;
const gated = {
  exec(query: string, ...bindings: Parameters<SqlStorage["exec"]> extends [string, ...infer B] ? B : never) {
    const result = sql.exec(query, ...bindings);
    if (armed && query.includes("SELECT role, state, change_id, claim_key, added_by FROM brain_members WHERE principal_id")) {
      armed = false;
      const arrived = Atomics.add(data.barrier, 0, 1);
      if (arrived === 0) {
        const woke = Atomics.wait(data.barrier, 0, 1, 5_000);
        if (woke === "timed-out") throw new Error("brain finish barrier timed out");
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
  brainMemberFinishProposal(
    principalId: string,
    role: "owner",
    state: "active",
    actor: string,
    now: number,
    changeId: string,
    at: number | null,
    key: string,
    previousState?: string,
  ): { ok: true; state: string } | { ok: false; code: string };
};
store.sql = gated as unknown as SqlStorage;
const result = store.brainMemberFinishProposal(
  data.id,
  data.role,
  "active",
  data.actor,
  data.now,
  data.changeId,
  data.now,
  data.key,
  data.previousState,
);
db.close();
parentPort?.postMessage(result);
