/**
 * NEW RECONSTRUCTION route policy for the protected-dev edge.
 * Not a recovered route table. /harness and fixture impersonation are closed.
 */

const MCP = new Set(["/mcp", "/authorize", "/token", "/register"]);

export function canonicalPath(pathname) {
  let path = pathname;
  for (let i = 0; i < 2; i += 1) {
    try {
      const decoded = decodeURIComponent(path);
      if (decoded === path) break;
      path = decoded;
    } catch {
      break;
    }
  }
  path = path.replace(/\/+/g, "/");
  const parts = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`.toLowerCase();
}

export function releaseDecision(pathname, mode) {
  const path = canonicalPath(pathname);
  if (mode !== "protected-dev") return { kind: "closed", status: 503, reason: "release_mode" };
  if (path === "/harness" || path.startsWith("/harness/")) {
    return { kind: "deny", status: 404, reason: "harness_closed" };
  }
  if (
    path === "/settings/observability/session" ||
    path === "/settings/observability/usage" ||
    path === "/reconstruction/import/session"
  ) {
    return { kind: "deny", status: 404, reason: "fixture_closed" };
  }
  if (path.startsWith("/.well-known/") || MCP.has(path)) return { kind: "mcp", auth: "oauth" };
  if (path === "/settings/observability" || path === "/reconstruction/import" || path === "/" || path === "/settings" || path === "/settings/profile") {
    return { kind: "browser", auth: "jwt" };
  }
  if (path === "/favicon.ico" || path.startsWith("/assets/")) return { kind: "asset", auth: "none" };
  return { kind: "deny", status: 404, reason: "unknown_route" };
}

export const DEV_IDENTITY_HEADERS = ["x-dev-email", "x-dev-persona", "x-demo-persona", "x-user-email"];
