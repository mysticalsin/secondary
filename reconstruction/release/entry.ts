/**
 * NEW RECONSTRUCTION protected-dev edge. Not a recovered worker and not a deploy.
 * Public /harness routes and fixture impersonation are closed.
 * Browser identity is a verified JWT. Dev email headers are ignored.
 * The API binding is private. This file does not name a live account or secret.
 */
import { signInternalRequest } from "../worker-root/worker/src/internal-auth.ts";
import { verifyReleaseJwt } from "./identity.mjs";
import { DEV_IDENTITY_HEADERS, releaseDecision } from "./routes.mjs";

interface Env {
  RELEASE_MODE?: string;
  AUTH_ISSUER?: string;
  AUTH_AUDIENCE?: string;
  LOCAL_JWKS?: string;
  INTERNAL_HMAC_KEY?: string;
  API?: { fetch: (input: RequestInfo, init?: RequestInit) => Promise<Response> };
}

function text(body: string, status: number, type = "text/plain; charset=utf-8") {
  return new Response(body, { status, headers: { "content-type": type, "cache-control": "no-store" } });
}

function bearer(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  return request.headers.get("cf-access-jwt-assertion")?.trim() ?? "";
}

async function identity(request: Request, env: Env) {
  for (const name of DEV_IDENTITY_HEADERS) {
    if (request.headers.get(name)) {
      // Present and ignored. Identity never comes from these headers.
    }
  }
  const token = bearer(request);
  if (!token) return { ok: false as const, reason: "unauthorized" };
  return verifyReleaseJwt(token, env);
}

async function privateImport(env: Env, email: string, body: string) {
  if (!env.API || !env.INTERNAL_HMAC_KEY) return text("auth_unconfigured\n", 503);
  const payload = JSON.stringify({ source: "paste", externalId: "release-note", version: 1, text: body });
  const url = "https://api.internal/harness/import";
  const headers = await signInternalRequest({
    secret: env.INTERNAL_HMAC_KEY,
    method: "POST",
    url,
    body: payload,
    principal: {
      v: 1,
      iss: "secondary-mcp",
      aud: "secondary-api",
      sub: `release-${email}`,
      email,
      client_id: "release-edge",
      scope: ["secondary.read", "secondary.personal.write"],
      tool: "personal_import",
      grant_id: "g_release_edge",
      host: "other",
    },
  });
  const response = await env.API.fetch(url, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json", accept: "application/json" },
    body: payload,
  });
  return new Response(await response.text(), {
    status: response.status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function page(email: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Protected dev</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head><body>
<main>
<p>Protected dev preview. Not live billing.</p>
<p>Signed in as ${email.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}. The token was verified. Dev headers are ignored.</p>
<form method="post" action="/reconstruction/import"><label>Text <textarea name="text"></textarea></label>
<button type="submit">Store in my personal brain</button></form>
</main></body></html>`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const decision = releaseDecision(url.pathname, env.RELEASE_MODE);
    if (decision.kind === "closed") return text("release_mode\n", decision.status);
    if (decision.kind === "deny") return text(`${decision.reason}\n`, decision.status);
    if (decision.kind === "asset") return text("", 204);
    if (decision.kind === "mcp") {
      if (!env.API) return text("auth_unconfigured\n", 503);
      return env.API.fetch(request);
    }
    const who = await identity(request, env);
    if (!who.ok) return text(`${who.reason}\n`, who.reason === "auth_unconfigured" ? 503 : 401);
    if (request.method === "GET") return text(page(who.email), 200, "text/html; charset=utf-8");
    if (request.method === "POST" && url.pathname === "/reconstruction/import") {
      const raw = await request.text();
      const textValue = raw.trim().startsWith("{")
        ? String((JSON.parse(raw) as { text?: unknown }).text ?? "")
        : (new URLSearchParams(raw).get("text") ?? "");
      if (!textValue || textValue.length > 7000) return text("invalid_text\n", 400);
      return privateImport(env, who.email, textValue);
    }
    return text("method\n", 405);
  },
};
