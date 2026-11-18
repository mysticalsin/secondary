export const GRAPH_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Cache-Control": "no-store",
};

export const GRAPH_NAV =
  '<link rel="stylesheet" href="/graph/nav.css"><script src="/graph/nav.js" defer></script>';

export const API_PREFIXES = ["/v1/", "/auth/", "/scim/", "/internal/", "/graph/"] as const;

export type GraphFiles = Readonly<Record<string, readonly [string, string]>>;

export function appendNav(response: Response): Response {
  return new HTMLRewriter()
    .on("head", {
      element(el) {
        el.append(GRAPH_NAV, { html: true });
      },
    })
    .transform(response);
}

export async function graphFetch(
  request: Request,
  files: GraphFiles,
  inner: (request: Request) => Response | Promise<Response>,
  rewrite: (response: Response) => Response = appendNav,
): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method;
  if (method === "GET" || method === "HEAD") {
    const path = url.pathname === "/graph/" ? "/graph" : url.pathname;
    const file = Object.prototype.hasOwnProperty.call(files, path) ? files[path] : undefined;
    if (file) {
      return new Response(method === "HEAD" ? null : file[0], {
        status: 200,
        headers: { ...GRAPH_HEADERS, "Content-Type": file[1] },
      });
    }
  }
  const page =
    method === "GET" &&
    !API_PREFIXES.some((prefix) => url.pathname.startsWith(prefix)) &&
    (request.headers.get("Accept") || "").includes("text/html");
  let next = request;
  if (page && (request.headers.has("If-None-Match") || request.headers.has("If-Modified-Since"))) {
    const headers = new Headers(request.headers);
    headers.delete("If-None-Match");
    headers.delete("If-Modified-Since");
    next = new Request(request, { headers });
  }
  const response = await inner(next);
  if (
    method !== "GET" ||
    response.status !== 200 ||
    API_PREFIXES.some((prefix) => url.pathname.startsWith(prefix)) ||
    !(response.headers.get("Content-Type") || "").includes("text/html")
  ) {
    return response;
  }
  const out = rewrite(response);
  const headers = new Headers(out.headers);
  headers.delete("ETag");
  headers.delete("Last-Modified");
  headers.set("Cache-Control", "no-cache");
  return new Response(out.body, { status: out.status, statusText: out.statusText, headers });
}
