// Local preview: the real graph wrapper on workerd, in front of a SYNTHETIC app module.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { wrapperSource } from "../build.mjs";

const here = dirname(fileURLToPath(import.meta.url));

export async function startPreview(port = 4317) {
  const mf = new Miniflare({
    host: "127.0.0.1",
    port,
    workers: [
      {
        config: {
          name: "graph-preview",
          compatibilityDate: "2026-10-01",
          compatibilityFlags: ["nodejs_compat"],
          workersDev: false,
          previewUrls: false,
          manifest: {
            mainModule: "graph-entry.js",
            modules: {
              "graph-entry.js": { type: "esm", contents: wrapperSource() },
              "index.js": { type: "esm", contents: readFileSync(join(here, "fake-app.js"), "utf8") },
            },
          },
        },
        dev: {
          outboundService: { type: "fetcher", handler: () => new Response("egress_denied", { status: 403 }) },
        },
      },
    ],
  });
  const url = await mf.ready;
  return { mf, url: url.href.replace(/\/$/, "") };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] ?? 4317);
  const { url } = await startPreview(port);
  console.log(`Graph preview on ${url}/graph (synthetic data)`);
}
