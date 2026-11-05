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

const jsonLimit = bodyLimit({
  maxSize: MAX_BODY_BYTES,
  onError: (c) => c.json({ error: "payload_too_large" }, 413),
});
/** Brain imports carry an archive: the one route with a larger body, and a binary content type. */
export const IMPORT_BODY_BYTES = 5 * 1024 * 1024;
const importLimit = bodyLimit({
  maxSize: IMPORT_BODY_BYTES,
  onError: (c) => c.json({ error: "too_large", reason: "The archive is larger than 5 MB" }, 413),
});
const isImport = (c: Context<AppEnv>): boolean =>
  c.req.method === "POST" && /^\/v1\/brains\/[^/]+\/import$/.test(new URL(c.req.url).pathname);
export const limitBody: MiddlewareHandler<AppEnv> = (c, next) =>
  isImport(c) ? importLimit(c, next) : jsonLimit(c, next);

/**
 * Mutations need a JSON content type (which a cross-site form cannot send without a CORS
 * preflight, and there is no CORS) and must come from this origin when a browser says where from.
 * Browsers always send Sec-Fetch-Site; a sibling subdomain is "same-site", not "same-origin", and
 * a body-less POST needs no content type, so same-site is refused too (L-03). Callers that are
 * not browsers (service bindings, scripts) send neither header and are authenticated by other means.
 */
export const mutationGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const m = c.req.method;
  if (m !== "GET" && m !== "HEAD" && m !== "OPTIONS") {
    const site = c.req.header("Sec-Fetch-Site");
    if (site && site !== "same-origin" && site !== "none")
      return c.json({ error: "forbidden" }, 403);
    const origin = c.req.header("Origin");
    if (origin && origin !== new URL(c.req.url).origin) return c.json({ error: "forbidden" }, 403);
    const hasBody = c.req.header("Content-Length") !== "0" && c.req.raw.body !== null;
    const type = (c.req.header("Content-Type") ?? "").toLowerCase();
    // An import is an archive. It still has to come from this origin (checked above); the route
    // validates the bytes. A form post cannot send these types without a CORS preflight either.
    const okType = isImport(c)
      ? /^application\/(?:zip|json|octet-stream|x-zip-compressed)/.test(type)
      : type.startsWith("application/json");
    if (hasBody && !okType) return c.json({ error: "unsupported_media_type" }, 415);
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
