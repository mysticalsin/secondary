import { register } from "node:module";
import { parentPort, workerData } from "node:worker_threads";

register(new URL("./register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const { openSqlite, sqliteStorage } = await import("./sqlite-storage.ts");

const data = workerData as {
  file: string;
  key: string;
  now: number;
  ttl: number;
  barrier: Int32Array;
};

const db = openSqlite(data.file);
const sql = sqliteStorage(db);
const mod = await import("../../recovered-source/worker/src/tenant-policy.ts");
const policy = Object.create(mod.TenantPolicy.prototype) as {
  sql: SqlStorage;
  nonceFirst(key: string, now: number, ttlMs: number): boolean;
};
policy.sql = sql;

const arrived = Atomics.add(data.barrier, 0, 1);
if (arrived === 0) Atomics.wait(data.barrier, 0, 1);
else Atomics.notify(data.barrier, 0);

parentPort?.postMessage(policy.nonceFirst(data.key, data.now, data.ttl));
