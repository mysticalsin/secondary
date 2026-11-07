/**
 * NEW RECONSTRUCTION protected-dev edge. Not a recovered worker and not a deploy.
 * Browser pages are the reconstruction Settings UI. Machine MCP is a different binding.
 * Public /harness routes and fixture impersonation are closed.
 * A local test JWT is not production Access. Live audiences are not configured here.
 */
import shellHtml from "../../recovered-delivery/html-shell/index.html";
import shellCss from "../../recovered-delivery/shell-six/assets/index-DiBYRwP4.css";
import shellJs from "../../recovered-delivery/main-js/index-PLmoiPYI.dom-captured.js";
import { signInternalRequest } from "../worker-root/worker/src/internal-auth.ts";
import { verifyReleaseJwt } from "./identity.mjs";
import { DEV_IDENTITY_HEADERS, releaseDecision } from "./routes.mjs";
import { renderImport, renderObservability, renderPersonal } from "../ui/pages.mjs";

interface Env {
  RELEASE_MODE?: string;
  AUTH_ISSUER?: string;
  AUTH_AUDIENCE?: string;
  LOCAL_JWKS?: string;
  INTERNAL_HMAC_KEY?: string;
  API?: { fetch: (input: RequestInfo, init?: RequestInit) => Promise<Response> };
  MCP?: { fetch: (input: RequestInfo, init?: RequestInit) => Promise<Response> };
}

const ASSETS: Record<string, { type: string; body: string }> = {
  "/assets/index-DiBYRwP4.css": { type: "text/css; charset=utf-8", body: shellCss },
  "/assets/index-PLmoiPYI.js": { type: "text/javascript; charset=utf-8", body: shellJs },
};

function text(body: string, status: number, type = "text/plain; charset=utf-8") {
  return new Response(body, { status, headers: { "content-type": type, "cache-control": "no-store", "x-secondary-edge": "protected-dev" } });
}

function bearer(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  return "";
}

function configured(env: Env): boolean {
  return Boolean(env.AUTH_ISSUER?.trim() && env.AUTH_AUDIENCE?.trim() && env.LOCAL_JWKS?.trim());
}

async function identity(request: Request, env: Env) {
  const access = request.headers.get("cf-access-jwt-assertion")?.trim() ?? "";
  const token = bearer(request);
  if (access && token && access !== token) return { ok: false as const, reason: "invalid_token" };
  const presented = token || access;
  if (!presented) return { ok: false as const, reason: "unauthorized" };
  return verifyReleaseJwt(presented, env);
}

async function signedFetch(env: Env, email: string, method: string, path: string, body?: string) {
  if (!env.API || !env.INTERNAL_HMAC_KEY) return text("auth_unconfigured\n", 503);
  const url = `https://api.internal${path}`;
  const headers = await signInternalRequest({
    secret: env.INTERNAL_HMAC_KEY,
    method,
    url,
    ...(body === undefined ? {} : { body }),
    principal: {
      v: 1,
      iss: "secondary-mcp",
      aud: "secondary-api",
      sub: `release-${email}`,
      email,
      client_id: "release-edge",
      scope: method === "GET" ? ["secondary.read"] : ["secondary.read", "secondary.personal.write"],
      tool: "personal_import",
      grant_id: "g_release_edge",
      host: "other",
    },
  });
  return env.API.fetch(url, {
    method,
    headers: {
      ...headers,
      accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body }),
  });
}

function shell() {
  const nav = `<nav data-reconstruction="settings" style="font:14px sans-serif;padding:8px 16px;background:#fcf3ff;color:#17121a"><a href="/settings" style="color:#6600ae">Settings</a> · <a href="/brains/me" style="color:#6600ae">Personal brain</a> · <a href="/settings/observability" style="color:#6600ae">Observability</a> · <a href="/reconstruction/import" style="color:#6600ae">Import</a></nav>`;
  return shellHtml.replace("<body>", `<body>${nav}`);
}

function notice(result: string | null): string {
  if (result === "stored") return "Stored. The note below is the server read-back. Open Personal brain to see it in your own plan.";
  if (result === "duplicate") return "That version and text were already stored. The existing note was kept.";
  if (result === "conflict") return "That version already has different text. Nothing new was stored.";
  return "";
}

async function importPage(env: Env, email: string, message: string) {
  const listed = await signedFetch(env, email, "GET", "/harness/import?limit=20");
  const body = listed.ok ? await listed.json() : { items: [] as unknown[] };
  const rows = Array.isArray(body.items) ? body.items : [];
  return renderImport({
    who: email,
    tenant: String(body.tenantId ?? "unknown"),
    message,
    items: rows,
    kept: Number(body.total ?? rows.length),
    total: Number(body.total ?? rows.length),
    shown: rows.length,
    coverage: String(body.coverage ?? "full"),
    preset: "person_a",
    release: true,
  });
}

