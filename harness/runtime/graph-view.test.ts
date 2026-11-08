import assert from "node:assert/strict";
import { test } from "node:test";
import { startPreview } from "../../reconstruction/graph/dev/serve.mjs";

test("the graph wrapper serves /graph, links it from app pages, and passes everything else through", async () => {
  const { mf, url } = await startPreview(0);
  try {
    const page = await fetch(`${url}/graph`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type") ?? "", /text\/html/);
    assert.match(page.headers.get("content-security-policy") ?? "", /script-src 'self'/);
    const html = await page.text();
    assert.equal(html.includes("<script>"), false);
    assert.equal(html.includes("style=\""), false);
    assert.match(html, /src="\/graph\/app\.js"/);

    const dash = await fetch(`${url}/dashboard`);
    assert.equal(dash.status, 200);
    const dashHtml = await dash.text();
    assert.match(dashHtml, /src="\/graph\/dashboard\.js"/);
    assert.equal(dashHtml.includes("<script>"), false);
    assert.equal(dashHtml.includes("style=\""), false);
    assert.equal((await fetch(`${url}/graph/dashboard.js`)).status, 200);

    const app = await fetch(`${url}/brains/me`, { headers: { Accept: "text/html", "If-None-Match": "\"stale\"" } });
    const appHtml = await app.text();
    assert.match(appHtml, /<script src="\/graph\/nav\.js" defer><\/script><\/head>/);
    assert.equal(app.headers.get("etag"), null);

    const tree = await fetch(`${url}/v1/brain/tree`);
    assert.equal(tree.status, 200);
    assert.match(tree.headers.get("content-type") ?? "", /application\/json/);
    const body = await tree.json() as { roots: unknown[] };
    assert.equal(Array.isArray(body.roots), true);

    const post = await fetch(`${url}/graph`, { method: "POST" });
    assert.equal(post.status, 405);
    const missing = await fetch(`${url}/v1/nope`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.text()).includes("nav.js"), false);
  } finally {
    await mf.dispose();
  }
});
