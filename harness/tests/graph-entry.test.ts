import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { GRAPH_HEADERS, GRAPH_NAV, graphFetch } from "../../deploy/graph-route.ts";

function rewrite(response: Response): Response {
  return new Response(`<html><head><title>App</title>${GRAPH_NAV}</head><body>ok</body></html>`, {
    status: response.status,
    headers: response.headers,
  });
}

const root = fileURLToPath(new URL("../..", import.meta.url));

const FILES: { path: string; repo: string; type: string; sha256: string }[] = [
  [" /graph", "deploy/graph/page.html", "text/html; charset=utf-8", "ffbcde433c267925a6d50071ab7901a25440d5ee0e9e8a7f5d80a82188002cb4"],
  ["/graph/app.js", "deploy/graph/app.js.txt", "text/javascript; charset=utf-8", "e20efcec6cd2dcef0a50914c01dfdaea2e8948229e0c302b9cb47e401873536e"],
  ["/graph/app.css", "deploy/graph/app.css", "text/css; charset=utf-8", "be7948006e02b46d5c73bc28be5c67985b0572d04dfbe6121d1c419953cc6e80"],
  ["/graph/nav.js", "deploy/graph/nav.js.txt", "text/javascript; charset=utf-8", "ae5dc4a2b01105c7f0cad18246d140423b6eb366defc133127c4f82a0aacfb4a"],
  ["/graph/nav.css", "deploy/graph/nav.css", "text/css; charset=utf-8", "581e4d30582f5b1415b694a165e155b1b9b1ec54e5050484be3a51dac3c404af"],
  ["/dashboard", "deploy/graph/dashboard.html", "text/html; charset=utf-8", "5557550ebbffbff93e3fee45501d98df05d799131563eeaac4abc48f2dab2d9b"],
  ["/graph/dashboard.js", "deploy/graph/dashboard.js.txt", "text/javascript; charset=utf-8", "e975d57261b3995376419cc87ff1f527bbe4f540018930902ac1a9bb6da0b8d1"],
  ["/graph/dashboard.css", "deploy/graph/dashboard.css", "text/css; charset=utf-8", "db2058e727fe4155ab4711c8ab740284e3fbe52db7dd445c4e72626495afa1bb"],
].map(([path, repo, type, sha256]) => ({ path: path.trim(), type, repo, sha256 }));

function fileMap(): Record<string, readonly [string, string]> {
  const out: Record<string, readonly [string, string]> = {};
  for (const file of FILES) {
    const body = readFileSync(fileURLToPath(new URL(`../../${file.repo}`, import.meta.url)), "utf8");
    assert.equal(createHash("sha256").update(body).digest("hex"), file.sha256);
    out[file.path] = [body, file.type];
  }
  return out;
}

function request(path: string, method = "GET", headers: Record<string, string> = {}): Request {
  return new Request(`https://worker.test${path}`, { method, headers });
}

test("graph files match the v24 bytes and headers", async () => {
  const files = fileMap();
  assert.equal(
    GRAPH_NAV,
    '<link rel="stylesheet" href="/graph/nav.css"><script src="/graph/nav.js" defer></script>',
  );
  let innerCalls = 0;
  const inner = (): Response => {
    innerCalls += 1;
    return new Response("no", { status: 500 });
  };
  for (const file of FILES) {
    const response = await graphFetch(request(file.path), files, inner, rewrite);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), file.type);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Frame-Options"), "DENY");
    assert.match(response.headers.get("Content-Security-Policy") ?? "", /default-src 'self'/);
    assert.equal(await response.text(), files[file.path][0]);
    const head = await graphFetch(request(file.path, "HEAD"), files, inner, rewrite);
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
  }
  const slash = await graphFetch(request("/graph/"), files, inner, rewrite);
  assert.equal(await slash.text(), files["/graph"][0]);
  assert.equal(innerCalls, 0);
  assert.equal(GRAPH_HEADERS["Cache-Control"], "no-store");
});

test("graph wrapper delegates and rewrites only the app HTML", async () => {
  const files = fileMap();
  const seen: { path: string; noneMatch: string | null }[] = [];
  const inner = (input: Request): Response => {
    const url = new URL(input.url);
    seen.push({ path: url.pathname, noneMatch: input.headers.get("If-None-Match") });
    if (url.pathname === "/plain") return new Response("text", { status: 200, headers: { "Content-Type": "text/plain" } });
    if (url.pathname === "/missing") return new Response("<html></html>", { status: 404, headers: { "Content-Type": "text/html" } });
    return new Response("<html><head><title>App</title></head><body>ok</body></html>", {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", ETag: "abc", "Last-Modified": "yesterday" },
    });
  };
  const posted = await graphFetch(request("/graph", "POST"), files, inner, rewrite);
  assert.equal(await posted.text(), "<html><head><title>App</title></head><body>ok</body></html>");
  const page = await graphFetch(
    request("/", "GET", { Accept: "text/html", "If-None-Match": "old", "If-Modified-Since": "old" }),
    files,
    inner,
    rewrite,
  );
  const html = await page.text();
  assert.match(html, /\/graph\/nav\.js/);
  assert.equal(page.headers.get("ETag"), null);
  assert.equal(page.headers.get("Last-Modified"), null);
  assert.equal(page.headers.get("Cache-Control"), "no-cache");
  assert.equal(seen[1].noneMatch, null);
  const api = await graphFetch(request("/v1/items", "GET", { Accept: "text/html" }), files, inner, rewrite);
  assert.equal(api.headers.get("ETag"), "abc");
  const auth = await graphFetch(request("/auth/start", "GET", { Accept: "text/html" }), files, inner, rewrite);
  assert.equal(auth.headers.get("ETag"), "abc");
  const scim = await graphFetch(request("/scim/v2/Users", "GET", { Accept: "text/html" }), files, inner, rewrite);
  assert.equal(scim.headers.get("ETag"), "abc");
  const internal = await graphFetch(request("/internal/connector", "GET", { Accept: "text/html" }), files, inner, rewrite);
  assert.equal(internal.headers.get("ETag"), "abc");
  const nested = await graphFetch(request("/graph/missing", "GET", { Accept: "text/html" }), files, inner, rewrite);
  assert.equal(nested.headers.get("ETag"), "abc");
  const plain = await graphFetch(request("/plain", "GET", { Accept: "text/html" }), files, inner, rewrite);
  assert.equal(await plain.text(), "text");
  const missing = await graphFetch(request("/missing", "GET", { Accept: "text/html" }), files, inner, rewrite);
  assert.equal(missing.status, 404);
});

test("graph entry re-exports the worker module", () => {
  const source = readFileSync(join(root, "deploy/graph-entry.ts"), "utf8");
  const route = readFileSync(join(root, "deploy/graph-route.ts"), "utf8");
  assert.match(source, /import app from "\.\.\/recovered-source\/worker\/src\/index\.ts"/);
  assert.match(source, /export \* from "\.\.\/recovered-source\/worker\/src\/index\.ts"/);
  assert.equal(source.includes("class TenantPolicy"), false);
  assert.equal(source.includes("class Workspace"), false);
  assert.match(route, /new HTMLRewriter\(\)/);
  assert.match(route, /el\.append\(GRAPH_NAV, \{ html: true \}\)/);
});
