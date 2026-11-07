/**
 * NEW RECONSTRUCTION route policy for the protected-dev edge.
 * Not a recovered route table. /harness and fixture impersonation are closed.
 */

const MCP = new Set(["/mcp", "/authorize", "/token", "/register"]);

export function releaseDecision(pathname, mode) {
  if (mode !== "protected-dev") return { kind: "closed", status: 503, reason: "release_mode" };
  if (pathname.startsWith("/harness/") || pathname === "/harness") {
    return { kind: "deny", status: 404, reason: "harness_closed" };
  }
  if (
    pathname === "/settings/observability/session" ||
    pathname === "/settings/observability/usage" ||
    pathname === "/reconstruction/import/session"
  ) {
    return { kind: "deny", status: 404, reason: "fixture_closed" };
  }
  if (pathname.startsWith("/.well-known/") || MCP.has(pathname)) return { kind: "mcp", auth: "oauth" };
  if (pathname === "/settings/observability" || pathname === "/reconstruction/import") {
    return { kind: "browser", auth: "jwt" };
  }
  if (pathname === "/favicon.ico") return { kind: "asset", auth: "none" };
  return { kind: "deny", status: 404, reason: "unknown_route" };
}

export const DEV_IDENTITY_HEADERS = ["x-dev-email", "x-dev-persona", "x-demo-persona", "x-user-email"];
