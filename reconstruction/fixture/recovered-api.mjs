/**
 * NEW RECONSTRUCTION. Local recovered API only.
 * compatibility_date 2026-11-07 is the reconstruction date.
 * dev.outboundService fails closed. No live account or Graph calls.
 */
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const DATE = "2026-11-07";
const DENY = `export default { fetch() { return new Response("egress_denied", { status: 403 }); } };`;
const PROBE = `export default { async fetch() {
  const res = await fetch("https://example.invalid/synthetic-egress-probe");
  return new Response(await res.text(), { status: res.status });
} };`;

let starting;

function text(value) {
  return { type: "text", value };
}

export function startRecoveredApi() {
  if (!starting) starting = boot();
  return starting;
}

async function boot() {
  const script = readFileSync(`${root}/reconstruction/dist/api-harness.js`, "utf8");
  const api = {
    name: "api",
    compatibilityDate: DATE,
    workersDev: false,
    previewUrls: false,
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: script } } },
    env: {
      ENVIRONMENT: text("dev"),
      DO_JURISDICTION: text("off"),
      DEV_AUTH_BYPASS_EMAIL: text("synthetic.person.a@example.invalid"),
      DEFAULT_TENANT_ID: text("tenant_reconstruction"),
      TENANT_DOMAINS: text('{"example.invalid":"tenant_reconstruction"}'),
      RATE_LIMIT_PER_MIN: text("60"),
      TENANT_POLICY: { type: "durable-object", worker: "api", exportName: "TenantPolicy" },
      WORKSPACE: { type: "durable-object", worker: "api", exportName: "Workspace" },
      BLOBS: { type: "r2" },
    },
    exports: {
      TenantPolicy: { type: "durable-object", storage: "sqlite" },
      Workspace: { type: "durable-object", storage: "sqlite" },
    },
    triggers: [{ type: "fetch", pattern: "127.0.0.1/*" }],
  };
  const deny = {
    name: "deny-egress",
    compatibilityDate: DATE,
    workersDev: false,
    previewUrls: false,
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: DENY } } },
  };
  const probe = {
    name: "egress-probe",
    compatibilityDate: DATE,
    workersDev: false,
    previewUrls: false,
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: PROBE } } },
    triggers: [{ type: "fetch", pattern: "egress-probe.local/*" }],
  };
  const outbound = { type: "worker", worker: "deny-egress" };
  const fetcher = { type: "fetcher", handler: () => new Response("egress_denied", { status: 403 }) };
  const mf = new Miniflare({
    workers: [
      { config: deny, dev: { outboundService: fetcher } },
      { config: api, dev: { outboundService: outbound } },
      { config: probe, dev: { outboundService: outbound } },
    ],
  });
  await mf.ready;
  return mf;
}

async function runtime() {
  return startRecoveredApi();
}

export async function callApi(path, { method = "GET", body, persona } = {}) {
  const headers = { accept: "application/json" };
  if (persona === "consultant" || persona === "ceo") headers["x-demo-persona"] = persona;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await (await runtime()).dispatchFetch(`http://127.0.0.1${path}`, { method, headers, body });
  return {
    status: res.status,
    text: await res.text(),
    type: res.headers.get("content-type") ?? "application/json; charset=utf-8",
  };
}

export async function probeEgress() {
  const res = await (await runtime()).dispatchFetch("http://egress-probe.local/");
  return { status: res.status, text: await res.text() };
}

export async function stopRecoveredApi() {
  if (!starting) return;
  const mf = await starting;
  starting = undefined;
  await mf.dispose();
}
