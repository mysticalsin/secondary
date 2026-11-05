import { AuthorizationError } from "@cloudflare/workers-oauth-provider";
import { authenticate } from "./access.ts";
import { writeAudit } from "./audit.ts";
import {
  type AuthProps,
  allowedRedirectHosts,
  isRedirectAllowed,
  SCOPES,
  type Scope,
} from "./config.ts";
import { consentPage, errorPage, pageHeaders } from "./consent-page.ts";

const html = (status: number, body: string, extra?: Headers) => {
  const headers = pageHeaders();
  // Our hardening headers win (stricter CSP, no duplicates). Cookies from the consent handle accumulate.
  extra?.forEach((v, k) => {
    if (k === "set-cookie") headers.append(k, v);
    else if (!headers.has(k)) headers.set(k, v);
  });
  headers.set("content-type", "text/html; charset=utf-8");
  return new Response(body, { status, headers });
};

const isScope = (s: string): s is Scope => (SCOPES as readonly string[]).includes(s);

function grantable(requested: string[]): Scope[] {
  const out = [...new Set(requested.filter(isScope))];
  if (!out.includes("secondary.read")) out.unshift("secondary.read");
  return out;
}

async function rejectRedirect(env: Env, clientId: string, redirectUri: string, who?: string) {
  let host = "invalid";
  try {
    host = new URL(redirectUri).hostname;
  } catch {}
  await writeAudit(env, {
    kind: "mcp.oauth",
    action: "authorize.rejected",
    outcome: "denied",
    reason: "redirect_host_not_allowed",
    client_id: clientId,
    redirect_host: host,
    ...(who ? { who } : {}),
  });
  return html(
    403,
    errorPage(
      "Application not allowed",
      "This application is not on the list of hosts that may connect to Secondary. Nothing was shared.",
    ),
  );
}

async function handleGet(request: Request, env: Env): Promise<Response> {
  const identity = await authenticate(request, env);
  if (!identity) {
    return html(401, errorPage("Sign-in required", "Sign in through Mantu Access and try again."));
  }
  const oauth = env.OAUTH_PROVIDER;
  const hosts = allowedRedirectHosts(env);

  let authReq: Awaited<ReturnType<typeof oauth.parseAuthRequest>>;
  try {
    authReq = await oauth.parseAuthRequest(request);
  } catch (e) {
    if (e instanceof AuthorizationError) {
      // redirectUri is only set once the client and exact redirect URI validated; still enforce the allowlist.
      if (e.redirectUri && e.redirectTo) {
        if (isRedirectAllowed(e.redirectUri, hosts)) {
          return new Response(null, { status: 302, headers: { location: e.redirectTo } });
        }
        return rejectRedirect(env, "unknown", e.redirectUri, identity.sub);
      }
      return html(400, errorPage("Invalid request", e.description));
    }
    throw e;
  }

  if (!isRedirectAllowed(authReq.redirectUri, hosts)) {
    return rejectRedirect(env, authReq.clientId, authReq.redirectUri, identity.sub);
  }

  const details = await oauth.describeConsent(authReq);
  const consent = await oauth.beginConsent(authReq);
  return html(
    200,
    consentPage({
      details,
      email: identity.email,
      scopes: grantable(authReq.scope),
      handle: consent.handle,
    }),
    consent.headers,
  );
}

async function handlePost(request: Request, env: Env): Promise<Response> {
  const identity = await authenticate(request, env);
  if (!identity) {
    return html(401, errorPage("Sign-in required", "Sign in through Mantu Access and try again."));
  }
  // CSRF, layer 1: a cross-origin form post is refused. Layer 2 is the one-time consent handle,
  // bound to this browser by a __Host- cookie (see beginConsent in workers-oauth-provider).
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return html(403, errorPage("Request refused", "Cross-site request."));
  }

  const form = await request.formData();
  const handle = String(form.get("handle") ?? "");
  const oauth = env.OAUTH_PROVIDER;
  const hosts = allowedRedirectHosts(env);

  try {
    if (form.get("decision") !== "approve") {
      const denied = await oauth.denyConsent(request, handle);
      await writeAudit(env, {
        kind: "mcp.oauth",
        action: "authorize.deny",
        outcome: "denied",
        who: identity.sub,
        client_id: denied.request.clientId,
      });
      return new Response(null, {
        status: 302,
        headers: new Headers([...denied.headers, ["location", denied.redirectTo]]),
      });
    }

    const scope = grantable(form.getAll("scope").map(String));
    const approved = await oauth.approveConsent(request, handle, { scope });
    if (!isRedirectAllowed(approved.request.redirectUri, hosts)) {
      return rejectRedirect(
        env,
        approved.request.clientId,
        approved.request.redirectUri,
        identity.sub,
      );
    }
    const props: AuthProps = {
      userId: identity.sub,
      email: identity.email,
      ...(identity.persona && (env.ENVIRONMENT as string) === "dev"
        ? { persona: identity.persona }
        : {}),
    };
    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request,
      userId: identity.sub,
      // userId and metadata are storage-visible (KV is not EU-restricted): opaque id and client id only.
      metadata: { client_id: approved.request.clientId },
      scope: approved.request.scope,
      props,
    });
    await writeAudit(env, {
      kind: "mcp.oauth",
      action: "authorize.approve",
      outcome: "ok",
      who: identity.sub,
      client_id: approved.request.clientId,
      oauth_scopes: approved.request.scope,
    });
    return new Response(null, {
      status: 302,
      headers: new Headers([...approved.headers, ["location", redirectTo]]),
    });
  } catch (e) {
    if (e instanceof AuthorizationError) {
      return html(400, errorPage("Invalid request", e.description));
    }
    throw e;
  }
}

export const authorizeHandler: ExportedHandler<Env> = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json(
        { ok: true, env: env.ENVIRONMENT },
        { headers: { "cache-control": "no-store" } },
      );
    }
    if (url.pathname === "/authorize") {
      if (request.method === "GET") return handleGet(request, env);
      if (request.method === "POST") return handlePost(request, env);
      return new Response("Method not allowed", { status: 405, headers: { allow: "GET, POST" } });
    }
    return new Response("Not found", { status: 404 });
  },
};
