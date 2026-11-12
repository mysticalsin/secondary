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
const gated = {
  exec(query: string, ...bindings: Parameters<SqlStorage["exec"]> extends [string, ...infer B] ? B : never) {
    const result = sql.exec(query, ...bindings);
    if (query.includes("SELECT actor_id FROM approvals")) {
      const arrived = Atomics.add(data.barrier, 0, 1);
      if (arrived === 0) {
        const woke = Atomics.wait(data.barrier, 0, 1, 5_000);
        if (woke === "timed-out") throw new Error("release barrier timed out");
      } else {
        Atomics.notify(data.barrier, 0);
      }
    }
    return result;
  },
};
const mod = await import("../../recovered-source/worker/src/workspace.ts");
const ws = Object.create(mod.Workspace.prototype) as {
  sql: SqlStorage;
  ctx: { storage: { transactionSync<T>(fn: () => T): T } };
  approve(
    id: string,
    expected: number,
    actorId: string,
    now: number,
    sameHuman?: string[],
  ): { ok: true; released: boolean } | { ok: false; code: string };
};
ws.sql = gated as unknown as SqlStorage;
ws.ctx = { storage: { transactionSync: (fn) => fn() } };

const result = ws.approve(data.id, 1, data.actor, data.now, [data.actor]);
db.close();
parentPort?.postMessage(result);
