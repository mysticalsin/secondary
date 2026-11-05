import { type InternalPrincipal, signInternalRequest } from "./internal-auth.ts";

export interface Caller {
  sub: string;
  email: string;
  persona?: string;
  clientId: string;
  scopes: string[];
}

export type ApiResult<T = unknown> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string };

const API_ORIGIN = "https://api.internal";

/** Calls workers/api over the service binding as `caller`. Signs every request; never forwards the OAuth token. */
export class ApiClient {
  private readonly env: Env;
  private readonly caller: Caller;
  private readonly tool: string;

  constructor(env: Env, caller: Caller, tool: string) {
    this.env = env;
    this.caller = caller;
    this.tool = tool;
  }

  private async send<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<ApiResult<T>> {
    const secret = this.env.INTERNAL_HMAC_KEY;
    if (!secret) return { ok: false, status: 503, error: "service_auth_unconfigured" };
    const url = `${API_ORIGIN}${path}`;
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const principal: InternalPrincipal = {
      v: 1,
      iss: "secondary-mcp",
      aud: "secondary-api",
      sub: this.caller.sub,
      email: this.caller.email,
      ...(this.caller.persona ? { persona: this.caller.persona } : {}),
      client_id: this.caller.clientId,
      scope: this.caller.scopes,
      tool: this.tool,
    };
    let headers: Record<string, string>;
    try {
      headers = await signInternalRequest({
        secret,
        kid: this.env.INTERNAL_HMAC_KID,
        method,
        url,
        body: payload,
        principal,
      });
    } catch {
      return { ok: false, status: 503, error: "service_auth_unconfigured" };
    }
    let res: Response;
    try {
      res = await this.env.API.fetch(url, {
        method,
        headers: {
          ...headers,
          accept: "application/json",
          ...(payload === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(payload === undefined ? {} : { body: payload }),
      });
    } catch {
      return { ok: false, status: 502, error: "api_unreachable" };
    }
    if (!res.ok) {
      // 401 here means our service auth was refused: say so generically, not what the API said.
      if (res.status === 401) return { ok: false, status: 502, error: "service_auth_failed" };
      let reason = `api_${res.status}`;
      try {
        const j = (await res.json()) as { reason?: unknown };
        if (typeof j.reason === "string") reason = j.reason.slice(0, 200);
      } catch {}
      return { ok: false, status: res.status, error: reason };
    }
    try {
      return { ok: true, status: res.status, data: (await res.json()) as T };
    } catch {
      return { ok: false, status: 502, error: "api_bad_response" };
    }
  }

  get<T = unknown>(path: string): Promise<ApiResult<T>> {
    return this.send("GET", path);
  }

  post<T = unknown>(path: string, body: unknown): Promise<ApiResult<T>> {
    return this.send("POST", path, body);
  }
}

export const q = encodeURIComponent;
