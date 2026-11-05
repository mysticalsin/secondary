// The public worker for Landing Page Studio pages (docs/DESIGN-LP-STUDIO.md).
//   GET  /p/:slug     the published static page, with a strict CSP and noindex
//   POST /p/:slug/e   one privacy-friendly event, counted only when the visitor consented
// Its bindings are the pages bucket and the per-page counter, nothing else: it cannot read the brain.
// A page exists only while its object is in the bucket and has not expired. Unpublishing deletes the
// object, so the next request answers 404. No cookie is set, no address is stored.

import { type CountKey, PageCounter } from "./counter.ts";

export { PageCounter };

const SLUG = /^[0-9a-f]{32}$/;
const MAX_EVENT_BYTES = 256;
const PAGE_KEY = (slug: string): string => `p/${slug}.html`;

const BASE_HEADERS: Record<string, string> = {
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
};

const notFound = (): Response =>
  new Response("Not found", {
    status: 404,
    headers: { ...BASE_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
  });

const sha256b64 = async (s: string): Promise<string> => {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  let bin = "";
  for (const b of d) bin += String.fromCharCode(b);
  return btoa(bin);
};

/** The page has only inline style and script. Each is allowed by its own hash, nothing else runs. */
async function csp(html: string): Promise<string> {
  const hashes: Record<string, string[]> = { script: [], style: [] };
  for (const m of html.matchAll(/<(script|style)\b[^>]*>([\s\S]*?)<\/\1>/gi))
    hashes[(m[1] as string).toLowerCase()]?.push(`'sha256-${await sha256b64(m[2] as string)}'`);
  return [
    "default-src 'none'",
    `script-src ${hashes.script?.join(" ") || "'none'"}`,
    `style-src ${hashes.style?.join(" ") || "'none'"}`,
    "img-src 'self'",
    "connect-src 'self'",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** A page is live while its object exists and its expiry (epoch ms in the object metadata) is ahead. */
function expired(meta: Record<string, string> | undefined, now: number): boolean {
  const at = Number(meta?.expiresAt);
  return !Number.isFinite(at) || at <= now;
}

const counterOf = (env: Env, slug: string) => {
  // "off" is for the local test runner only: it needs LOCAL_DEV too, so a stray var cannot drop the EU pin.
  const off = (env.DO_JURISDICTION as string) === "off" && env.LOCAL_DEV === "yes";
  const ns = off ? env.COUNTER : env.COUNTER.jurisdiction("eu");
  return ns.get(ns.idFromName(slug));
};

const posInt = (v: string | undefined, fallback: number): number => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
};

// Per visitor limit, kept in memory of this isolate only and keyed by a salted hash that is never
// written anywhere: the address itself is not stored, not even briefly (it is hashed on arrival).
const SALT = crypto.getRandomValues(new Uint8Array(16));
const visitors = new Map<string, { minute: number; n: number }>();
async function visitorLimited(req: Request, slug: string, now: number, max: number) {
  const ip = req.headers.get("CF-Connecting-IP") ?? "";
  const data = new Uint8Array([...SALT, ...new TextEncoder().encode(`${slug}|${ip}`)]);
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  const key = [...h.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const minute = Math.floor(now / 60_000);
  if (visitors.size > 5_000) visitors.clear();
  const cur = visitors.get(key);
  const next = cur && cur.minute === minute ? { minute, n: cur.n + 1 } : { minute, n: 1 };
  visitors.set(key, next);
  return next.n > max;
}

async function servePage(req: Request, env: Env, ctx: ExecutionContext, slug: string) {
  const now = Date.now();
  const obj = await env.PAGES.get(PAGE_KEY(slug));
  if (!obj) return notFound();
  if (expired(obj.customMetadata, now)) {
    ctx.waitUntil(env.PAGES.delete(PAGE_KEY(slug)));
    return notFound();
  }
  const html = await obj.text();
  // A load is a bare count: no visitor input, nothing identifying.
  ctx.waitUntil(
    counterOf(env, slug)
      .count(slug, "load", now, 0)
      .then(() => undefined),
  );
  return new Response(req.method === "HEAD" ? null : html, {
    headers: {
      ...BASE_HEADERS,
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": await csp(html),
    },
  });
}

/** An image copied into the bucket at publish time. It lives and dies with its page. */
async function serveImage(req: Request, env: Env, slug: string, n: string) {
  const obj = await env.PAGES.get(`p/${slug}/i/${n}`);
  if (!obj || expired(obj.customMetadata, Date.now())) return notFound();
  const type = obj.httpMetadata?.contentType ?? "";
  if (!/^image\/(?:png|jpeg|webp)$/.test(type)) return notFound();
  return new Response(req.method === "HEAD" ? null : obj.body, {
    headers: {
      ...BASE_HEADERS,
      "Content-Type": type,
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}

async function takeEvent(req: Request, env: Env, slug: string) {
  const now = Date.now();
  const head = await env.PAGES.head(PAGE_KEY(slug));
  if (!head || expired(head.customMetadata, now)) return notFound();
  // Same origin only: the page's own beacon is the one caller.
  const origin = req.headers.get("Origin");
  if (origin && origin !== new URL(req.url).origin)
    return new Response(null, { status: 403, headers: BASE_HEADERS });
  const declared = Number(req.headers.get("Content-Length") ?? "0");
  if (declared > MAX_EVENT_BYTES) return new Response(null, { status: 413, headers: BASE_HEADERS });
  const raw = (await req.text()).slice(0, MAX_EVENT_BYTES + 1);
  if (raw.length > MAX_EVENT_BYTES)
    return new Response(null, { status: 413, headers: BASE_HEADERS });
  let body: { k?: unknown; b?: unknown; c?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 400, headers: BASE_HEADERS });
  }
  if (!body || typeof body !== "object")
    return new Response(null, { status: 400, headers: BASE_HEADERS });
  // No consent flag, no count: the event is dropped before anything is looked at or written.
  if (body.c !== true) return new Response(null, { status: 204, headers: BASE_HEADERS });
  let key: CountKey;
  if (body.k === "view") key = "view";
  else if (body.k === "cta") key = "cta";
  else if (body.k === "scroll" && [25, 50, 75, 100].includes(body.b as number))
    key = `s${body.b as 25 | 50 | 75 | 100}`;
  else return new Response(null, { status: 400, headers: BASE_HEADERS });
  if (await visitorLimited(req, slug, now, posInt(env.EVENTS_PER_VISITOR_MIN, 20)))
    return new Response(null, { status: 429, headers: { ...BASE_HEADERS, "Retry-After": "60" } });
  const res = await counterOf(env, slug).count(slug, key, now, posInt(env.EVENTS_PER_MIN, 120));
  if (res.limited)
    return new Response(null, { status: 429, headers: { ...BASE_HEADERS, "Retry-After": "60" } });
  return new Response(null, { status: 204, headers: BASE_HEADERS });
}

export default {
  async fetch(req, env, ctx): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/robots.txt")
      return new Response("User-agent: *\nDisallow: /\n", {
        headers: { ...BASE_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
      });
    const m = /^\/p\/([^/]+?)(\/e|\/i\/([0-5]))?$/.exec(url.pathname);
    const slug = m?.[1] ?? "";
    if (!m || !SLUG.test(slug)) return notFound();
    if (m[3]) {
      if (req.method !== "GET" && req.method !== "HEAD")
        return new Response(null, {
          status: 405,
          headers: { ...BASE_HEADERS, Allow: "GET, HEAD" },
        });
      return serveImage(req, env, slug, m[3]);
    }
    if (m[2]) {
      if (req.method !== "POST")
        return new Response(null, { status: 405, headers: { ...BASE_HEADERS, Allow: "POST" } });
      return takeEvent(req, env, slug);
    }
    if (req.method !== "GET" && req.method !== "HEAD")
      return new Response(null, { status: 405, headers: { ...BASE_HEADERS, Allow: "GET, HEAD" } });
    return servePage(req, env, ctx, slug);
  },
} satisfies ExportedHandler<Env>;
