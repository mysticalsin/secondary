// Reading the privacy approver group (Settings, Rules, people who may approve "named approver group:
// privacy"). Setting it is `PUT /v1/rules/groups` in routes.ts. Kept in its own file so the rules routes
// stay as they are. Admins only (404 for anyone else, like the rest of the rules surface) and audited:
// the receipt holds a count, never the people.

import { Hono } from "hono";
import { govClient } from "../admin/client.ts";
import { isConfigure } from "../admin/validate.ts";
import { viewOf } from "../auth.ts";
import type { AppDeps, AppEnv } from "../types.ts";
import { audit, notFound, sess } from "../ux/util.ts";
import { rulesClient } from "./client.ts";

export function groupsViewRoutes(_deps: AppDeps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.get("/rules/groups", async (c) => {
    const s = sess(c);
    if (!isConfigure(viewOf(s).roles)) throw notFound();
    const ids = await rulesClient(c.env, s.tenantId).groupGet();
    const emails = new Map(
      (await govClient(c.env, s.tenantId).principals()).map((p) => [p.id, p.email]),
    );
    if (
      !(await audit(c, {
        action: "rules.groups.read",
        nodeId: null,
        scopeId: null,
        revision: null,
        reason: `${ids.length} members`,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    c.header("Cache-Control", "no-store");
    return c.json({ privacy: ids.map((id) => ({ id, email: emails.get(id) ?? null })) });
  });
  return r;
}
