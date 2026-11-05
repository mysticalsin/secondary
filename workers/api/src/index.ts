import { Hono } from "hono";
import { v1Routes } from "./routes.ts";
import { onError, requestId, securityHeaders } from "./security.ts";
import type { AppDeps, AppEnv } from "./types.ts";

export { TenantPolicy } from "./tenant-policy.ts";
export type { AppDeps } from "./types.ts";
export { Workspace } from "./workspace.ts";

/** The app is a factory so tests can inject a local JWKS. Production uses the default export. */
export function createApp(deps: AppDeps = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requestId, securityHeaders);
  app.onError(onError);
  app.route("/v1", v1Routes(deps));
  // Everything that is not the API is the static SPA. Only GET and HEAD reach it.
  app.on(["GET", "HEAD"], "*", (c) => c.env.ASSETS.fetch(c.req.raw));
  app.all("*", (c) => c.json({ error: "method_not_allowed" }, 405));
  return app;
}

export default createApp();
