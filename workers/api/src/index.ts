import { Hono } from "hono";
import { accessLog } from "./observe.ts";
import { opsInternalRoutes } from "./ops-internal.ts";
import { authRoutes } from "./auth/routes.ts";
import { connectorRoutes } from "./connector.ts";
import { v1Routes } from "./routes.ts";
import { scimRoutes } from "./scim/routes.ts";
import { onError, requestId, securityHeaders } from "./security.ts";
import type { AppDeps, AppEnv } from "./types.ts";

export { TenantPolicy } from "./tenant-policy.ts";
export type { AppDeps } from "./types.ts";
export { Workspace } from "./workspace.ts";

/** The app is a factory so tests can inject a local JWKS. Production uses the default export. */
export function createApp(deps: AppDeps = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requestId, securityHeaders, accessLog);
  app.onError(onError);
  // Signed machine calls (workers/ops, workers/mcp). Before v1 so they skip Access auth and the 32 KB body limit.
  app.route("/v1/internal/ops", opsInternalRoutes(deps));
  app.route("/v1", v1Routes(deps));
  app.route("/auth", authRoutes(deps));
  app.route("/scim/v2", scimRoutes(deps));
  // Service-to-service only (signed with CONNECTOR_HMAC_KEY). Not part of the public API.
  app.route("/internal/connector", connectorRoutes());
  // Everything that is not the API is the static SPA. Only GET and HEAD reach it.
  app.on(["GET", "HEAD"], "*", (c) => c.env.ASSETS.fetch(c.req.raw));
  app.all("*", (c) => c.json({ error: "method_not_allowed" }, 405));
  return app;
}

export default createApp();
