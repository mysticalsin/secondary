// Review desk (docs/DESIGN-V8-AMAZING.md section 1). Mounted once in ../routes.ts, after authentication.

import { Hono } from "hono";
import type { AppDeps, AppEnv } from "../types.ts";
import { reviewRoutes } from "./routes.ts";

export function reviewDeskRoutes(deps: AppDeps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.route("/", reviewRoutes(deps));
  return r;
}
