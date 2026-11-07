/**
 * Local capture fixture. It reads preserved bytes and does not call the live app.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { stopRecoveredApi } from "../../reconstruction/fixture/recovered-api.mjs";
import { fixtureResponse, listen } from "../../reconstruction/fixture/serve.mjs";

const sha = (body) => createHash("sha256").update(body).digest("hex");

test("the fixture serves the recovered shell and blocks fonts, logos, and unknown API paths", async () => {
  const shell = fixtureResponse(new URL("http://127.0.0.1/"));
  assert.equal(shell.status, 200);
  assert.equal(sha(shell.body), "96f1c636da2147743212cbef111a779146664e581ec4d03ba5a038e9f16124ea");
  const js = fixtureResponse(new URL("http://127.0.0.1/assets/index-PLmoiPYI.js"));
  assert.equal(js.status, 200);
  assert.equal(sha(js.body), "0acf56bc36d5dbfed072cc12ceb38abb9750bab36203f9f38bf5243315df33bd");
  const css = fixtureResponse(new URL("http://127.0.0.1/assets/index-DiBYRwP4.css"));
  assert.equal(css.status, 200);
  const font = fixtureResponse(new URL("http://127.0.0.1/assets/carlito-latin-400-normal-R-CeALMm.woff2"));
  assert.equal(font.status, 404);
  assert.equal(String(font.body).includes("not fetched"), true);
  const logo = fixtureResponse(new URL("http://127.0.0.1/brand/logo_main.png"));
  assert.equal(logo.status, 404);
  assert.equal(String(logo.body).includes("not fetched"), true);
  const gap = fixtureResponse(new URL("http://127.0.0.1/v1/me"));
  assert.equal(gap.status, 404);
  assert.equal(String(gap.body).includes("not in the captured fixture"), true);
});

test("the fixture listens only on loopback and returns the shell", async () => {
  const { server, port } = await listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-secondary-fixture"), "reconstruction");
    const text = await res.text();
    assert.equal(text.includes("Secondary | Company Brain"), true);
    assert.equal(text.includes("/assets/index-PLmoiPYI.js"), true);
    assert.equal(text.includes("/settings/observability"), true);
    assert.equal(text.includes("/reconstruction/import"), true);
    assert.equal(text.includes("data-reconstruction"), true);
    const imported = await fetch(`http://127.0.0.1:${port}/reconstruction/import`);
    assert.equal(imported.status, 200);
    const importText = await imported.text();
    assert.equal(importText.includes("7000"), true);
    assert.equal(importText.includes("unknown"), true);
    assert.equal(importText.includes(".txt"), true);
    const settings = await fetch(`http://127.0.0.1:${port}/settings/profile`);
    assert.equal(settings.status, 200);
    assert.equal((await settings.text()).includes("Secondary | Company Brain"), true);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    await stopRecoveredApi();
  }
});
