import { Hono } from "hono";

export { TenantPolicy } from "./tenant-policy.ts";
export { Workspace } from "./workspace.ts";

const app = new Hono<{ Bindings: Env }>();

app.get("/v1/health", (c) => {
  c.header("Cache-Control", "no-store");
  return c.json({ ok: true, environment: c.env.ENVIRONMENT });
});

export default app;
