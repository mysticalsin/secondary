/**
 * NEW RECONSTRUCTION. Two OAuth users import, read, and search through MCP.
 * The tools call the same /harness/import gate as the local preview.
 * Recovered personal_note_create is adapted onto that receipt. No org search.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { sha256Hex } from "../import/policy.mjs";
import { signInternalRequest } from "../../recovered-source/worker/src/internal-auth.ts";
import { bundleWorkerd } from "./bundle-workerd.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const DATE = "2026-11-07";
const ORIGIN = "http://localhost";
const RESOURCE = `${ORIGIN}/mcp`;
const REDIRECT = `${ORIGIN}/callback`;
const HMAC = "synthetic-mcp-import-hmac-key-32";
const AUDIT_MCP = "synthetic-audit-mcp-key-32chars!!";
const ADA = "ada@tenant-a.test";
const BOB = "bob@tenant-b.test";
const CARA = "cara@tenant-a.test";
const PERSIST = mkdtempSync(join(tmpdir(), "secondary-mcp-import-"));
const WRITE = ["secondary.read", "secondary.personal.write"];

const b64url = (bytes) => Buffer.from(bytes).toString("base64url");
const text = (value) => ({ type: "text", value });
const guarded = (config) => ({ config, dev: { outboundService: { type: "worker", worker: "deny-egress" } } });
const moduleOf = (contents) => ({ mainModule: "index.js", modules: { "index.js": { type: "esm", contents } } });

let built;
let mf;

async function boot() {
  if (!built) built = bundleWorkerd();
  const deny = `export default { fetch() { return new Response("egress_denied", { status: 403 }); } };`;
  const edge = `export default { async fetch(request, env) {
    const headers = new Headers(request.headers);
    headers.delete("cf-connecting-ip");
    const url = new URL(request.url);
    url.hostname = "api.internal";
    return env.API.fetch(new Request(url, { method: request.method, headers, body: request.body }));
  } };`;
  mf = new Miniflare({
    resourcePersistencePath: PERSIST,
    workers: [
      guarded({
        name: "deny-egress",
        compatibilityDate: DATE,
        workersDev: false,
        previewUrls: false,
        manifest: moduleOf(deny),
      }),
      guarded({
        name: "audit",
        compatibilityDate: DATE,
        workersDev: false,
        previewUrls: false,
        manifest: moduleOf(readFileSync(resolve(root, "reconstruction/dist/audit.js"), "utf8")),
        env: {
          ...Object.fromEntries(
            Object.entries({
              AUDIT_KEY_MCP: AUDIT_MCP,
              AUDIT_KEY_API: "synthetic-audit-api-key-32chars!!",
              AUDIT_KEY_READ: "synthetic-audit-read-key-32chars!",
            }).map(([key, value]) => [key, text(value)]),
          ),
          AUDIT_LOG: { type: "r2" },
        },
        triggers: [{ type: "fetch", pattern: "audit.local/*" }],
      }),
      guarded({
        name: "api",
        compatibilityDate: DATE,
        workersDev: false,
        previewUrls: false,
        manifest: moduleOf(readFileSync(built.api, "utf8")),
        env: {
          ...Object.fromEntries(
            Object.entries({
              ENVIRONMENT: "dev",
              DO_JURISDICTION: "off",
              DEV_AUTH_BYPASS_EMAIL: ADA,
              DEFAULT_TENANT_ID: "tenant_alpha",
              TENANT_DOMAINS: '{"tenant-a.test":"tenant_alpha","tenant-b.test":"tenant_beta"}',
              RATE_LIMIT_PER_MIN: "60",
              INTERNAL_HMAC_KEY: HMAC,
            }).map(([key, value]) => [key, text(value)]),
          ),
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
      }),
      guarded({
        name: "edge",
        compatibilityDate: DATE,
        workersDev: false,
        previewUrls: false,
        manifest: moduleOf(edge),
        env: { API: { type: "worker", worker: "api" } },
        triggers: [{ type: "fetch", pattern: "edge.local/*" }],
      }),
      guarded({
        name: "mcp-auth",
        compatibilityDate: DATE,
        workersDev: false,
        previewUrls: false,
        manifest: moduleOf(readFileSync(built.mcp, "utf8")),
        env: {
          ...Object.fromEntries(
            Object.entries({
              ENVIRONMENT: "dev",
              DEFAULT_TENANT_ID: "tenant_alpha",
              TENANT_DOMAINS: '{"tenant-a.test":"tenant_alpha","tenant-b.test":"tenant_beta"}',
              INTERNAL_HMAC_KEY: HMAC,
              AUDIT_KEY_MCP: AUDIT_MCP,
              ALLOWED_REDIRECT_URIS: REDIRECT,
              MCP_PUBLIC_URL: ORIGIN,
            }).map(([key, value]) => [key, text(value)]),
          ),
          OAUTH_KV: { type: "kv", id: "oauth-kv-import-roundtrip" },
          API: { type: "worker", worker: "api" },
          AUDIT: { type: "worker", worker: "audit" },
        },
        triggers: [{ type: "fetch", pattern: "localhost/*" }],
      }),
    ],
  });
  await mf.ready;
}

async function read(response) {
  const textBody = await response.text();
  let json = null;
  try {
    json = JSON.parse(textBody);
  } catch {
    json = null;
  }
  return { status: response.status, text: textBody, json, headers: response.headers };
}

function cookies(response) {
  return (response.headers.getSetCookie?.() ?? []).map((item) => item.split(";")[0]).join("; ");
}

function rpc(message) {
  if (message.json?.result || message.json?.error) return message.json;
  const data = message.text
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  return data.length ? JSON.parse(data.at(-1)) : null;
}

async function registerClient() {
  const res = await read(
    await mf.dispatchFetch(`${ORIGIN}/register`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({
        redirect_uris: [REDIRECT],
        client_name: "synthetic-import-mcp",
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code"],
        response_types: ["code"],
      }),
    }),
  );
  assert.equal(res.status, 201, res.text.slice(0, 300));
  return res.json.client_id;
}

async function authorizationCode(clientId, email, scopes) {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));
  const consent = await read(
    await mf.dispatchFetch(
      `${ORIGIN}/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_challenge: challenge,
        code_challenge_method: "S256",
        scope: scopes.join(" "),
        state,
        resource: RESOURCE,
      })}`,
      { headers: { "x-dev-email": email, origin: ORIGIN } },
    ),
  );
  assert.equal(consent.status, 200, consent.text.slice(0, 300));
  const handle = /name="handle" value="([^"]+)"/.exec(consent.text)?.[1];
  const form = new URLSearchParams({ handle, decision: "approve" });
  for (const scope of scopes) form.append("scope", scope);
  const approved = await read(
    await mf.dispatchFetch(`${ORIGIN}/authorize`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: ORIGIN,
        cookie: cookies(consent),
        "x-dev-email": email,
      },
      body: form,
    }),
  );
  assert.equal(approved.status, 302, approved.text.slice(0, 300));
  const location = new URL(approved.headers.get("location"));
  return { verifier, code: location.searchParams.get("code") };
}

async function exchange(clientId, code, verifier) {
  const token = await read(
    await mf.dispatchFetch(`${ORIGIN}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT,
        client_id: clientId,
        code_verifier: verifier,
        resource: RESOURCE,
      }),
    }),
  );
  assert.equal(token.status, 200, token.text.slice(0, 300));
  return token.json.access_token;
}

async function tokenFor(clientId, email, scopes) {
  const granted = await authorizationCode(clientId, email, scopes);
  return exchange(clientId, granted.code, granted.verifier);
}

async function mcp(token, body, session) {
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    origin: ORIGIN,
  };
  if (session) headers["mcp-session-id"] = session;
  return read(await mf.dispatchFetch(RESOURCE, { method: "POST", headers, body: JSON.stringify(body) }));
}

async function sessionFor(token) {
  const init = await mcp(token, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "synthetic-import", version: "0" },
    },
  });
  assert.equal(init.status, 200, init.text.slice(0, 300));
  const session = init.headers.get("mcp-session-id");
  await mcp(token, { jsonrpc: "2.0", method: "notifications/initialized" }, session);
  return session;
}

async function callTool(token, session, name, arguments_, id = 4) {
  return mcp(token, { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: arguments_ } }, session);
}

function parsed(message) {
  const body = rpc(message);
  const result = body?.result ?? body;
  const raw = JSON.stringify(result ?? body);
  let json = null;
  try {
    json = JSON.parse(result?.content?.[0]?.text ?? "");
  } catch {
    json = null;
  }
  return { raw, json, isError: result?.isError };
}

async function gateRead(email, id) {
  const path = `/harness/import?id=${encodeURIComponent(id)}`;
  const headers = await signInternalRequest({
    secret: HMAC,
    method: "GET",
    url: `http://edge.local${path}`,
    principal: {
      v: 1,
      iss: "secondary-mcp",
      aud: "secondary-api",
      sub: `synthetic-${email}`,
      email,
      client_id: "reconstruction-ui",
      scope: ["secondary.read"],
      tool: "personal_import_read",
      grant_id: `g_${email.split("@")[0]}`,
      host: "other",
    },
  });
  return read(
    await mf.dispatchFetch(`http://edge.local${path}`, {
      headers: { ...headers, accept: "application/json" },
    }),
  );
}

test("two OAuth users roundtrip import receipts through MCP and the same gate", async () => {
  let adaImportRequest = "";
  await boot();
  try {
    const clientId = await registerClient();
    const adaRead = await tokenFor(clientId, ADA, ["secondary.read"]);
    const readSession = await sessionFor(adaRead);
    const listed = rpc(await mcp(adaRead, { jsonrpc: "2.0", id: 2, method: "tools/list" }, readSession));
    const names = (listed?.result?.tools ?? []).map((tool) => tool.name);
    assert.equal(names.includes("personal_import"), true);
    assert.equal(names.includes("personal_import_read"), true);
    assert.equal(names.includes("personal_import_search"), true);
    assert.equal(names.includes("personal_note_create"), true);
    const refused = parsed(
      await callTool(adaRead, readSession, "personal_import", {
        source: "paste",
        externalId: "blocked",
        version: 1,
        text: "FORBIDDEN_IMPORT_BODY",
        principalId: "u_consultant",
        tenantId: "tenant_beta",
        usage: 0,
      }),
    );
    assert.equal(refused.raw.includes("insufficient_scope"), true);
    assert.equal(refused.raw.includes("FORBIDDEN_IMPORT_BODY"), false);
    const reportDenied = parsed(
      await callTool(adaRead, readSession, "usage_report", {
        eventId: "denied-report",
        outcome: "ok",
        inputTokens: 4,
        outputTokens: 4,
        totalTokens: 8,
      }, 30),
    );
    assert.equal(reportDenied.raw.includes("insufficient_scope"), true);
    assert.equal(reportDenied.raw.includes("denied-report"), false);

    const adaWrite = await tokenFor(clientId, ADA, WRITE);
    const adaSession = await sessionFor(adaWrite);
    const imported = parsed(
      await callTool(adaWrite, adaSession, "personal_import", {
        source: "file",
        externalId: "ada-note",
        version: 1,
        filename: "ada.md",
        text: "Ada provenance note",
        principalId: "u_consultant",
        tenantId: "tenant_beta",
        brain: "company",
        usage: 0,
        requestId: "forged-request",
      }),
    );
    assert.equal(imported.isError, undefined);
    const adaItem = imported.json;
    assert.equal(adaItem.outcome, "stored");
    assert.equal(adaItem.text, "Ada provenance note");
    assert.equal(adaItem.contentSha256, await sha256Hex("Ada provenance note"));
    assert.equal(adaItem.version, 1);
    assert.equal(adaItem.externalId, "ada-note");
    assert.equal(typeof adaItem.contentSha256, "string");
    assert.equal(adaItem.usage, "unknown");
    assert.notEqual(adaItem.principalId, "u_consultant");
    assert.equal(adaItem.tenantId, "tenant_alpha");
    assert.notEqual(adaItem.requestId, "forged-request");
    const duplicate = parsed(
      await callTool(adaWrite, adaSession, "personal_import", {
        source: "file",
        externalId: "ada-note",
        version: 1,
        filename: "ada.md",
        text: "Ada provenance note",
      }, 5),
    );
    const duplicateItem = duplicate.json;
    assert.equal(duplicateItem.outcome, "duplicate");
    assert.equal(duplicateItem.id, adaItem.id);
    assert.equal(duplicateItem.contentSha256, adaItem.contentSha256);
    const conflict = parsed(
      await callTool(adaWrite, adaSession, "personal_import", {
        source: "file",
        externalId: "ada-note",
        version: 1,
        filename: "ada.md",
        text: "Ada conflicting note",
      }, 6),
    );
    assert.equal(conflict.raw.includes("version_conflict"), true);
    assert.equal(conflict.raw.includes("Ada conflicting note"), false);
    const corrected = parsed(
      await callTool(adaWrite, adaSession, "personal_import", {
        source: "file",
        externalId: "ada-note",
        version: 2,
        filename: "ada.md",
        text: "Ada corrected provenance",
      }, 7),
    );
    const correctedItem = corrected.json;
    assert.equal(correctedItem.outcome, "stored");
    assert.equal(correctedItem.previous, adaItem.id);
    assert.equal(correctedItem.contentSha256, await sha256Hex("Ada corrected provenance"));
    assert.notEqual(correctedItem.contentSha256, adaItem.contentSha256);
    const legacy = parsed(
      await callTool(adaWrite, adaSession, "personal_note_create", {
        title: "Legacy note",
        body: "Legacy receipt body",
        principalId: "u_ceo",
        usage: 0,
      }, 8),
    );
    const legacyItem = legacy.json;
    assert.equal(legacyItem.text, "Legacy receipt body");
    assert.equal(legacyItem.externalId, "Legacy-note");
    assert.equal(legacyItem.version, 1);
    assert.equal(legacyItem.usage, "unknown");
    assert.equal(legacyItem.principalId, adaItem.principalId);
    const readBack = parsed(await callTool(adaWrite, adaSession, "personal_import_read", { id: adaItem.id, tenantId: "tenant_beta" }, 9));
    const readItem = readBack.json.item;
    assert.equal(readItem.id, adaItem.id);
    assert.equal(readItem.contentSha256, adaItem.contentSha256);
    assert.equal(readItem.version, 1);
    assert.equal(readItem.text, "Ada provenance note");
    assert.equal(readItem.usage, "unknown");
    const searched = parsed(
      await callTool(adaWrite, adaSession, "personal_import_search", { q: "provenance note", brain: "company" }, 10),
    );
    const hits = searched.json;
    assert.equal(Array.isArray(hits.items), true);
    assert.equal(hits.results, undefined);
    assert.equal(hits.items.some((item) => item.id === adaItem.id), true);
    assert.equal(hits.items.every((item) => item.principal === adaItem.principalId || item.principalId === adaItem.principalId), true);
    const guessed = parsed(await callTool(adaWrite, adaSession, "personal_import_read", { id: "pi:ffffffffffffffff" }, 11));
    assert.equal(guessed.raw.includes("not_found"), true);
    const gate = await gateRead(ADA, adaItem.id);
    assert.equal(gate.status, 200, gate.text);
    assert.equal(gate.json.item.id, adaItem.id);
    assert.equal(gate.json.item.contentSha256, adaItem.contentSha256);
    assert.equal(gate.json.item.requestId, adaItem.requestId);
    assert.equal(gate.json.usage, "unknown");
    const ledger = parsed(await callTool(adaWrite, adaSession, "usage_lookup", {}, 31));
    adaImportRequest = adaItem.requestId;
    const importEvent = ledger.json.events.find((event) => event.requestId === adaItem.requestId);
    assert.equal(importEvent.trust, "unknown");
    assert.equal(importEvent.operation, "import");
    assert.equal(importEvent.inputTokens, null);
    assert.equal(importEvent.providerVerified, false);
    assert.equal(ledger.json.summary.tokenCoverage.unknown >= 1, true);
    assert.equal(ledger.json.summary.input.value, null);
    const reported = parsed(
      await callTool(adaWrite, adaSession, "usage_report", {
        eventId: "client-evt-1",
        outcome: "ok",
        provider: "synthetic",
        model: "synthetic-echo",
        inputTokens: 2,
        outputTokens: 2,
        cacheReadTokens: 1,
        totalTokens: 4,
      }, 32),
    );
    assert.equal(reported.json.event.trust, "client_reported");
    assert.equal(reported.json.event.providerVerified, false);
    assert.equal(reported.json.event.inputTokens, 2);
    const replay = parsed(
      await callTool(adaWrite, adaSession, "usage_report", {
        eventId: "client-evt-1",
        outcome: "ok",
        provider: "synthetic",
        model: "synthetic-echo",
        inputTokens: 2,
        outputTokens: 2,
        cacheReadTokens: 1,
        totalTokens: 4,
      }, 33),
    );
    assert.equal(replay.json.outcome, "idempotent");
    assert.equal(replay.json.event.eventId, "client-evt-1");
    const clash = parsed(
      await callTool(adaWrite, adaSession, "usage_report", {
        eventId: "client-evt-1",
        outcome: "ok",
        provider: "synthetic",
        model: "synthetic-echo",
        inputTokens: 9,
        outputTokens: 9,
        totalTokens: 18,
      }, 34),
    );
    assert.equal(clash.raw.includes("conflict"), true);
    const stream = parsed(
      await callTool(adaWrite, adaSession, "usage_report", {
        eventId: "stream-1",
        outcome: "ok",
        providerRequestId: "preq-stream",
        streamSeq: 1,
        inputTokens: 2,
        outputTokens: 1,
        totalTokens: 3,
      }, 35),
    );
    assert.equal(stream.json.outcome, "stored");
    const streamNext = parsed(
      await callTool(adaWrite, adaSession, "usage_report", {
        eventId: "stream-2",
        outcome: "ok",
        providerRequestId: "preq-stream",
        streamSeq: 2,
        inputTokens: 5,
        outputTokens: 4,
        totalTokens: 9,
      }, 36),
    );
    assert.equal(streamNext.json.outcome, "replaced");
    assert.equal(streamNext.json.event.eventId, "stream-1");
    assert.equal(streamNext.json.event.inputTokens, 5);
    const retry = parsed(
      await callTool(adaWrite, adaSession, "usage_report", {
        eventId: "retry-1",
        outcome: "ok",
        providerRequestId: "preq-retry",
        retryOf: "client-evt-1",
        inputTokens: 1,
        outputTokens: 0,
        totalTokens: 1,
      }, 37),
    );
    assert.equal(retry.json.outcome, "stored");
    assert.notEqual(retry.json.event.eventId, "client-evt-1");
    const measured = parsed(
      await callTool(adaWrite, adaSession, "usage_fixture", { fixture: "measured-zero", eventId: "fixture-zero" }, 38),
    );
    assert.equal(measured.json.event.trust, "server_measured");
    assert.equal(measured.json.event.inputTokens, 0);
    assert.equal(measured.json.event.providerVerified, false);
    const cancelled = parsed(
      await callTool(adaWrite, adaSession, "usage_fixture", { fixture: "cancelled-unknown", eventId: "fixture-cancel" }, 39),
    );
    assert.equal(cancelled.json.event.outcome, "cancelled");
    assert.equal(cancelled.json.event.inputTokens, null);
    const covered = parsed(await callTool(adaWrite, adaSession, "usage_lookup", {}, 40));
    assert.equal(covered.json.summary.input.value, 8);
    assert.equal(covered.json.summary.input.complete, false);
    assert.equal(covered.json.summary.cost, "unknown");
    assert.equal(covered.json.summary.providerVerified, false);

    const bobWrite = await tokenFor(clientId, BOB, WRITE);
    const bobSession = await sessionFor(bobWrite);
    const bobImported = parsed(
      await callTool(bobWrite, bobSession, "personal_import", {
        source: "file",
        externalId: "ada-note",
        version: 1,
        filename: "bob.txt",
        text: "Ada provenance note",
      }, 12),
    );
    const bobItem = bobImported.json;
    assert.equal(bobItem.outcome, "stored");
    assert.notEqual(bobItem.id, adaItem.id);
    assert.equal(bobItem.tenantId, "tenant_beta");
    assert.notEqual(bobItem.principalId, adaItem.principalId);
    assert.equal(bobItem.contentSha256, await sha256Hex("Ada provenance note"));
    const bobMarker = parsed(
      await callTool(bobWrite, bobSession, "personal_import", {
        source: "paste",
        externalId: "bob-marker",
        version: 1,
        text: "Bob private marker zeta",
      }, 41),
    );
    assert.equal(bobMarker.json.text, "Bob private marker zeta");
    assert.equal(bobMarker.json.contentSha256, await sha256Hex("Bob private marker zeta"));
    const caraWrite = await tokenFor(clientId, CARA, WRITE);
    const caraSession = await sessionFor(caraWrite);
    const caraItem = parsed(
      await callTool(caraWrite, caraSession, "personal_import", {
        source: "paste",
        externalId: "cara-marker",
        version: 1,
        text: "Cara same-tenant marker",
      }, 42),
    ).json;
    assert.equal(caraItem.tenantId, "tenant_alpha");
    assert.notEqual(caraItem.principalId, adaItem.principalId);
    assert.equal(caraItem.contentSha256, await sha256Hex("Cara same-tenant marker"));
    const bobReadsAda = parsed(await callTool(bobWrite, bobSession, "personal_import_read", { id: adaItem.id }, 13));
    assert.equal(bobReadsAda.raw.includes("not_found"), true);
    assert.equal(bobReadsAda.raw.includes("Ada corrected provenance"), false);
    const bobSearch = parsed(await callTool(bobWrite, bobSession, "personal_import_search", { q: "corrected provenance" }, 14));
    const bobHits = bobSearch.json;
    assert.equal(bobHits.items.some((item) => item.text === "Ada corrected provenance"), false);
    const adaSearchBob = parsed(await callTool(adaWrite, adaSession, "personal_import_search", { q: "Bob private marker zeta" }, 15));
    assert.equal(adaSearchBob.json.items.length, 0);
    const bobSearchAda = parsed(await callTool(bobWrite, bobSession, "personal_import_search", { q: "Ada corrected provenance" }, 43));
    assert.equal(bobSearchAda.json.items.length, 0);
    const bobOwnMarker = parsed(await callTool(bobWrite, bobSession, "personal_import_search", { q: "private marker zeta" }, 52));
    assert.equal(bobOwnMarker.json.items.some((item) => item.id === bobMarker.json.id), true);
    const adaReadsBob = parsed(await callTool(adaWrite, adaSession, "personal_import_read", { id: bobMarker.json.id }, 44));
    assert.equal(adaReadsBob.raw.includes("not_found"), true);
    assert.equal(adaReadsBob.raw.includes("Bob private marker zeta"), false);
    const adaReadsCara = parsed(await callTool(adaWrite, adaSession, "personal_import_read", { id: caraItem.id }, 45));
    assert.equal(adaReadsCara.raw.includes("not_found"), true);
    const caraReadsAda = parsed(await callTool(caraWrite, caraSession, "personal_import_read", { id: adaItem.id }, 46));
    assert.equal(caraReadsAda.raw.includes("not_found"), true);
    const adaSearchCara = parsed(await callTool(adaWrite, adaSession, "personal_import_search", { q: "Cara same-tenant marker" }, 47));
    assert.equal(adaSearchCara.json.items.length, 0);
    const caraSearchAda = parsed(await callTool(caraWrite, caraSession, "personal_import_search", { q: "Ada corrected provenance" }, 48));
    assert.equal(caraSearchAda.json.items.length, 0);
    const bobLedger = parsed(await callTool(bobWrite, bobSession, "usage_lookup", { requestId: adaItem.requestId }, 49));
    assert.equal(bobLedger.raw.includes("not_found"), true);
    const adaLedgerBob = parsed(await callTool(adaWrite, adaSession, "usage_lookup", { requestId: bobMarker.json.requestId }, 50));
    assert.equal(adaLedgerBob.raw.includes("not_found"), true);
    const orgSearch = parsed(await callTool(adaWrite, adaSession, "personal_import_search", { q: "accounts", brain: "company" }, 16));
    const orgHits = orgSearch.json;
    assert.equal(orgHits.items.length, 0);
    assert.equal(orgHits.results, undefined);
  } finally {
    await mf.dispose();
  }

  await boot();
  try {
    const clientId = await registerClient();
    const adaWrite = await tokenFor(clientId, ADA, WRITE);
    const adaSession = await sessionFor(adaWrite);
    const searched = parsed(await callTool(adaWrite, adaSession, "personal_import_search", { q: "provenance" }));
    const hits = searched.json;
    assert.equal(hits.items.some((item) => item.text === "Ada corrected provenance" && item.version === 2), true);
    assert.equal(hits.items.some((item) => item.text === "Ada provenance note" && item.version === 1), true);
    assert.equal(hits.usage, "unknown");
    const legacy = parsed(await callTool(adaWrite, adaSession, "personal_import_search", { q: "Legacy receipt" }, 5));
    const legacyHits = legacy.json;
    assert.equal(legacyHits.items.some((item) => item.externalId === "Legacy-note" && item.usage === "unknown"), true);
    const ledgerAgain = parsed(await callTool(adaWrite, adaSession, "usage_lookup", { requestId: adaImportRequest }, 51));
    assert.equal(ledgerAgain.json.events[0].trust, "unknown");
    assert.equal(ledgerAgain.json.events[0].inputTokens, null);
    const bobWrite = await tokenFor(clientId, BOB, WRITE);
    const bobSession = await sessionFor(bobWrite);
    const bobSearch = parsed(await callTool(bobWrite, bobSession, "personal_import_search", { q: "corrected provenance" }));
    const bobHits = bobSearch.json;
    assert.equal(bobHits.items.length, 0);
  } finally {
    await mf.dispose();
  }
});
