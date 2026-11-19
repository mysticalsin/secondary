import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { collectSwitchTable, type SwitchRow } from "./switch-table-matrix.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

function at(rows: SwitchRow[], method: string, path: string, state: string, internal: boolean) {
  const row = rows.find(
    (item) =>
      item.method === method && item.path === path && item.state === state && item.internal === internal,
  );
  assert.ok(row, `${method} ${path} ${state} ${internal}`);
  return row;
}

test("kill-switch answers stay pinned to main e8e7ef63", async () => {
  const rows = await collectSwitchTable();
  assert.deepEqual(at(rows, "GET", "/v1/sources/s1", "connector-off", false), {
    method: "GET",
    path: "/v1/sources/s1",
    internal: false,
    state: "connector-off",
    status: 503,
    body: { error: "switched_off", switch: "connector" },
  });
  assert.deepEqual(at(rows, "GET", "/v1/%73ources/s1", "connector-off", false), {
    method: "GET",
    path: "/v1/%73ources/s1",
    internal: false,
    state: "connector-off",
    status: 503,
    body: { error: "switched_off", switch: "connector" },
  });
  assert.deepEqual(at(rows, "POST", "/v1/personal/items/pi:abcd1234/contribute", "contribute-off", false), {
    method: "POST",
    path: "/v1/personal/items/pi:abcd1234/contribute",
    internal: false,
    state: "contribute-off",
    status: 503,
    body: { error: "switched_off", switch: "contribute" },
  });
  assert.deepEqual(at(rows, "GET", "/v1/map", "all-off", false), {
    method: "GET",
    path: "/v1/map",
    internal: false,
    state: "all-off",
    status: 200,
    body: { ok: true },
  });
});
