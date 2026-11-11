import { register } from "node:module";
import { parentPort, workerData } from "node:worker_threads";

register(new URL("./register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const { openSqlite, sqliteStorage } = await import("./sqlite-storage.ts");

const data = workerData as {
  file: string;
  key: string;
  actor: string;
  now: number;
  email: string;
  barrier: Int32Array;
};

const db = openSqlite(data.file);
const sql = sqliteStorage(db);
const gated = {
  exec(query: string, ...bindings: Parameters<SqlStorage["exec"]> extends [string, ...infer B] ? B : never) {
    const result = sql.exec(query, ...bindings);
    const sawPending =
      query.includes("SELECT requested_by") && result.toArray().length > 0;
    if (sawPending) {
      const arrived = Atomics.add(data.barrier, 0, 1);
      if (arrived === 0) {
        const woke = Atomics.wait(data.barrier, 0, 1, 5_000);
        if (woke === "timed-out") throw new Error("quorum barrier timed out");
      } else {
        Atomics.notify(data.barrier, 0);
      }
    }
    return result;
  },
};
const mod = await import("../../recovered-source/worker/src/tenant-policy.ts");
const policy = Object.create(mod.TenantPolicy.prototype) as {
  sql: SqlStorage;
  requestSecond(key: string, actor: string, now: number, email?: string): string | { tag: string };
};
policy.sql = gated as unknown as SqlStorage;

parentPort?.postMessage(policy.requestSecond(data.key, data.actor, data.now, data.email));
