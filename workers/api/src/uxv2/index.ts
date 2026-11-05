// UX v2 API (docs/DESIGN-UX-V2.md, docs/API-CONTRACT.md "UX v2 endpoints"). Mounted once in ../routes.ts,
// after authentication. Every route builds the caller's admitted view first and answers only from it.

import { Hono } from "hono";
import type { AppDeps, AppEnv } from "../types.ts";
import { askRoutes } from "./ask.ts";
import { exportRoutes } from "./export.ts";
import { questionRoutes } from "./questions.ts";
import { routineRoutes } from "./routines.ts";
import { treeRoutes } from "./tree.ts";
import { usageRoutes } from "./usage.ts";

export function uxv2Routes(deps: AppDeps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.route("/", askRoutes(deps));
  r.route("/", treeRoutes());
  r.route("/", questionRoutes());
  r.route("/", routineRoutes(deps));
  r.route("/", usageRoutes());
  r.route("/", exportRoutes());
  return r;
}
