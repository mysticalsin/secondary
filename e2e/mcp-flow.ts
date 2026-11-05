// A scripted MCP host: dynamic client registration, OAuth code flow with PKCE (dev sign-in headers on a
// loopback host), then MCP over Streamable HTTP. Used by `pnpm e2e:mcp` and by mcp.spec.ts.

import { createHash, randomBytes } from "node:crypto";
import { MCP_URL } from "./ports.ts";

// biome-ignore lint/suspicious/noExplicitAny: loosely typed JSON-RPC payloads
type Loose = any;

const b64url = (b: Buffer) => b.toString("base64url");
const REDIRECT = "http://localhost:8976/callback";

export interface McpResult {
  whoami: Loose;
  searchHits: number;
  tools: string[];
  renderView: { title: string; components: number; text: string };
  /** Each read tool answered without error, as the persona. */
  extras: Record<string, boolean>;
}

export async function rpc(base: string, token: string, method: string, params: object = {}) {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: Math.floor(Math.random() * 1e6), method, params }),
  });
  const text = await res.text();
  const data =
    text.startsWith("event:") || text.includes("\ndata:")
      ? (text.split("\n").find((l) => l.startsWith("data:")) ?? "").slice(5)
      : text;
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status} ${text.slice(0, 300)}`);
  const json = JSON.parse(data) as { result?: Loose; error?: unknown };
  if (json.error) throw new Error(`${method}: ${JSON.stringify(json.error)}`);
  return json.result;
}

export async function getToken(
  base: string,
  persona: string,
  email = "mcp.tester@example.invalid",
) {
  const reg = await fetch(`${base}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Scripted host",
      redirect_uris: [REDIRECT],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  if (!reg.ok) throw new Error(`register: ${reg.status} ${await reg.text()}`);
  const clientId = ((await reg.json()) as { client_id: string }).client_id;

  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const scope = "secondary.read secondary.personal.write secondary.contribute";
  const url = new URL(`${base}/authorize`);
  for (const [k, v] of Object.entries({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    scope,
    state: "s1",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: `${base}/mcp`,
  }))
    url.searchParams.set(k, v);
  const dev = { "x-dev-email": email, "x-dev-persona": persona };
  const page = await fetch(url, { headers: dev, redirect: "manual" });
  const html = await page.text();
  const handle = /name="handle" value="([^"]+)"/.exec(html)?.[1];
  if (page.status !== 200 || !handle)
    throw new Error(`authorize: ${page.status} ${html.slice(0, 200)}`);
  const cookie = page.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const form = new URLSearchParams({ handle, decision: "approve" });
  for (const s of scope.split(" ")) form.append("scope", s);
  const post = await fetch(`${base}/authorize`, {
    method: "POST",
    redirect: "manual",
    headers: { ...dev, cookie, origin: base, "content-type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const loc = post.headers.get("location");
  const code = loc ? new URL(loc).searchParams.get("code") : null;
  if (!code) throw new Error(`consent: ${post.status} ${loc ?? (await post.text())}`);
  const tok = await fetch(`${base}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      client_id: clientId,
      code_verifier: verifier,
      resource: `${base}/mcp`,
    }),
  });
  const tj = (await tok.json()) as { access_token?: string };
  if (!tj.access_token) throw new Error(`token: ${tok.status} ${JSON.stringify(tj)}`);
  return tj.access_token;
}

export async function runMcpFlow(base = MCP_URL, persona = "ceo"): Promise<McpResult> {
  const token = await getToken(base, persona);
  await rpc(base, token, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "scripted-host", version: "1" },
  });
  const tools = (await rpc(base, token, "tools/list")).tools.map((t: { name: string }) => t.name);
  const call = (name: string, args: object = {}) =>
    rpc(base, token, "tools/call", { name, arguments: args });
  const who = await call("whoami");
  if (who.isError) throw new Error(`whoami: ${JSON.stringify(who.content)}`);
  const search = await call("search", { q: "pricing" });
  if (search.isError) throw new Error(`search: ${JSON.stringify(search.content)}`);
  const ok = async (name: string, args: object) => !(await call(name, args)).isError;
  const extras: Record<string, boolean> = {
    get_map: await ok("get_map", { lens: "departments" }),
    get_node: await ok("get_node", { id: "core" }),
    get_account: await ok("get_account", { id: "a_acme" }),
    list_review_queue: await ok("list_review_queue", {}),
  };
  const rv = await call("render_view", {
    viewPlan: {
      version: 1,
      title: "Company overview",
      components: [
        { type: "KpiRow", props: { lens: "departments" } },
        { type: "MapMini", props: { lens: "departments" } },
      ],
    },
  });
  if (rv.isError) throw new Error(`render_view: ${JSON.stringify(rv.content)}`);
  const view = rv.structuredContent?.view;
  return {
    whoami: who.structuredContent ?? JSON.parse(who.content[0].text),
    searchHits: (search.structuredContent?.result?.results ?? []).length,
    extras,
    tools,
    renderView: {
      title: view?.title,
      components: view?.components?.length ?? 0,
      text: String(rv.content?.[0]?.text ?? "").slice(0, 120),
    },
  };
}
