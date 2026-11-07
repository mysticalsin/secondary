/**
 * NEW RECONSTRUCTION MCP entry. The recovered OAuth worker is not edited.
 * This composes the recovered provider, consent, and tool server, then adds
 * personal import, read, and search. personal_note_create keeps its name and
 * now stores an import receipt instead of bypassing the policy.
 */
import OAuthProvider, { type OAuthResourceContext } from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp";
import { requireScopes } from "@modelcontextprotocol/server";
import { z } from "zod";
import { hostOf } from "../../../packages/contracts/src/agent-host.ts";
import { ApiClient, type Caller } from "./api-client.ts";
import { writeAudit } from "./audit.ts";
import { authorizeHandler } from "./authorize.ts";
import { type AuthProps, allowedRedirects, BASELINE_SCOPES, isRedirectAllowed, publicBase, SCOPES } from "./config.ts";
import { rateLimited } from "./rate-limit.ts";
import { mcpEnabled } from "./switch.ts";
import { buildServer } from "./tools.ts";

const hostCache = new Map<string, string>();

async function hostFor(env: Env, clientId: string): Promise<string> {
  const hit = hostCache.get(clientId);
  if (hit) return hit;
  let host = "other";
  try {
    const client = await env.OAUTH_PROVIDER.lookupClient(clientId);
    if (client) host = hostOf(client.redirectUris ?? [], client.clientName ?? "");
  } catch {
    host = "other";
  }
  if (hostCache.size > 500) hostCache.clear();
  hostCache.set(clientId, host);
  return host;
}

const grantOf = (token: string): string | undefined => {
  const parts = token.split(":");
  return parts.length === 3 && /^[A-Za-z0-9_-]{1,128}$/.test(parts[1] ?? "") ? parts[1] : undefined;
};

const READ = ["secondary.read"] as const;
const WRITE = ["secondary.read", "secondary.personal.write"] as const;

function fail(error: string, extra?: Record<string, unknown>) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: JSON.stringify({ error, ...extra }) }],
  };
}

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

function allowed(caller: Caller, required: readonly string[]): boolean {
  return required.every((scope) => caller.scopes.includes(scope));
}

async function denied(env: Env, caller: Caller, tool: string, required: readonly string[]) {
  await writeAudit(env, {
    kind: "mcp.tool_call",
    action: tool,
    who: caller.sub,
    client_id: caller.clientId,
    oauth_scopes: caller.scopes,
    outcome: "denied",
    reason: "insufficient_scope",
    result_count: 0,
  });
  return fail("insufficient_scope", { required_scopes: [...required] });
}

async function finish(env: Env, caller: Caller, tool: string, result: Awaited<ReturnType<ApiClient["get"]>>) {
  if (!result.ok) {
    await writeAudit(env, {
      kind: "mcp.tool_call",
      action: tool,
      who: caller.sub,
      client_id: caller.clientId,
      oauth_scopes: caller.scopes,
      outcome: result.status === 403 || result.status === 404 ? "denied" : "error",
      reason: result.error.slice(0, 80),
      result_count: 0,
    });
    return fail(result.error);
  }
  const audited = await writeAudit(env, {
    kind: "mcp.tool_call",
    action: tool,
    who: caller.sub,
    client_id: caller.clientId,
    oauth_scopes: caller.scopes,
    outcome: "ok",
    result_count: 1,
  });
  if (!audited) return fail("audit_unavailable");
  return ok(result.data);
}

function policyBody(args: {
  source?: string;
  externalId?: string;
  version?: number;
  filename?: string;
  text?: string;
  url?: string;
}) {
  return {
    source: args.source,
    externalId: args.externalId,
    version: args.version,
    filename: args.filename,
    text: args.text,
    ...(args.url === undefined ? {} : { url: args.url }),
  };
}

