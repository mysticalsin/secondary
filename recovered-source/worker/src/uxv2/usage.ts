// GET /v1/usage?period=7d|30d: the person's own tokens, runs, answers and index-first savings, by
// capability. Admins also get the tenant view (every person's use together, numbers only).

import { Hono } from "hono";
import { viewOf } from "../auth.ts";
import { personalScope } from "../scope.ts";
import type { AppEnv } from "../types.ts";
import { sess } from "../ux/util.ts";
import { readUsage, TENANT_USAGE_SCOPE } from "./ledger.ts";
import { badRequest, isAdmin } from "./shared.ts";

const PERIODS: Record<string, number> = { "7d": 7, "30d": 30 };

export function usageRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get("/usage", async (c) => {
    const s = sess(c);
    const period = c.req.query("period") ?? "7d";
    const days = PERIODS[period];
    if (!days) throw badRequest("invalid_period");
    const me = await readUsage(c.env, s.tenantId, personalScope(s.principal.id), s.ctx.now, days);
    const { byCapability, ...mine } = me;
    const body: Record<string, unknown> = { me: mine, byCapability };
    // The tenant view is for admins only: for everyone else the key is absent, not empty.
    if (isAdmin(viewOf(s))) {
      const t = await readUsage(c.env, s.tenantId, TENANT_USAGE_SCOPE, s.ctx.now, days);
      body.tenant = t;
    }
    return c.json(body);
  });

  return r;
}
