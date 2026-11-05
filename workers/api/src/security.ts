// Security headers, request limits, error handling. Same origin only: there is no CORS.

import type { Context, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { logEvent } from "../../../packages/contracts/src/log.ts";
import type { AppEnv } from "./types.ts";

export const MAX_BODY_BYTES = 32 * 1024;

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const STATIC_HEADERS: Record<string, string> = {
  "Content-Security-Policy": CSP,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

/** Sets the security headers on every response and `Cache-Control: no-store` on /v1/*. */
export const securityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  try {
    c.res.headers.set("X-Content-Type-Options", "nosniff");
  } catch {
    // Responses from a fetcher (static assets) have immutable headers: replace with a mutable copy.
    c.res = new Response(c.res.body, c.res);
  }
  for (const [k, v] of Object.entries(STATIC_HEADERS)) c.res.headers.set(k, v);
  const path = new URL(c.req.url).pathname;
  if (path.startsWith("/v1/") || path.startsWith("/internal/"))
    c.res.headers.set("Cache-Control", "no-store");
};

export const limitBody = bodyLimit({
  maxSize: MAX_BODY_BYTES,
  onError: (c) => c.json({ error: "payload_too_large" }, 413),
});

/**
 * Mutations need a JSON content type (which a cross-site form cannot send without a CORS
 * preflight, and there is no CORS) and must not be flagged cross-site by the browser.
 */
export const mutationGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const m = c.req.method;
  if (m !== "GET" && m !== "HEAD" && m !== "OPTIONS") {
    if (c.req.header("Sec-Fetch-Site") === "cross-site") return c.json({ error: "forbidden" }, 403);
    const hasBody = c.req.header("Content-Length") !== "0" && c.req.raw.body !== null;
    if (
      hasBody &&
      !(c.req.header("Content-Type") ?? "").toLowerCase().startsWith("application/json")
    )
      return c.json({ error: "unsupported_media_type" }, 415);
  }
  await next();
};

/** Never leaks stack traces or messages: the client gets a request id, the log gets the cause. */
export function onError(err: unknown, c: Context<AppEnv>): Response {
  const requestId = c.get("requestId") ?? crypto.randomUUID();
  // Our own HTTPExceptions carry a short error code as the message. Nothing else is echoed.
  if (err instanceof HTTPException) return c.json({ error: err.message || "error" }, err.status);
  // Server-side log only, through the structured logger: error class and a redacted, truncated message.
  logEvent({
    event: "error",
    worker: "api",
    requestId,
    errorName: err instanceof Error ? err.name : "unknown",
    reason: err instanceof Error ? err.message : String(err),
  });
  return c.json({ error: "internal_error", requestId }, 500);
}

export const requestId: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("requestId", crypto.randomUUID());
  await next();
};

/** Constant-time string equality (no early exit on the first differing byte). */
export function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}