function legacyExternalId(title: string): string {
  const slug = title
    .trim()
    .replace(/[^A-Za-z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(slug) ? slug : "";
}

function attachImportTools(server: ReturnType<typeof buildServer>, env: Env, caller: Caller) {
  const tools = Reflect.get(server, "_registeredTools") as Record<string, { remove?: () => void }> | undefined;
  tools?.personal_note_create?.remove?.();
  const ignored = {
    principalId: z.string().optional(),
    tenantId: z.string().optional(),
    brain: z.string().optional(),
    usage: z.union([z.string(), z.number(), z.null()]).optional(),
    requestId: z.string().optional(),
  };
  server.registerTool(
    "personal_note_create",
    {
      title: "Save a personal note (legacy name)",
      description:
        "Legacy tool name. The text is stored through the import receipt with source paste and version 1. Ask the user before saving. principal, tenant, brain, and usage arguments are ignored.",
      inputSchema: z.object({
        title: z.string().trim().min(1).max(200),
        body: z.string().trim().min(1).max(20_000),
        ...ignored,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      scopeChallenge: requireScopes(...WRITE),
    },
    async ({ title, body }) => {
      if (!allowed(caller, WRITE)) return denied(env, caller, "personal_note_create", WRITE);
      const externalId = legacyExternalId(title);
      if (!externalId) return fail("invalid_external_id");
      const api = new ApiClient(env, caller, "personal_note_create");
      return finish(
        env,
        caller,
        "personal_note_create",
        await api.post("/harness/import", { source: "paste", externalId, version: 1, text: body }),
      );
    },
  );
  server.registerTool(
    "personal_import",
    {
      title: "Import into your personal brain",
      description:
        "Store pasted text or a .txt or .md file in the signed-in user's personal brain. The receipt records source, version, and content hash. External model usage is unknown. Arguments cannot choose a principal, tenant, or brain.",
      inputSchema: z.object({
        source: z.enum(["paste", "file"]),
        externalId: z.string().trim().min(1).max(64),
        version: z.number().int().min(1).max(1000),
        text: z.string().min(1).max(7000),
        filename: z.string().max(80).optional(),
        url: z.string().optional(),
        ...ignored,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      scopeChallenge: requireScopes(...WRITE),
    },
    async (args) => {
      if (!allowed(caller, WRITE)) return denied(env, caller, "personal_import", WRITE);
      const api = new ApiClient(env, caller, "personal_import");
      return finish(env, caller, "personal_import", await api.post("/harness/import", policyBody(args)));
    },
  );
  server.registerTool(
    "personal_import_read",
    {
      title: "Read one personal import",
      description:
        "Read one import receipt from the signed-in user's personal brain. A guessed id from another person is not found. Arguments cannot choose a principal or tenant.",
      inputSchema: z.object({
        id: z.string().trim().min(1).max(128),
        ...ignored,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      scopeChallenge: requireScopes(...READ),
    },
    async ({ id }) => {
      if (!allowed(caller, READ)) return denied(env, caller, "personal_import_read", READ);
      const api = new ApiClient(env, caller, "personal_import_read");
      return finish(env, caller, "personal_import_read", await api.get(`/harness/import?id=${encodeURIComponent(id)}`));
    },
  );
  server.registerTool(
    "personal_import_search",
    {
      title: "Search your personal imports",
      description:
        "Search import receipts in the signed-in user's personal brain only. It does not search the company map. Arguments cannot choose a brain or tenant.",
      inputSchema: z.object({
        q: z.string().trim().min(1).max(200),
        ...ignored,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      scopeChallenge: requireScopes(...READ),
    },
    async ({ q }) => {
      if (!allowed(caller, READ)) return denied(env, caller, "personal_import_search", READ);
      const api = new ApiClient(env, caller, "personal_import_search");
      return finish(
        env,
        caller,
        "personal_import_search",
        await api.get(`/harness/import?q=${encodeURIComponent(q)}`),
      );
    },
  );
}

const mcpApi = {
  async fetch(request: Request, env: Env, rawCtx: ExecutionContext) {
    const ctx = rawCtx as ExecutionContext & OAuthResourceContext<AuthProps>;
    const props = ctx.props;
    if (!props?.userId || !props.email || !ctx.auth.clientId) return new Response("Forbidden", { status: 403 });
    if (!(await mcpEnabled(env))) return Response.json({ error: "switched_off", switch: "mcp" }, { status: 503 });
    const grant = grantOf(ctx.auth.token);
    if (!grant) return Response.json({ error: "grant_unknown" }, { status: 403 });
    const host = await hostFor(env, ctx.auth.clientId);
    const scopes = Array.isArray(ctx.auth.scope) ? ctx.auth.scope : [];
    const caller: Caller = {
      sub: props.userId,
      email: props.email,
      ...(props.persona ? { persona: props.persona } : {}),
      clientId: ctx.auth.clientId,
      scopes,
      grantId: grant,
      host,
    };
    const handler = createMcpHandler(
      () => {
        const server = buildServer({ env, caller });
        attachImportTools(server, env, caller);
        return server;
      },
      { route: "/mcp", corsOptions: false },
    );
    return handler(request, env, rawCtx);
  },
};

interface Entry {
  provider: OAuthProvider<Env>;
  state: { env: Env };
}
const providers = new Map<string, Entry>();

function providerFor(env: Env, base: string): OAuthProvider<Env> {
  let entry = providers.get(base);
  if (entry) {
    entry.state.env = env;
    return entry.provider;
  }
  const state = { env };
  const provider = new OAuthProvider<Env>({
    apiRoute: "/mcp",
    apiHandler: mcpApi as never,
    defaultHandler: authorizeHandler,
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/token",
    clientRegistrationEndpoint: "/register",
    clientIdMetadataDocumentEnabled: true,
    scopesSupported: [...SCOPES],
    requiredScopes: [...BASELINE_SCOPES],
    accessTokenTTL: 3600,
    refreshTokenTTL: 30 * 24 * 3600,
    resourceMetadata: {
      resource: `${base}/mcp`,
      authorization_servers: [base],
      bearer_methods_supported: ["header"],
      resource_name: "Secondary (Mantu)",
    },
    async clientRegistrationCallback({ clientMetadata }) {
      const uris = Array.isArray(clientMetadata.redirect_uris) ? clientMetadata.redirect_uris : [];
      const hosts = allowedRedirects(state.env);
      const bad = uris.find((item) => typeof item !== "string" || !isRedirectAllowed(item, hosts));
      if (uris.length === 0 || bad !== undefined) {
        let host = "invalid";
        try {
          host = new URL(String(bad)).hostname;
        } catch {
          host = "invalid";
        }
        await writeAudit(state.env, {
          kind: "mcp.oauth",
          action: "register.rejected",
          outcome: "denied",
          reason: "redirect_host_not_allowed",
          redirect_host: host,
        });
        return {
          code: "invalid_redirect_uri",
          description: "redirect_uris must be https URLs on an allowed host (or http on localhost)",
          status: 400,
        };
      }
    },
  });
  entry = { provider, state };
  providers.set(base, entry);
  return provider;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const base = publicBase(env, request);
    if (!base) return new Response("MCP_PUBLIC_URL is not configured", { status: 500 });
    return rateLimited(request, env).then((limited) => limited ?? providerFor(env, base).fetch(request, env, ctx));
  },
} satisfies ExportedHandler<Env>;
