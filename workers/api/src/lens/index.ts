// v8 page lens, Who knows, search and pulse. Mounted once in ../routes.ts, after authentication.

import { Hono } from "hono";
import { peopleRoutes } from "../people/routes.ts";
import { pulseRoutes } from "../pulse/routes.ts";
import { search2Routes } from "../search2/routes.ts";
import type { AppDeps, AppEnv } from "../types.ts";
import { lensRoutes } from "./routes.ts";

export function lensMount(deps: AppDeps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  // "/brains/overview" style fixed paths stay with brainsRoutes; these are all longer or distinct.
  r.route("/", lensRoutes(deps));
  r.route("/", peopleRoutes(deps));
  r.route("/", search2Routes(deps));
  r.route("/", pulseRoutes(deps));
  return r;
}
