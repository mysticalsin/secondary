// Request logging and readiness. One JSON line per request: request id, principal hash, route
// pattern, status and latency. No URL, no query, no headers, no body, no email, no token.

import type { Context, MiddlewareHandler } from "hono";
import { logEvent, principalHash } from "../../../packages/contracts/src/log.ts";
import { tenantStub } from "./stubs.ts";
import type { AppEnv, Session } from "./types.ts";

/** The matched route pattern (for example /v1/nodes/:id), never the concrete path. */
export function routePattern(c: Context<AppEnv>): string {
  const hit = [...c.req.matchedRoutes]
    .reverse()
    .find((r) => r.method !== "ALL" && !r.path.endsWith("*"));
  const path = hit?.path ?? (c.req.path.startsWith("/v1/") ? "/v1/unmatched" : "static");
  return path.startsWith("/v1") ? path : `/v1${path}`;
}

export const accessLog: MiddlewareHandler<AppEnv> = async (c, next) => {
  const t0 = Date.now();
  await next();
  try {
    const s = c.get("session") as Session | undefined;
    logEvent({
      event: "request",
      worker: "api",
      env: c.env.ENVIRONMENT,
      requestId: c.get("requestId"),
      principal: s ? await principalHash(s.principal.id) : null,
      tenant: s?.tenantId ?? null,
      route: routePattern(c),
      method: c.req.method,
      status: c.res.status,
      latencyMs: Date.now() - t0,
    });
  } catch {
    // Logging never changes the response.
  }
};

// ---- readiness ----

const CHECK_TIMEOUT_MS = 2_000;
const CACHE_MS = 5_000;
let cached: { at: number; body: ReadyBody } | null = null;
type ReadyBody = { ready: boolean; checks: { do: "ok" | "fail"; r2: "ok" | "fail" } };

const within = async (p: Promise<unknown>): Promise<"ok" | "fail"> => {
  try {
    await Promise.race([
      p,
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), CHECK_TIMEOUT_MS)),
    ]);
    return "ok";
  } catch {
    return "fail";
  }
};

/** Durable Object and R2 reachability. Read-only, no data returned, cached for 5 seconds. */
export async function readiness(env: Env, now = Date.now()): Promise<ReadyBody> {
  if (cached && now - cached.at < CACHE_MS) return cached.body;
  const [d, r] = await Promise.all([
    within(Promise.resolve().then(() => tenantStub(env, env.DEFAULT_TENANT_ID).epoch())),
    within(Promise.resolve().then(() => env.BLOBS.head("__ready__"))),
  ]);
  const body: ReadyBody = { ready: d === "ok" && r === "ok", checks: { do: d, r2: r } };
  cached = { at: now, body };
  if (!body.ready)
    logEvent({ event: "not_ready", worker: "api", env: env.ENVIRONMENT, check: `do=${d} r2=${r}` });
  return body;
}

/** Test seam: forget the cached answer. */
export const resetReadinessCache = (): void => {
  cached = null;
};
