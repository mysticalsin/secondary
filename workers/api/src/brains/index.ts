// v3 brains (docs/DESIGN-BRAINS-V3.md). Mounted once in ../routes.ts, after authentication.

import { Hono } from "hono";
import type { AppDeps, AppEnv } from "../types.ts";
import { agentRoutes } from "./agents.ts";
import { dataRoutes } from "./data.ts";
import { brainRoutes } from "./routes.ts";

export function brainsRoutes(deps: AppDeps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.route("/", brainRoutes(deps));
  r.route("/", dataRoutes(deps));
  r.route("/", agentRoutes(deps));
  return r;
}
