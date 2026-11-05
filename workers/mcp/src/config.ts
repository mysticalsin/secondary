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

export function allowedRedirectHosts(env: Env): Set<string> {
  return new Set(
    (env.ALLOWED_REDIRECT_HOSTS ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** https only, except plain http on a loopback host (Claude Code, MCP Inspector). Fails closed on anything unparsable. */
export function isRedirectAllowed(redirectUri: string, hosts: Set<string>): boolean {
  let u: URL;
  try {
    u = new URL(redirectUri);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase();
  if (!hosts.has(host)) return false;
  if (u.protocol === "https:") return true;
  return u.protocol === "http:" && LOOPBACK_HOSTS.has(host);
}

/** Canonical origin of this server: the pinned MCP_PUBLIC_URL, or the request origin in dev only. */
export function publicBase(env: Env, request: Request): string | null {
  const pinned = (env.MCP_PUBLIC_URL ?? "").trim().replace(/\/+$/, "");
  if (pinned) return pinned;
  return isDev(env) ? new URL(request.url).origin : null;
}
