/**
 * Loopback boot of the recovered API. No tunnel, no Cloudflare account, no secret values.
 *
 *   node --experimental-strip-types qa/boot-local.mjs
 *
 * Listens on 127.0.0.1 only. PORT defaults to 8787.
 * The HTML at / is qa/synthetic-shell.html. It is labeled synthetic.
 */

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { register } from "node:module";

register(new URL("../harness/runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const html = readFileSync(new URL("./synthetic-shell.html", import.meta.url), "utf8");
const css = readFileSync(new URL("./synthetic-shell.css", import.meta.url), "utf8");
const { createApp } = await import("../recovered-source/worker/src/index.ts");

const app = createApp();
const env = {
  ENVIRONMENT: "dev",
  DEFAULT_TENANT_ID: "synthetic",
  AUTH_MODE: "access",
  ASSETS: {
    fetch: async (request) => {
      const path = new URL(request.url).pathname;
      if (path === "/synthetic-shell.css") {
        return new Response(css, { headers: { "content-type": "text/css; charset=utf-8" } });
      }
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    },
  },
};

const port = Number(process.env.PORT ?? 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("PORT must be an integer from 1 to 65535");
  process.exit(1);
}

const server = createServer(async (req, res) => {
  try {
    const chunks = [];
    if (req.method !== "GET" && req.method !== "HEAD") {
      for await (const chunk of req) chunks.push(chunk);
    }
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const request = new Request(`http://127.0.0.1:${port}${req.url ?? "/"}`, {
      method: req.method,
      headers: req.headers,
      body,
    });
    const response = await app.fetch(request, env);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    const name = err instanceof Error ? err.name : "Error";
    console.error(JSON.stringify({ at: "local_boot", name }));
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "internal_error" }));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`synthetic local boot http://127.0.0.1:${port}`);
});
