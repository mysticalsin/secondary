import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src/index.ts";

// biome-ignore lint/suspicious/noExplicitAny: loosely typed JSON-RPC payloads in tests
export type Loose = any;

export const BASE = "http://localhost";

/** A copy of env with overrides. The OAuth helper object is per provider, so it must not be copied across. */
export function envWith(overrides: Record<string, string>): Env {
  const { OAUTH_PROVIDER: _drop, ...rest } = env as unknown as Record<string, unknown>;
  return { ...rest, ...overrides } as unknown as Env;
}
export const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
export const ALICE = "alice@example.invalid";

/** Run the worker's fetch handler directly, so tests can vary env (prod, other audience). */
export async function send(request: Request, e: Env = env): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(request as Parameters<typeof worker.fetch>[0], e, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

export async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );
  return { verifier, challenge };
}

export async function register(e: Env = env, redirect = REDIRECT, base = BASE, name = "Test Host") {
  const res = await send(
    new Request(`${base}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: name,
        redirect_uris: [redirect],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    }),
    e,
  );
  return { res, body: (await res.json()) as { client_id?: string; error?: string } };
}

export interface AuthorizeOptions {
  clientId: string;
  scope: string;
  redirect?: string;
  base?: string;
  email?: string;
  persona?: string;
  e?: Env;
  resource?: string | null;
  challenge: string;
  headers?: Record<string, string>;
}

export function authorizeUrl(o: AuthorizeOptions): string {
  const base = o.base ?? BASE;
  const u = new URL(`${base}/authorize`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", o.clientId);
  u.searchParams.set("redirect_uri", o.redirect ?? REDIRECT);
  u.searchParams.set("scope", o.scope);
  u.searchParams.set("state", "st8");
  u.searchParams.set("code_challenge", o.challenge);
  u.searchParams.set("code_challenge_method", "S256");
  if (o.resource !== null) u.searchParams.set("resource", o.resource ?? `${base}/mcp`);
  return u.toString();
}

export const devHeaders = (o: { email?: string; persona?: string }) => ({
  "x-dev-email": o.email ?? ALICE,
  ...(o.persona ? { "x-dev-persona": o.persona } : {}),
});

export function cookieJar(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

/** Full OAuth code flow with PKCE as a scripted host. Returns the access token. */
export async function getToken(
  o: Partial<Pick<AuthorizeOptions, "scope" | "email" | "persona" | "base">> & {
    e?: Env;
    decision?: "approve" | "deny";
    /** Replace the dev headers, for example with a Cloudflare Access JWT. */
    authHeaders?: Record<string, string>;
    clientName?: string;
  } = {},
) {
  const e = o.e ?? env;
  const base = o.base ?? BASE;
  const { body } = await register(e, REDIRECT, base, o.clientName);
  const who = o.authHeaders ?? devHeaders(o);
  const clientId = body.client_id as string;
  const { verifier, challenge } = await pkce();
  const scope = o.scope ?? "secondary.read secondary.personal.write secondary.contribute";
  const page = await send(
    new Request(authorizeUrl({ clientId, scope, challenge, base }), {
      headers: who,
    }),
    e,
  );
  const html = await page.text();
  const handle = /name="handle" value="([^"]+)"/.exec(html)?.[1];
  if (page.status !== 200 || !handle)
    throw new Error(
      `authorize failed ${page.status} ${page.headers.get("location")}: ${html.slice(0, 300)}`,
    );
  const form = new URLSearchParams({ handle, decision: o.decision ?? "approve" });
  for (const s of scope.split(" ")) form.append("scope", s);
  const post = await send(
    new Request(`${base}/authorize`, {
      method: "POST",
      headers: {
        ...who,
        "content-type": "application/x-www-form-urlencoded",
        cookie: cookieJar(page),
        origin: base,
      },
      body: form,
    }),
    e,
  );
  const location = post.headers.get("location") ?? "";
  if (post.status !== 302)
    throw new Error(`consent post ${post.status}: ${(await post.text()).slice(0, 300)}`);
  const redirected = new URL(location);
  if (o.decision === "deny")
    return { clientId, location: redirected, token: null as string | null };
  const code = redirected.searchParams.get("code");
  const tok = await send(
    new Request(`${base}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code ?? "",
        redirect_uri: REDIRECT,
        client_id: clientId,
        code_verifier: verifier,
        resource: `${base}/mcp`,
      }),
    }),
    e,
  );
  const json = (await tok.json()) as { access_token?: string; scope?: string };
  if (!json.access_token)
    throw new Error(`token exchange failed ${tok.status}: ${JSON.stringify(json)}`);
  return { clientId, location: redirected, token: json.access_token, scope: json.scope };
}

let rpcId = 1;
export async function rpc(
  token: string | null,
  method: string,
  params: Record<string, unknown> = {},
  e: Env = env,
  base = BASE,
) {
  const res = await send(
    new Request(`${base}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
        // The MCP SDK checks Host for loopback servers (DNS rebinding protection).
        host: new URL(base).host,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params }),
    }),
    e,
  );
  const text = await res.text();
  let json: unknown = null;
  // SSE or JSON body
  const data =
    text.startsWith("event:") || text.includes("\ndata:") || text.startsWith("data:")
      ? text
          .split("\n")
          .find((l) => l.startsWith("data:"))
          ?.slice(5)
      : text;
  try {
    json = data ? JSON.parse(data) : null;
  } catch {}
  return { res, json: json as Loose, text };
}

export const callTool = (
  token: string,
  name: string,
  args: Record<string, unknown> = {},
  e: Env = env,
) => rpc(token, "tools/call", { name, arguments: args }, e);

/**
 * Receipts as the real audit parser stored them, shown in the event vocabulary the tests assert on
 * (outcome, client_id, scope_ids, result_count, oauth_scopes, redirect_host, kind).
 */
export async function auditEvents(): Promise<Record<string, Loose>[]> {
  const receipts = (await (
    await env.AUDIT.fetch("https://audit.internal/events")
  ).json()) as Loose[];
  const outcome = { allow: "ok", deny: "denied", rejected: "error" } as const;
  return receipts.map((r) => ({
    ...r,
    kind: r.tool ? "mcp.tool_call" : "mcp.oauth",
    outcome: outcome[r.decision as keyof typeof outcome],
    client_id: r.clientId,
    scope_ids: r.scopeIds,
    result_count: r.resultCount,
    oauth_scopes: r.oauthScopes,
    redirect_host: r.redirectHost,
    who: r.principalId,
    ...(r.reason === "" ? { reason: undefined } : {}),
  }));
}
export const clearAudit = () =>
  env.AUDIT.fetch("https://audit.internal/events", { method: "DELETE" });
export async function apiCalls(): Promise<Record<string, Loose>[]> {
  return (await (await env.API.fetch("https://api.internal/__calls")).json()) as Record<
    string,
    Loose
  >[];
}
export const clearApiCalls = () =>
  env.API.fetch("https://api.internal/__calls", { method: "DELETE" });
