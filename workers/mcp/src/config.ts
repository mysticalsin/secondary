export const SCOPES = [
  "secondary.read",
  "secondary.personal.write",
  "secondary.contribute",
] as const;
export type Scope = (typeof SCOPES)[number];

/** Needed for any access. Clients request it first; write tools need it plus their own scope. */
export const BASELINE_SCOPES: Scope[] = ["secondary.read"];

export const SCOPE_LABELS: Record<Scope, string> = {
  "secondary.read":
    "Read the Company Map, nodes, accounts and review queue that you can already see",
  "secondary.personal.write": "Save notes to your private Personal Brain",
  "secondary.contribute":
    "Propose a personal item or a wiki page to a Company scope (it only enters review)",
};

export const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);

/** Props the OAuth provider stores (encrypted) with each grant and hands back on every MCP call. */
export interface AuthProps extends Record<string, unknown> {
  /** Opaque Access subject. */
  userId: string;
  email: string;
  /** Dev only. */
  persona?: string;
}

export function isDev(env: Env): boolean {
  return (env.ENVIRONMENT as string) === "dev";
}

/** One allowed redirect URI: an exact path, or a path prefix when the entry ends with `*`. */
export interface RedirectRule {
  protocol: "https:" | "http:";
  host: string;
  path: string;
  prefix: boolean;
}

/**
 * ALLOWED_REDIRECT_URIS, comma separated. Each entry is a full URL: `https://claude.ai/api/mcp/auth_callback`
 * matches that path only, `https://chatgpt.com/connector/oauth/*` matches the path prefix. Loopback hosts
 * (`http://localhost/*`) accept any port. A host alone is not enough: any tenant of a shared host could
 * register a callback there (B1 L3). Entries that do not parse, or that allow plain http off loopback, are dropped.
 */
export function allowedRedirects(env: Env): RedirectRule[] {
  return (env.ALLOWED_REDIRECT_URIS ?? "").split(",").flatMap((raw) => {
    const entry = raw.trim();
    if (!entry) return [];
    const prefix = entry.endsWith("*");
    let u: URL;
    try {
      u = new URL(prefix ? entry.slice(0, -1) : entry);
    } catch {
      return [];
    }
    const host = u.hostname.toLowerCase();
    if (u.protocol !== "https:" && !(u.protocol === "http:" && LOOPBACK_HOSTS.has(host))) return [];
    if (u.username || u.password || u.search || u.hash) return [];
    return [{ protocol: u.protocol, host, path: u.pathname, prefix }];
  });
}

/**
 * The redirect URI must match a rule on scheme, host and path. https only, except plain http on a loopback
 * host (Claude Code, MCP Inspector). A port is accepted on loopback only; credentials and fragments never.
 * Fails closed on anything unparsable. The URL parser has already resolved dot segments, so `..` cannot
 * climb out of a prefix.
 */
export function isRedirectAllowed(redirectUri: string, rules: RedirectRule[]): boolean {
  let u: URL;
  try {
    u = new URL(redirectUri);
  } catch {
    return false;
  }
  if (u.username || u.password || u.hash) return false;
  const host = u.hostname.toLowerCase();
  if (u.port && !LOOPBACK_HOSTS.has(host)) return false;
  return rules.some(
    (r) =>
      r.protocol === u.protocol &&
      r.host === host &&
      (r.prefix ? u.pathname.startsWith(r.path) : u.pathname === r.path),
  );
}

/** Canonical origin of this server: the pinned MCP_PUBLIC_URL, or the request origin in dev only. */
export function publicBase(env: Env, request: Request): string | null {
  const pinned = (env.MCP_PUBLIC_URL ?? "").trim().replace(/\/+$/, "");
  if (pinned) return pinned;
  return isDev(env) ? new URL(request.url).origin : null;
}
