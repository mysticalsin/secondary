// Second Brain graph view. Serves /graph and adds a Graph view link to the app's HTML pages.
// Every other request goes to the unchanged app module.
import app from "./index.js";
export * from "./index.js";

const FILES = "__FILES__";
const HEADERS = {
  "Content-Security-Policy": "__CSP__",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Cache-Control": "no-store",
};
const NAV = '<link rel="stylesheet" href="/graph/nav.css"><script src="/graph/nav.js" defer></script>';
const API_PREFIXES = ["/v1/", "/auth/", "/scim/", "/internal/", "/graph/"];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;
    if (method === "GET" || method === "HEAD") {
      const path = url.pathname === "/graph/" ? "/graph" : url.pathname;
      const file = Object.prototype.hasOwnProperty.call(FILES, path) ? FILES[path] : null;
      if (file) {
        return new Response(method === "HEAD" ? null : file[0], {
          status: 200,
          headers: { ...HEADERS, "Content-Type": file[1] },
        });
      }
    }
    const page =
      method === "GET" &&
      !API_PREFIXES.some((p) => url.pathname.startsWith(p)) &&
      (request.headers.get("Accept") || "").includes("text/html");
    let inner = request;
    if (page && (request.headers.has("If-None-Match") || request.headers.has("If-Modified-Since"))) {
      // A cached copy from before this wrapper would come back as 304 without the Graph view link.
      const headers = new Headers(request.headers);
      headers.delete("If-None-Match");
      headers.delete("If-Modified-Since");
      inner = new Request(request, { headers });
    }
    const response = await app.fetch(inner, env, ctx);
    if (
      method !== "GET" ||
      response.status !== 200 ||
      API_PREFIXES.some((p) => url.pathname.startsWith(p)) ||
      !(response.headers.get("Content-Type") || "").includes("text/html")
    ) {
      return response;
    }
    const out = new HTMLRewriter()
      .on("head", { element(el) { el.append(NAV, { html: true }); } })
      .transform(response);
    const headers = new Headers(out.headers);
    headers.delete("ETag");
    headers.delete("Last-Modified");
    headers.set("Cache-Control", "no-cache");
    return new Response(out.body, { status: out.status, statusText: out.statusText, headers });
  },
};
