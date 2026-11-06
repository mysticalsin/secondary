// Knowledge gaps (docs/DESIGN-V8-AMAZING.md section 2). Mounted once in ../routes.ts, after authentication.

import { Hono } from "hono";
import type { AppDeps, AppEnv } from "../types.ts";
import { gapRoutes } from "./routes.ts";

export { recordGaps } from "./capture.ts";

export function gapsRoutes(deps: AppDeps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.route("/", gapRoutes(deps));
  return r;
}
