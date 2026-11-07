/**
 * NEW RECONSTRUCTION. Local recovered API only.
 * compatibility_date 2026-11-07 is the reconstruction date.
 * dev.outboundService fails closed. No live account or Graph calls.
 */
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";
import { signInternalRequest } from "../../recovered-source/worker/src/internal-auth.ts";

export const FIXTURE_HMAC = "synthetic-fixture-hmac-key-32chars";
export const FIXTURE_EMAIL = "consultant@example.invalid";

export function fixtureEmail(persona) {
  if (!persona) return FIXTURE_EMAIL;
  const domain = FIXTURE_EMAIL.split("@")[1];
  return `consultant+${persona}@${domain}`;
}

const EDGE = `export default { async fetch(request, env) {
  const headers = new Headers(request.headers);
  headers.delete("cf-connecting-ip");
  const url = new URL(request.url);
  url.hostname = "api.internal";
  return env.API.fetch(new Request(url, { method: request.method, headers, body: request.body }));
} };`;

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
      DEV_AUTH_BYPASS_EMAIL: text(FIXTURE_EMAIL),
      INTERNAL_HMAC_KEY: text(FIXTURE_HMAC),
      DEFAULT_TENANT_ID: text("tenant_reconstruction"),
      TENANT_DOMAINS: text('{"example.invalid":"tenant_reconstruction"}'),
      RATE_LIMIT_PER_MIN: text("60"),
      TENANT_POLICY: { type: "durable-object", worker: "api", exportName: "TenantPolicy" },
      WORKSPACE: { type: "durable-object", worker: "api", exportName: "Workspace" },
      USAGE_LEDGER: { type: "durable-object", worker: "api", exportName: "UsageLedger" },
      BLOBS: { type: "r2" },
    },
    exports: {
      TenantPolicy: { type: "durable-object", storage: "sqlite" },
      Workspace: { type: "durable-object", storage: "sqlite" },
      UsageLedger: { type: "durable-object", storage: "sqlite" },
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
  const edge = {
    name: "fixture-edge",
    compatibilityDate: DATE,
    workersDev: false,
    previewUrls: false,
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: EDGE } } },
    env: { API: { type: "worker", worker: "api" } },
    triggers: [{ type: "fetch", pattern: "fixture-edge.local/*" }],
  };
  const mf = new Miniflare({
    workers: [
      { config: deny, dev: { outboundService: fetcher } },
      { config: api, dev: { outboundService: outbound } },
      { config: probe, dev: { outboundService: outbound } },
      { config: edge, dev: { outboundService: outbound } },
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

export async function callImport(path, { method = "GET", body, email, persona } = {}) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const headers = await signInternalRequest({
    secret: FIXTURE_HMAC,
    method,
    url: `https://api.internal${path}`,
    ...(payload === undefined ? {} : { body: payload }),
    principal: {
      v: 1,
      iss: "secondary-mcp",
      aud: "secondary-api",
      sub: `fixture-${email}`,
      email,
      ...(persona ? { persona } : {}),
      client_id: "reconstruction-ui",
      scope: method === "GET" ? ["secondary.read"] : ["secondary.read", "secondary.personal.write"],
      tool: "personal_import",
      grant_id: `g_fixture_${persona || "consultant"}`,
      host: "other",
    },
  });
  const res = await (await runtime()).dispatchFetch(`http://fixture-edge.local${path}`, {
    method,
    headers: {
      ...headers,
      accept: "application/json",
      ...(payload === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(payload === undefined ? {} : { body: payload }),
  });
  return { status: res.status, text: await res.text() };
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
