// Authentication. A request is signed in by a Cloudflare Access JWT (header or cookie) verified
// against the team's JWKS. Two dev-only helpers exist and both are off outside ENVIRONMENT=dev:
// the X-Demo-Persona header and the localhost-only DEV_AUTH_BYPASS_EMAIL.

import { type AdmittedView, admittedView } from "@secondary/policy";
import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";
import { tenantOrg } from "./admin/client.ts";
import { accessAllowed, entraEnabled } from "./auth/config.ts";
import { emailFromSession } from "./auth/identity.ts";
import { SESSION_COOKIE } from "./auth/limits.ts";
import { isUnsafeMethod, sameOrigin } from "./auth/session.ts";
import {
  HEADER_PRINCIPAL,
  HEADER_SIGNATURE,
  HEADER_TIMESTAMP,
  verifyInternalRequest,
} from "./internal-auth.ts";
import { getOrg, isRoleId, makeCtx, personaId, personaPrincipal } from "./org.ts";
import { seedTenant } from "./seed.ts";
import { tenantStub } from "./stubs.ts";
import type { ActAs } from "./tenant-policy.ts";
import type { AppDeps, AppEnv, Session } from "./types.ts";

const TEAM_DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const TENANT_ID = /^[a-z0-9_]{3,64}$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const remote = new Map<string, JWTVerifyGetKey>();
const remoteJwks = (team: string): JWTVerifyGetKey => {
  let k = remote.get(team);
  if (!k) {
    k = createRemoteJWKSet(new URL(`https://${team}/cdn-cgi/access/certs`), {
      cooldownDuration: 30_000,
      cacheMaxAge: 3_600_000,
    });
    remote.set(team, k);
  }
  return k;
};

/** The verified email of an Access JWT, or null for any problem (bad signature, expiry, aud, iss). */
export async function verifyAccessJwt(
  token: string,
  env: Env,
  deps: AppDeps,
): Promise<string | null> {
  const team = env.ACCESS_TEAM_DOMAIN?.trim().toLowerCase();
  const aud = env.ACCESS_AUD?.trim();
  // Fail closed until Access is configured.
  if (!team || !aud || !TEAM_DOMAIN.test(team)) return null;
  try {
    const key = (deps.jwks ?? remoteJwks)(team);
    const { payload } = await jwtVerify(token, key, {
      issuer: `https://${team}`,
      audience: aud,
      algorithms: ["RS256"],
      clockTolerance: 30,
    });
    const email = payload.email;
    if (typeof email !== "string" || email.length > 254 || !email.includes("@")) return null;
    return email.trim().toLowerCase();
  } catch {
    return null;
  }
}

export const isLocalHost = (url: string): boolean => {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
};

/** The local-dev sign-in: dev environment, a configured email, and a localhost request host. */
export const devBypassEmail = (env: Env, url: string): string | null => {
  const email = env.DEV_AUTH_BYPASS_EMAIL?.trim().toLowerCase();
  return env.ENVIRONMENT === "dev" && email && isLocalHost(url) ? email : null;
};

export function tenantFor(email: string, env: Env): string {
  const domain = email.split("@")[1] ?? "";
  let map: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(env.TENANT_DOMAINS || "{}");
    if (parsed && typeof parsed === "object") map = parsed as Record<string, unknown>;
  } catch {
    // A broken mapping falls back to the default tenant.
  }
  const mapped = Object.hasOwn(map, domain) ? map[domain] : undefined;
  const tenant = typeof mapped === "string" ? mapped : env.DEFAULT_TENANT_ID;
  if (!TENANT_ID.test(tenant ?? "")) throw new Error("invalid tenant configuration");
  return tenant as string;
}

const rateLimit = (env: Env): number => {
  const n = Number.parseInt(env.RATE_LIMIT_PER_MIN, 10);
  return Number.isFinite(n) && n > 0 ? n : 600;
};

const READ = "secondary.read";
const INTERNAL_ROUTES: readonly { method: string; path: RegExp; scope: string }[] = [
  { method: "GET", path: /^\/v1\/me$/, scope: READ },
  { method: "GET", path: /^\/v1\/map$/, scope: READ },
  { method: "GET", path: /^\/v1\/nodes\/[^/]+$/, scope: READ },
  { method: "GET", path: /^\/v1\/search$/, scope: READ },
  { method: "GET", path: /^\/v1\/accounts\/[^/]+$/, scope: READ },
  { method: "GET", path: /^\/v1\/governances$/, scope: READ },
  { method: "GET", path: /^\/v1\/review$/, scope: READ },
  { method: "POST", path: /^\/v1\/personal\/items$/, scope: "secondary.personal.write" },
  {
    method: "POST",
    path: /^\/v1\/personal\/items\/[^/]+\/contribute$/,
    scope: "secondary.contribute",
  },
];

/** MCP gets this short list and nothing else: never /v1/actions or /v1/admin/*. */
export function internalRouteVerdict(method: string, path: string, scope: string[]): "ok" | "no" {
  const r = INTERNAL_ROUTES.find((x) => x.method === method && x.path.test(path));
  return r && scope.includes(r.scope) ? "ok" : "no";
}

