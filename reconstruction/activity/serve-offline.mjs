/**
 * Loopback page for a local NDJSON import. It serves only this folder.
 * It has no credentials and no review records.
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const root = new URL("./offline/", import.meta.url);
const files = {
  "/": "index.html",
  "/index.html": "index.html",
  "/validate.mjs": "../validate.mjs",
  "/schema.json": "../relay.codex-review-run-1.schema.json",
};
const types = { ".html": "text/html; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json" };
const server = createServer((request, response) => {
  const name = files[new URL(request.url, "http://127.0.0.1").pathname];
  if (!name) {
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found\n");
    return;
  }
  const body = readFileSync(new URL(name, root));
  response.writeHead(200, { "content-type": types[extname(name)] ?? types[".html"], "cache-control": "no-store" });
  response.end(body);
});
const port = Number(process.env.ACTIVITY_PORT || 43157);
server.listen(port, "127.0.0.1", () => {
  console.log(`http://127.0.0.1:${port}/`);
});
