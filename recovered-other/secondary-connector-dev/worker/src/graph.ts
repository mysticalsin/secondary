// Microsoft Graph client, app-only (client credentials) for Sites.Selected.
// - Disabled unless tenant id, client id and client secret are all set.
// - Only /drives and /sites paths on graph.microsoft.com. Calendar, users and groups are refused here:
//   Calendars.Read as an app permission is tenant-wide, so calendar is delegated-only (calendar.ts).
// - 429 and 503 honour Retry-After: short waits happen inline, long ones surface as GraphThrottledError
//   so the sync can save its place and the Workflow can sleep.
// - Never logs or returns tokens, secrets, URLs with query strings or response bodies.

export const GRAPH_ORIGIN = "https://graph.microsoft.com";
export const GRAPH_BASE = `${GRAPH_ORIGIN}/v1.0`;
const ALLOWED_PATH = /^\/(drives|sites)\/[^?#]*(\?.*)?$/;

export class GraphDisabledError extends Error {
  constructor() {
    super("graph_disabled");
  }
}
export class GraphThrottledError extends Error {
  retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super("graph_throttled");
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
/** 410 on a delta link: the cursor is no longer valid and a full resync is required. */
export class GraphGoneError extends Error {
  constructor() {
    super("graph_gone");
  }
}
export class GraphHttpError extends Error {
  status: number;
  constructor(status: number) {
    super(`graph_http_${status}`);
    this.status = status;
  }
}
export class GraphAuthError extends Error {
  constructor() {
    super("graph_auth_failed");
  }
}

export interface GraphLike {
  getJson<T = unknown>(pathOrLink: string): Promise<T>;
  /** Pre-authenticated download URL from a drive item. Returns null when the file is larger than `maxBytes`. */
  getBytes(url: string, maxBytes: number): Promise<Uint8Array | null>;
}

export interface GraphOptions {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Attempts after the first for 429/503/504. Default 3. */
  maxRetries?: number;
  /** Longest Retry-After waited inline, seconds. Default 10. */
  maxInlineWaitSeconds?: number;
}

const TENANT = /^[A-Za-z0-9.-]{3,100}$/;
const CLIENT = /^[A-Za-z0-9-]{8,64}$/;

/** A client, or null when any of the three settings is missing or malformed (the connector is then disabled). */
export function graphFromEnv(
  env: Partial<Pick<Env, "GRAPH_TENANT_ID" | "GRAPH_CLIENT_ID" | "GRAPH_CLIENT_SECRET">>,
  extra: Partial<GraphOptions> = {},
): GraphClient | null {
  const tenantId = env.GRAPH_TENANT_ID?.trim();
  const clientId = env.GRAPH_CLIENT_ID?.trim();
  const clientSecret = env.GRAPH_CLIENT_SECRET;
  if (!tenantId || !clientId || !clientSecret) return null;
  if (!TENANT.test(tenantId) || !CLIENT.test(clientId)) return null;
  return new GraphClient({ tenantId, clientId, clientSecret, ...extra });
}

export class GraphClient implements GraphLike {
  private token: { value: string; expiresAt: number } | null = null;
  private readonly f: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  private readonly o: GraphOptions;

  constructor(o: GraphOptions) {
    this.o = o;
    this.f = o.fetch ?? ((input, init) => fetch(input, init));
    this.now = o.now ?? Date.now;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private async accessToken(force = false): Promise<string> {
    if (!force && this.token && this.token.expiresAt - 60_000 > this.now()) return this.token.value;
    const body = new URLSearchParams({
      client_id: this.o.clientId,
      client_secret: this.o.clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    });
    let res: Response;
    try {
      res = await this.f(
        `https://login.microsoftonline.com/${encodeURIComponent(this.o.tenantId)}/oauth2/v2.0/token`,
        { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } },
      );
    } catch {
      throw new GraphAuthError();
    }
    if (!res.ok) throw new GraphAuthError();
    const j = (await res.json().catch(() => null)) as {
      access_token?: unknown;
      expires_in?: unknown;
    } | null;
    if (!j || typeof j.access_token !== "string") throw new GraphAuthError();
    const ttl = typeof j.expires_in === "number" ? j.expires_in : 3600;
    this.token = { value: j.access_token, expiresAt: this.now() + ttl * 1000 };
    return j.access_token;
  }

  private resolve(pathOrLink: string): string {
    if (pathOrLink.startsWith("/")) {
      if (!ALLOWED_PATH.test(pathOrLink)) throw new Error("graph_path_not_allowed");
      return `${GRAPH_BASE}${pathOrLink}`;
    }
    // A nextLink or deltaLink. Stored links are re-checked: same host, v1.0, drives or sites only.
    let u: URL;
    try {
      u = new URL(pathOrLink);
    } catch {
      throw new Error("graph_link_invalid");
    }
    const rel = u.pathname.startsWith("/v1.0") ? u.pathname.slice(5) : "";
    if (u.origin !== GRAPH_ORIGIN || !ALLOWED_PATH.test(rel)) throw new Error("graph_link_invalid");
    return u.toString();
  }

  async getJson<T = unknown>(pathOrLink: string): Promise<T> {
    const url = this.resolve(pathOrLink);
    const max = this.o.maxRetries ?? 3;
    const inline = (this.o.maxInlineWaitSeconds ?? 10) * 1000;
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const token = await this.accessToken();
      let res: Response;
      try {
        res = await this.f(url, { headers: { Authorization: `Bearer ${token}` } });
      } catch {
        if (attempt < max) {
          await this.sleep(Math.min(1000 * 2 ** attempt, inline));
          continue;
        }
        throw new GraphHttpError(0);
      }
      if (res.ok) return (await res.json()) as T;
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        await this.accessToken(true);
        continue;
      }
      if (res.status === 410) throw new GraphGoneError();
      if (res.status === 429 || res.status === 503 || res.status === 504) {
        const header = Number(res.headers.get("Retry-After"));
        const waitS = Number.isFinite(header) && header > 0 ? header : 2 ** attempt;
        if (attempt < max && waitS * 1000 <= inline) {
          await this.sleep(waitS * 1000);
          continue;
        }
        throw new GraphThrottledError(Math.ceil(waitS));
      }
      throw new GraphHttpError(res.status);
    }
  }

  async getBytes(url: string, maxBytes: number): Promise<Uint8Array | null> {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    // Pre-authenticated URL: no Authorization header. https only, no IP literals or localhost.
    if (u.protocol !== "https:" || /^[\d.]+$|^\[|^localhost$/i.test(u.hostname)) return null;
    const res = await this.f(u.toString());
    if (!res.ok || !res.body) throw new GraphHttpError(res.status);
    const len = Number(res.headers.get("Content-Length"));
    if (Number.isFinite(len) && len > maxBytes) return null;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.byteLength;
    }
    return out;
  }
}