export const authenticate =
  (deps: AppDeps): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const now = deps.now?.() ?? Date.now();

    // Signed internal call from workers/mcp (service binding). Checked before Access. A present but
    // invalid signature is a 401 and never falls through to Access or to the persona header. The
    // internal headers are refused on public traffic (the edge sets CF-Connecting-IP on it).
    const internalPresent = [HEADER_SIGNATURE, HEADER_PRINCIPAL, HEADER_TIMESTAMP].some(
      (h) => c.req.header(h) !== undefined,
    );
    let internal: Session["internal"] = null;
    let internalPersona: string | undefined;
    let email: string | null = null;
    if (internalPresent) {
      if (c.req.header("CF-Connecting-IP") || c.req.header(HEADER_SIGNATURE) === undefined)
        return c.json({ error: "unauthorized" }, 401);
      const r = await verifyInternalRequest(c.req.raw, c.env.INTERNAL_HMAC_KEY, {
        now: Math.floor(now / 1000),
      });
      if (!r.ok) {
        console.warn(JSON.stringify({ at: "internal_auth", reason: r.reason }));
        return c.json({ error: "unauthorized" }, 401);
      }
      email = r.principal.email.trim().toLowerCase();
      internal = {
        clientId: r.principal.client_id,
        tool: r.principal.tool,
        scope: r.principal.scope,
      };
      internalPersona = r.principal.persona;
      const verdict = internalRouteVerdict(
        c.req.method,
        new URL(c.req.url).pathname,
        internal.scope,
      );
      if (verdict !== "ok")
        return c.json({ error: "forbidden", reason: "Not available to MCP clients" }, 403);
    } else {
      // Entra browser session first (AUTH_MODE entra or both). A bad cookie falls through to Access
      // only in `both`; in `entra` mode nothing else can identify the request.
      const cookie = entraEnabled(c.env) ? getCookie(c, SESSION_COOKIE) : undefined;
      if (cookie) {
        email = await emailFromSession(cookie, c.env, now);
        // CSRF: a session cookie is sent by the browser on its own, so a mutation must come from our origin.
        if (email && isUnsafeMethod(c.req.method) && !sameOrigin(c.req.raw))
          return c.json({ error: "forbidden" }, 403);
      }
      if (!email && accessAllowed(c.env)) {
        const token = c.req.header("Cf-Access-Jwt-Assertion") ?? getCookie(c, "CF_Authorization");
        email = token
          ? await verifyAccessJwt(token, c.env, deps)
          : devBypassEmail(c.env, c.req.url);
      }
    }
    if (!email) return c.json({ error: "unauthorized" }, 401);

    const tenantId = tenantFor(email, c.env);

    // Demo persona: dev only. In any other environment the header is ignored.
    let persona: Session["persona"] = null;
    let actAs: ActAs | null = null;
    // Dev only. Internal calls carry their own persona and never read the header.
    const asked =
      c.env.ENVIRONMENT !== "dev"
        ? undefined
        : internalPresent
          ? internalPersona
          : c.req.header("X-Demo-Persona");
    if (asked !== undefined) {
      if (!isRoleId(asked)) return c.json({ error: "unknown_persona" }, 400);
      persona = asked;
      const p = personaPrincipal(asked, tenantId, email, await personaId(asked, email));
      actAs = { id: p.id, roleIds: p.roleIds, memberships: p.memberships };
    }

    const stub = tenantStub(c.env, tenantId);
    const sessionInput = { email, actAs, now, limit: rateLimit(c.env) };
    let s = await stub.session(sessionInput);
    // Dev only, never anywhere else: load the synthetic org on the first authenticated request.
    if (!s.config && c.env.ENVIRONMENT === "dev") {
      await seedTenant(c.env, { tenantId, now }, false);
      s = await stub.session(sessionInput);
    }
    // Deprovisioned in the directory (SCIM): no identity source can sign this principal in.
    if (!s.active) return c.json({ error: "unauthorized" }, 401);
    if (s.limited) {
      c.header("Retry-After", String(s.retryAfter));
      return c.json({ error: "rate_limited" }, 429);
    }
    const session: Session = {
      principal: { ...s.principal, tenantId },
      ctx: makeCtx(now, s.ndaGrants, s.elevatedUntil),
      persona,
      tenantId,
      config: s.config,
      epoch: s.epoch,
      internal,
      switches: s.switches,
      // Roles are data: the tenant's role table replaces the built-in roles (admin/client.ts).
      org: s.config ? await tenantOrg(c.env, tenantId, getOrg(s.config), s.rolesVersion) : null,
    };
    c.set("session", session);
    await next();
  };

/** The organisation, or 503 while the tenant has not been seeded. */
export function requireOrg(s: Session): NonNullable<Session["org"]> {
  if (!s.org) throw new HTTPException(503, { message: "tenant_not_seeded" });
  return s.org;
}

export const viewOf = (s: Session): AdmittedView => admittedView(s.principal, requireOrg(s), s.ctx);
