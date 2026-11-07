// UX routes added in B2: Personal Brain editing and history, drafts, preferences, review detail,
// account records and the attention list. Mounted once in ../routes.ts, after authentication.

import { Hono } from "hono";
import type { AppDeps, AppEnv } from "../types.ts";
import { personalRoutes } from "./personal.ts";
import { recordRoutes } from "./records.ts";
import { reviewRoutes } from "./review.ts";

export function uxRoutes(_deps: AppDeps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.route("/", personalRoutes());
  r.route("/", recordRoutes());
  r.route("/", reviewRoutes());
  return r;
}
