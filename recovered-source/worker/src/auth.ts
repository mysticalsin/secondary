// Authentication. A request is signed in by a Cloudflare Access JWT (header or cookie) verified
// against the team's JWKS. Two dev-only helpers exist and both are off outside ENVIRONMENT=dev:
// the X-Demo-Persona header and the localhost-only DEV_AUTH_BYPASS_EMAIL.

import { type AdmittedView, admittedView } from "@secondary/policy";
import { normalEmail } from "../../../src/state/actor.ts";
import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";
import { tenantOrg } from "./admin/client.ts";
import { accessAllowed, accessLinked, entraEnabled, scimConfigured } from "./auth/config.ts";
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
import { unixSeconds } from "../../../packages/contracts/src/signed-call.ts";
import { internalKeys, replayStore } from "./replay.ts";
import { seedTenant } from "./seed.ts";
import { tenantStub } from "./stubs.ts";
import type { ActAs } from "./tenant-policy.ts";
import type { AppDeps, AppEnv, Session } from "./types.ts";
import { ensureWikiSeed } from "./wiki/seed.ts";

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
    return normalEmail(email);
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
  const email = normalEmail(env.DEV_AUTH_BYPASS_EMAIL);
  return env.ENVIRONMENT === "dev" && email && isLocalHost(url) ? email : null;
};

/**
 * The local sign-in has one address, so every persona of a local session would be one human to the
 * two-person rules (M-08). With a persona header each persona gets its own plus-address, like testers
 * on a deployed dev environment. Loopback only, like the bypass itself.
 */
export const devBypassEmailFor = (
  env: Env,
  url: string,
  persona: string | undefined,
): string | null => {
  const email = devBypassEmail(env, url);
  if (!email || !persona || !/^[a-z_]{3,32}$/.test(persona)) return email;
  const [local, domain] = email.split("@");
  return `${local}+${persona}@${domain}`;
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
  { method: "GET", path: /^\/v1\/wiki\/[^/]+\/search$/, scope: READ },
  { method: "GET", path: /^\/v1\/wiki\/[^/]+\/pages\/[^/]+$/, scope: READ },
  { method: "POST", path: /^\/v1\/wiki\/[^/]+\/propose$/, scope: "secondary.contribute" },
  // v3 brains: the guide (structure, never content) and a Structure Coach proposal. Nothing applies.
  { method: "GET", path: /^\/v1\/brains\/[^/]+\/guide$/, scope: READ },
  { method: "POST", path: /^\/v1\/brains\/[^/]+\/coach\/propose$/, scope: "secondary.contribute" },
  // v4: the brains the caller may read, and pushing into one with their own rights (review only).
  { method: "GET", path: /^\/v1\/brains$/, scope: READ },
  { method: "POST", path: /^\/v1\/brains\/[^/]+\/push\/page$/, scope: "secondary.contribute" },
  { method: "POST", path: /^\/v1\/brains\/[^/]+\/push\/change$/, scope: "secondary.contribute" },
  {
    method: "POST",
    path: /^\/v1\/brains\/[^/]+\/push\/session-report$/,
    scope: "secondary.contribute",
  },
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
    let via: "entra" | "access" | "internal" = "access";
    if (internalPresent) {
      via = "internal";
      if (c.req.header("CF-Connecting-IP") || c.req.header(HEADER_SIGNATURE) === undefined)
        return c.json({ error: "unauthorized" }, 401);
      const r = await verifyInternalRequest(c.req.raw, internalKeys(c.env), {
        now: unixSeconds(now),
        replay: replayStore(c.env, now),
        channel: "mcp",
      });
      if (!r.ok) {
        console.warn(JSON.stringify({ at: "internal_auth", reason: r.reason }));
        return c.json({ error: "unauthorized" }, 401);
      }
      email = normalEmail(r.principal.email);
      if (!email) return c.json({ error: "unauthorized" }, 401);
      internal = {
        clientId: r.principal.client_id,
        tool: r.principal.tool,
        scope: r.principal.scope,
        ...(r.principal.grant_id ? { grantId: r.principal.grant_id } : {}),
        ...(r.principal.host ? { host: r.principal.host } : {}),
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
        if (email) via = "entra";
        // CSRF: a session cookie is sent by the browser on its own, so a mutation must come from our origin.
        if (email && isUnsafeMethod(c.req.method) && !sameOrigin(c.req.raw))
          return c.json({ error: "forbidden" }, 403);
      }
      if (!email && accessAllowed(c.env)) {
        const token = c.req.header("Cf-Access-Jwt-Assertion") ?? getCookie(c, "CF_Authorization");
        email = token
          ? await verifyAccessJwt(token, c.env, deps)
          : devBypassEmailFor(c.env, c.req.url, c.req.header("X-Demo-Persona"));
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
    const sessionInput = {
      email,
      actAs,
      now,
      limit: rateLimit(c.env),
      via,
      managed: scimConfigured(c.env),
      accessLinked: accessLinked(c.env, email),
    };
    let s = await stub.session(sessionInput);
    // Dev only, never anywhere else: load the synthetic org on the first authenticated request.
    if (!s.config && c.env.ENVIRONMENT === "dev") {
      await seedTenant(c.env, { tenantId, now }, false);
      s = await stub.session(sessionInput);
    }
    // Dev only: the synthetic wiki, once per seed version (it is a no-op elsewhere and when done).
    if (s.config && c.env.ENVIRONMENT === "dev") await ensureWikiSeed(c.env, tenantId, now);
    // Deprovisioned in the directory (SCIM): no identity source can sign this principal in.
    if (!s.active) return c.json({ error: "unauthorized" }, 401);
    // A connection the person revoked is refused here, whatever the token still says (the MCP worker
    // also deletes the grant when it sees this answer).
    // M-3: an MCP call that does not say which connection it is cannot be checked against a revocation, so
    // it is refused (fail closed) instead of skipping the check.
    if (internal && !internal.grantId) return c.json({ error: "grant_required" }, 400);
    if (internal?.grantId) {
      const seen = await stub.agentSeen({
        principalId: s.principal.id,
        grantId: internal.grantId,
        clientId: internal.clientId,
        host: internal.host ?? "other",
        scopes: internal.scope,
        tool: internal.tool,
        now,
      });
      if (seen.revoked) return c.json({ error: "connection_revoked" }, 403);
    }
    if (s.limited) {
      c.header("Retry-After", String(s.retryAfter));
      return c.json({ error: "rate_limited" }, 429);
    }
    const session: Session = {
      principal: { ...s.principal, tenantId },
      ctx: makeCtx(now, s.ndaGrants, s.elevatedUntil, s.openBrains),
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
