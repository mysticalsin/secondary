import { register } from "node:module";
import { parentPort, workerData } from "node:worker_threads";

register(new URL("./register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const { openSqlite, sqliteStorage } = await import("./sqlite-storage.ts");

const data = workerData as {
  file: string;
  id: string;
  now: number;
  markdown: string;
  barrier: Int32Array;
};

const db = openSqlite(data.file);
const sql = sqliteStorage(db);
let armed = true;
const gated = {
  exec(query: string, ...bindings: Parameters<SqlStorage["exec"]> extends [string, ...infer B] ? B : never) {
    const result = sql.exec(query, ...bindings);
    if (armed && query.includes("SELECT * FROM wiki_pages WHERE id")) {
      armed = false;
      Atomics.store(data.barrier, 0, 1);
      Atomics.notify(data.barrier, 0);
      const woke = Atomics.wait(data.barrier, 0, 1, 5_000);
      if (woke === "timed-out") throw new Error("page save barrier timed out");
    }
    return result;
  },
};

const mod = await import("../../recovered-source/worker/src/wiki/store.ts");
const wiki = Object.create(mod.WikiBase.prototype) as {
  sql: SqlStorage;
  savePage(
    page: { id: string; type: string; title: string; markdown: string },
    actor: string | null,
    proposalId: string | null,
    now: number,
  ): { ok: true; wrote: boolean } | { ok: false; code: string } | boolean;
};
wiki.sql = gated as unknown as SqlStorage;
const saved = wiki.savePage(
  { id: data.id, type: "topic", title: "Home", markdown: data.markdown },
  "ada",
  "prop_1",
  data.now,
);
parentPort?.postMessage(saved);
db.close();
