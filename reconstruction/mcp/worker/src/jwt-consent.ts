/**
 * NEW RECONSTRUCTION consent gate. Not the recovered dev-email authorizer.
 * A non-dev /authorize accepts only a verified RS256 JWT for the MCP audience.
 * x-dev-email and x-dev-persona are not read. Persona is not copied onto the grant.
 */
import { AuthorizationError } from "@cloudflare/workers-oauth-provider";
// The validator is plain mjs shared with the release edge. This project has no mjs resolver.
// @ts-expect-error module has a sibling declaration for other projects, not this overlay
import { admittedTenant, tokenFromRequest, verifyRemoteJwt } from "../../../release/jwks-validator.mjs";
import { writeAudit } from "./audit.ts";
import { allowedRedirects, isRedirectAllowed, SCOPES, type AuthProps, type Scope } from "./config.ts";
import { consentPage, errorPage, pageHeaders } from "./consent-page.ts";

const html = (status: number, body: string, extra?: Headers) => {
  const headers = pageHeaders();
  extra?.forEach((value, key) => {
    if (key === "set-cookie") headers.append(key, value);
    else if (!headers.has(key)) headers.set(key, value);
  });
  headers.set("content-type", "text/html; charset=utf-8");
  return new Response(body, { status, headers });
};

const isScope = (value: string): value is Scope => (SCOPES as readonly string[]).includes(value);

function grantable(requested: string[]): Scope[] {
  const out = [...new Set(requested.filter(isScope))];
  if (!out.includes("secondary.read")) out.unshift("secondary.read");
  return out;
}

async function identity(request: Request, env: Env) {
  const presented = tokenFromRequest(request);
  if (!presented.ok) return presented;
  const audience = String((env as { AUTH_MCP_AUD?: string }).AUTH_MCP_AUD ?? "").trim();
  if (!audience) return { ok: false as const, reason: "auth_unconfigured" };
  const verified = await verifyRemoteJwt(presented.token, env, audience);
  if (!verified.ok) return verified;
  const tenant = admittedTenant(verified.email, (env as { ADMITTED_TENANT_DOMAINS?: string }).ADMITTED_TENANT_DOMAINS);
  if (!tenant) return { ok: false as const, reason: "tenant_not_admitted" };
  return { ok: true as const, email: verified.email, sub: verified.sub, tenant };
}

async function rejectRedirect(env: Env, clientId: string, redirectUri: string, who?: string) {
  let host = "invalid";
  try {
    host = new URL(redirectUri).hostname;
  } catch {
    host = "invalid";
  }
  await writeAudit(env, {
    kind: "mcp.oauth",
    action: "authorize.rejected",
    outcome: "denied",
    reason: "redirect_host_not_allowed",
    client_id: clientId,
    redirect_host: host,
    ...(who ? { who } : {}),
  });
  return html(403, errorPage("Application not allowed", "This application is not on the list of hosts that may connect to Secondary. Nothing was shared."));
}

const hasPkce = (request: { codeChallenge?: string; codeChallengeMethod?: string }) =>
  !!request.codeChallenge && request.codeChallengeMethod === "S256";

export async function jwtConsent(request: Request, env: Env): Promise<Response> {
  const who = await identity(request, env);
  if (!who.ok) {
    const status = who.reason === "jwks_unavailable" || who.reason === "jwks_redirect" || who.reason === "auth_unconfigured" ? 503 : who.reason === "tenant_not_admitted" ? 403 : 401;
    return html(status, errorPage("Sign-in required", "Sign in through the configured issuer and try again."));
  }
  const oauth = env.OAUTH_PROVIDER;
  const hosts = allowedRedirects(env);
  if (request.method === "GET") {
    try {
      const authReq = await oauth.parseAuthRequest(request);
      if (!isRedirectAllowed(authReq.redirectUri, hosts)) return rejectRedirect(env, authReq.clientId, authReq.redirectUri, who.sub);
      if (!hasPkce(authReq)) return html(400, errorPage("Invalid request", "This application must use PKCE (S256). Nothing was shared."));
      const details = await oauth.describeConsent(authReq);
      const consent = await oauth.beginConsent(authReq);
      return html(200, consentPage({ details, email: who.email, scopes: grantable(authReq.scope), handle: consent.handle }), consent.headers);
    } catch (error) {
      if (error instanceof AuthorizationError) return html(400, errorPage("Invalid request", error.description));
      throw error;
    }
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { allow: "GET, POST" } });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return html(403, errorPage("Request refused", "Cross-site request."));
  const form = await request.formData();
  const handle = String(form.get("handle") ?? "");
  try {
    if (form.get("decision") !== "approve") {
      const denied = await oauth.denyConsent(request, handle);
      return new Response(null, { status: 302, headers: new Headers([...denied.headers, ["location", denied.redirectTo]]) });
    }
    const scope = grantable(form.getAll("scope").map(String));
    const approved = await oauth.approveConsent(request, handle, { scope });
    if (!isRedirectAllowed(approved.request.redirectUri, hosts)) {
      return rejectRedirect(env, approved.request.clientId, approved.request.redirectUri, who.sub);
    }
    if (!hasPkce(approved.request)) return html(400, errorPage("Invalid request", "This application must use PKCE (S256). Nothing was shared."));
    const props: AuthProps = { userId: who.sub, email: who.email };
    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request,
      userId: who.sub,
      metadata: { client_id: approved.request.clientId },
      scope: approved.request.scope,
      props,
    });
    await writeAudit(env, {
      kind: "mcp.oauth",
      action: "authorize.approve",
      outcome: "ok",
      who: who.sub,
      client_id: approved.request.clientId,
      oauth_scopes: approved.request.scope,
    });
    return new Response(null, { status: 302, headers: new Headers([...approved.headers, ["location", redirectTo]]) });
  } catch (error) {
    if (error instanceof AuthorizationError) return html(400, errorPage("Invalid request", error.description));
    throw error;
  }
}
