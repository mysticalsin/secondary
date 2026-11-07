/**
 * Optional loopback server for the generated page in this workspace.
 * The copyable page is the built index.html. This server is not required to open it.
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const file = new URL("./offline/index.html", import.meta.url);
const server = createServer((request, response) => {
  const path = new URL(request.url, "http://127.0.0.1").pathname;
  if (path !== "/" && path !== "/index.html") {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    response.end("not found\n");
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" });
  response.end(readFileSync(file));
});
const port = Number(process.env.ACTIVITY_PORT || 43157);
server.listen(port, "127.0.0.1", () => {
  console.log(`http://127.0.0.1:${port}/`);
});
