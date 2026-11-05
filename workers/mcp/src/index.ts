import OAuthProvider, { type OAuthResourceContext } from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp";
import { writeAudit } from "./audit.ts";
import { authorizeHandler } from "./authorize.ts";
import {
  type AuthProps,
  allowedRedirectHosts,
  BASELINE_SCOPES,
  isRedirectAllowed,
  publicBase,
  SCOPES,
} from "./config.ts";
import { mcpEnabled } from "./switch.ts";
import { buildServer } from "./tools.ts";

export { signInternalRequest, verifyInternalRequest } from "./internal-auth.ts";

/** The protected resource: Streamable HTTP MCP at /mcp. OAuthProvider has already validated the token and its audience. */
const mcpApi: ExportedHandlerWithFetch<Env> = {
  async fetch(request, env, rawCtx) {
    const ctx = rawCtx as unknown as OAuthResourceContext<AuthProps>;
    const props = ctx.props;
    if (!props?.userId || !props.email || !ctx.auth.clientId) {
      return new Response("Forbidden", { status: 403 });
    }
    // Kill switch (central, in the API). Checked before any tool runs.
    if (!(await mcpEnabled(env))) {
      return Response.json({ error: "switched_off", switch: "mcp" }, { status: 503 });
    }
    const handler = createMcpHandler(
      () =>
        buildServer({
          env,
          caller: {
            sub: props.userId,
            email: props.email,
            ...(props.persona ? { persona: props.persona } : {}),
            clientId: ctx.auth.clientId as string,
            scopes: ctx.auth.scope,
          },
        }),
      // Same-origin only: no CORS, hosts reach us server to server. Browser clients such as MCP Inspector use its proxy.
      { route: "/mcp", corsOptions: false },
    );
    return handler(request, env, rawCtx);
  },
};

type ExportedHandlerWithFetch<E> = ExportedHandler<E> & Required<Pick<ExportedHandler<E>, "fetch">>;

interface Entry {
  provider: OAuthProvider<Env>;
  /** The env of the latest request, so registration callbacks never read a stale one. */
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
  const p = new OAuthProvider<Env>({
    apiRoute: "/mcp",
    apiHandler: mcpApi as never,
    defaultHandler: authorizeHandler,
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/token",
    clientRegistrationEndpoint: "/register",
    // Client ID Metadata Documents (what Claude and ChatGPT prefer) plus Dynamic Client Registration (compatibility).
    clientIdMetadataDocumentEnabled: true,
    scopesSupported: [...SCOPES],
    requiredScopes: [...BASELINE_SCOPES],
    accessTokenTTL: 3600,
    refreshTokenTTL: 30 * 24 * 3600,
    // RFC 9728 metadata, and the RFC 8707 audience every token is bound to. No other issuer is trusted
    // (no resolveExternalToken) and the API never sees the token (no passthrough).
    resourceMetadata: {
      resource: `${base}/mcp`,
      authorization_servers: [base],
      bearer_methods_supported: ["header"],
      resource_name: "Secondary (Mantu)",
    },
    // Allowlist at registration too, so a bad client is refused before it ever reaches /authorize.
    async clientRegistrationCallback({ clientMetadata }) {
      const uris = Array.isArray(clientMetadata.redirect_uris) ? clientMetadata.redirect_uris : [];
      const hosts = allowedRedirectHosts(state.env);
      const bad = uris.find((u) => typeof u !== "string" || !isRedirectAllowed(u, hosts));
      if (uris.length === 0 || bad !== undefined) {
        let host = "invalid";
        try {
          host = new URL(String(bad)).hostname;
        } catch {}
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
  entry = { provider: p, state };
  providers.set(base, entry);
  return p;
}

export default {
  fetch(request, env, ctx) {
    const base = publicBase(env, request);
    if (!base) {
      // Fail closed: outside dev the canonical URL must be pinned, it is the token audience.
      return new Response("MCP_PUBLIC_URL is not configured", { status: 500 });
    }
    return providerFor(env, base).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