async function observability(env: Env, email: string, url: URL) {
  const ledgerResponse = await signedFetch(env, email, "GET", `/harness/ledger?${url.searchParams.toString()}`);
  const ledger = ledgerResponse.ok ? await ledgerResponse.json() : { events: [], summary: null, error: "unavailable", status: ledgerResponse.status };
  return renderObservability({
    roleLabel: "Verified token",
    principalId: email,
    tenantId: String(ledger.tenantId ?? "unknown"),
    persona: "none",
    prefMessage: "",
    section: url.searchParams.get("section") ?? "usage",
    release: true,
    preset: "person_a",
    routes: [],
    ready: { kind: "unknown", label: "Unknown", detail: "This edge does not claim worker readiness.", technical: "" },
    health: { kind: "unknown", label: "Unknown", detail: "No live uptime is measured." },
    ai: { kind: "unknown", label: "Unknown", detail: "No model is called." },
    agentRows: "<p>Agent rows are not loaded on this edge.</p>",
    audit: { kind: "unknown", label: "Not loaded", detail: "Audit is not claimed from this page.", raw: "" },
    lang: "",
    ledger: {
      status: ledgerResponse.status,
      events: Array.isArray(ledger.events) ? ledger.events : [],
      summary: ledger.summary ?? null,
      error: ledger.reason || ledger.error || "",
      operation: url.searchParams.get("operation") ?? "",
      trust: url.searchParams.get("trust") ?? "",
      requestId: url.searchParams.get("requestId") ?? "",
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.headers.get("x-original-url") || request.headers.get("x-rewrite-url") || request.headers.get("x-http-method-override")) {
      return text("header_override\n", 400);
    }
    const url = new URL(request.url);
    const decision = releaseDecision(url.pathname, env.RELEASE_MODE);
    if (decision.kind === "closed") return text("release_mode\n", decision.status);
    if (decision.kind === "deny") return text(`${decision.reason}\n`, decision.status);
    if (decision.kind === "asset") {
      const asset = ASSETS[url.pathname];
      if (!asset) return text("", 204);
      return text(asset.body, 200, asset.type);
    }
    if (decision.kind === "mcp") {
      if (!env.MCP) return text("auth_unconfigured\n", 503);
      return env.MCP.fetch(request);
    }
    if (!configured(env)) return text("auth_unconfigured\n", 503);
    if (request.method === "POST") {
      const origin = request.headers.get("origin");
      if (origin && origin !== url.origin) return text("cross_origin\n", 403);
    }
    const who = await identity(request, env);
    if (!who.ok) return text(`${who.reason}\n`, who.reason === "auth_unconfigured" ? 503 : 401);
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/settings" || url.pathname === "/settings/profile")) {
      return text(shell(), 200, "text/html; charset=utf-8");
    }
    if (request.method === "GET" && url.pathname === "/brains/me") {
      const planned = await signedFetch(env, who.email, "GET", `/harness/personal/plan${url.search}`);
      const plan = await planned.json().catch(() => ({ error: "unavailable" }));
      return text(renderPersonal({ status: planned.status, plan, email: who.email }), planned.status === 200 ? 200 : planned.status, "text/html; charset=utf-8");
    }
    if (request.method === "GET" && url.pathname === "/settings/observability") {
      return text(await observability(env, who.email, url), 200, "text/html; charset=utf-8");
    }
    if (request.method === "GET" && url.pathname === "/reconstruction/import") {
      return text(await importPage(env, who.email, notice(url.searchParams.get("result"))), 200, "text/html; charset=utf-8");
    }
    if (request.method === "POST" && url.pathname === "/reconstruction/import") {
      const raw = await request.text();
      const params = new URLSearchParams(raw);
      const source = params.get("source") === "file" ? "file" : "paste";
      const version = Number(params.get("version"));
      const saved = await signedFetch(env, who.email, "POST", "/harness/import", JSON.stringify({
        source,
        externalId: params.get("externalId") ?? "",
        version,
        text: params.get("text") ?? "",
        ...(params.get("filename") ? { filename: params.get("filename") } : {}),
      }));
      const body = await saved.json().catch(() => ({ error: "unavailable" }));
      const result = saved.status === 201 ? "stored" : body.outcome === "duplicate" ? "duplicate" : saved.status === 409 ? "conflict" : "rejected";
      if (result === "rejected") {
        return text(await importPage(env, who.email, `Not stored (${String(body.reason || body.error || saved.status)}). Nothing new was written.`), 400, "text/html; charset=utf-8");
      }
      return new Response(null, {
        status: 303,
        headers: { location: `/reconstruction/import?result=${result}`, "cache-control": "no-store", "x-secondary-edge": "protected-dev" },
      });
    }
    return text("method\n", 405);
  },
};
