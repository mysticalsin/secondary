// SCIM 2.0 server (RFC 7643, RFC 7644) for Entra ID provisioning: /scim/v2/Users and /Groups.
// Auth is one static bearer token (SCIM_TOKEN). Users and groups live in the tenant's
// TenantPolicy object. Deprovisioning (active=false or DELETE) kills the user's sessions at once.

import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { directoryTenant } from "../auth/config.ts";
import type { ScimGroupRec, ScimUserRec } from "../auth/identity-store.ts";
import { safeEqual } from "../security.ts";
import { tenantStub } from "../stubs.ts";
import type { AppDeps, AppEnv } from "../types.ts";
import {
  groupCreate,
  groupOps,
  parseFilter,
  patchOps,
  ScimParseError,
  userChange,
  userCreate,
} from "./parse.ts";

const SCHEMA_USER = "urn:ietf:params:scim:schemas:core:2.0:User";
const SCHEMA_GROUP = "urn:ietf:params:scim:schemas:core:2.0:Group";
const SCHEMA_LIST = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
const SCHEMA_ERROR = "urn:ietf:params:scim:api:messages:2.0:Error";
const MIN_TOKEN = 32;
const MAX_COUNT = 200;
const ID = /^[0-9a-f-]{36}$/;
const MAX_SCIM_BODY = 256 * 1024;

const iso = (ms: number) => new Date(ms).toISOString();

export function scimRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const nowOf = () => deps.now?.() ?? Date.now();

  const send = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/scim+json", "Cache-Control": "no-store", ...extra },
    });
  const error = (
    status: number,
    detail: string,
    scimType?: "uniqueness" | "invalidFilter" | "invalidValue" | "invalidPath" | "invalidSyntax",
  ) =>
    send(
      {
        schemas: [SCHEMA_ERROR],
        status: String(status),
        ...(scimType ? { scimType } : {}),
        detail,
      },
      status,
    );

  // Bearer token, constant time. Unset or short token means SCIM is off, and the answer is the same 401.
  app.use("*", async (c, next) => {
    const want = c.env.SCIM_TOKEN;
    const got = /^Bearer (.+)$/i.exec(c.req.header("Authorization") ?? "")?.[1] ?? "";
    const ok = !!want && want.length >= MIN_TOKEN && safeEqual(got, want);
    if (!ok || !directoryTenant(c.env))
      return send({ schemas: [SCHEMA_ERROR], status: "401", detail: "Unauthorized" }, 401, {
        "WWW-Authenticate": 'Bearer realm="scim"',
      });
    await next();
  });
  app.use(
    "*",
    bodyLimit({ maxSize: MAX_SCIM_BODY, onError: () => error(413, "Payload too large") }),
  );
  app.onError((e) => {
    if (e instanceof ScimParseError) return error(400, e.message, e.scimType);
    console.error(JSON.stringify({ at: "scim", error: e instanceof Error ? e.name : "unknown" }));
    return error(500, "Internal error");
  });

  const stub = (env: Env) => tenantStub(env, directoryTenant(env) as string);
  const base = (url: string) => `${new URL(url).origin}/scim/v2`;

  const userJson = (u: ScimUserRec, root: string) => ({
    schemas: [SCHEMA_USER],
    id: u.id,
    ...(u.externalId ? { externalId: u.externalId } : {}),
    userName: u.userName,
    ...(u.name ? { name: u.name } : {}),
    ...(u.displayName ? { displayName: u.displayName } : {}),
    emails: u.emails ?? [{ value: u.userName, type: "work", primary: true }],
    active: u.active,
    meta: {
      resourceType: "User",
      created: iso(u.created),
      lastModified: iso(u.modified),
      location: `${root}/Users/${u.id}`,
    },
  });
  const groupJson = (g: ScimGroupRec, root: string, members: boolean) => ({
    schemas: [SCHEMA_GROUP],
    id: g.id,
    ...(g.externalId ? { externalId: g.externalId } : {}),
    displayName: g.displayName,
    ...(members
      ? {
          members: g.memberIds.map((v) => ({ value: v, $ref: `${root}/Users/${v}`, type: "User" })),
        }
      : {}),
    meta: {
      resourceType: "Group",
      created: iso(g.created),
      lastModified: iso(g.modified),
      location: `${root}/Groups/${g.id}`,
    },
  });

  const page = (q: (k: string) => string | undefined) => {
    const start = Math.max(Number.parseInt(q("startIndex") ?? "1", 10) || 1, 1);
    const raw = Number.parseInt(q("count") ?? "100", 10);
    const count = Math.min(Math.max(Number.isFinite(raw) ? raw : 100, 0), MAX_COUNT);
    return { start, count };
  };
  const list = (resources: unknown[], total: number, start: number) =>
    send({
      schemas: [SCHEMA_LIST],
      totalResults: total,
      itemsPerPage: resources.length,
      startIndex: start,
      Resources: resources,
    });

  const body = async (c: { req: { text(): Promise<string> } }): Promise<unknown> => {
    try {
      return JSON.parse(await c.req.text());
    } catch {
      throw new ScimParseError("invalidSyntax", "The body is not valid JSON.");
    }
  };

  // ---- discovery ----
  app.get("/ServiceProviderConfig", (c) =>
    send({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: MAX_COUNT },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        {
          type: "oauthbearertoken",
          name: "Bearer token",
          description: "Static bearer token",
          primary: true,
        },
      ],
      meta: {
        resourceType: "ServiceProviderConfig",
        location: `${base(c.req.url)}/ServiceProviderConfig`,
      },
    }),
  );
  app.get("/ResourceTypes", (c) =>
    list(
      [
        { id: "User", name: "User", endpoint: "/Users", schema: SCHEMA_USER },
        { id: "Group", name: "Group", endpoint: "/Groups", schema: SCHEMA_GROUP },
      ].map((r) => ({
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
        ...r,
        meta: {
          resourceType: "ResourceType",
          location: `${base(c.req.url)}/ResourceTypes/${r.id}`,
        },
      })),
      2,
      1,
    ),
  );

  // ---- users ----
  app.get("/Users", async (c) => {
    const f = parseFilter(c.req.query("filter"), ["username", "externalid", "id"]);
    const { start, count } = page((k) => c.req.query(k));
    const where =
      f?.attr === "username"
        ? { userName: f.value }
        : f?.attr === "externalid"
          ? { externalId: f.value }
          : f?.attr === "id"
            ? { id: f.value }
            : {};
    const r = await stub(c.env).scimUserList(where, start, count);
    const root = base(c.req.url);
    return list(
      r.users.map((u) => userJson(u, root)),
      r.total,
      start,
    );
  });

  app.post("/Users", async (c) => {
    const input = userCreate(await body(c));
    const r = await stub(c.env).scimUserCreate(input, nowOf());
    if (!r.ok)
      return r.code === "uniqueness"
        ? error(409, "userName is already in use.", "uniqueness")
        : error(400, "userName must be an email address.", "invalidValue");
    const root = base(c.req.url);
    return send(userJson(r.user, root), 201, { Location: `${root}/Users/${r.user.id}` });
  });

  app.get("/Users/:id", async (c) => {
    const id = c.req.param("id");
    const u = ID.test(id) ? await stub(c.env).scimUserGet(id) : null;
    return u ? send(userJson(u, base(c.req.url))) : error(404, "User not found.");
  });

  app.patch("/Users/:id", async (c) => {
    const id = c.req.param("id");
    if (!ID.test(id)) return error(404, "User not found.");
    const change = userChange(patchOps(await body(c)));
    const r = await stub(c.env).scimUserPatch(id, change, nowOf());
    if (!r.ok)
      return r.code === "not_found"
        ? error(404, "User not found.")
        : r.code === "uniqueness"
          ? error(409, "userName is already in use.", "uniqueness")
          : error(400, "userName must be an email address.", "invalidValue");
    return send(userJson(r.user, base(c.req.url)));
  });

  app.delete("/Users/:id", async (c) => {
    const id = c.req.param("id");
    const ok = ID.test(id) && (await stub(c.env).scimUserDelete(id, nowOf()));
    return ok ? new Response(null, { status: 204 }) : error(404, "User not found.");
  });

  // ---- groups ----
  app.get("/Groups", async (c) => {
    const f = parseFilter(c.req.query("filter"), ["displayname", "externalid"]);
    const { start, count } = page((k) => c.req.query(k));
    const where =
      f?.attr === "displayname"
        ? { displayName: f.value }
        : f?.attr === "externalid"
          ? { externalId: f.value }
          : {};
    const r = await stub(c.env).scimGroupList(where, start, count);
    const root = base(c.req.url);
    const members = !/(^|,)\s*members\s*(,|$)/i.test(c.req.query("excludedAttributes") ?? "");
    return list(
      r.groups.map((g) => groupJson(g, root, members)),
      r.total,
      start,
    );
  });

  app.post("/Groups", async (c) => {
    const input = groupCreate(await body(c));
    const r = await stub(c.env).scimGroupCreate(input, nowOf());
    if (!r.ok)
      return r.code === "uniqueness"
        ? error(409, "displayName is already in use.", "uniqueness")
        : error(400, "Invalid displayName or unknown member.", "invalidValue");
    const root = base(c.req.url);
    return send(groupJson(r.group, root, true), 201, { Location: `${root}/Groups/${r.group.id}` });
  });

  app.get("/Groups/:id", async (c) => {
    const id = c.req.param("id");
    const g = ID.test(id) ? await stub(c.env).scimGroupGet(id) : null;
    return g ? send(groupJson(g, base(c.req.url), true)) : error(404, "Group not found.");
  });

  app.patch("/Groups/:id", async (c) => {
    const id = c.req.param("id");
    if (!ID.test(id)) return error(404, "Group not found.");
    const ops = groupOps(patchOps(await body(c)));
    const r = await stub(c.env).scimGroupApply(id, ops, nowOf());
    if (!r.ok)
      return r.code === "not_found"
        ? error(404, "Group not found.")
        : r.code === "uniqueness"
          ? error(409, "displayName is already in use.", "uniqueness")
          : error(400, "Invalid displayName or unknown member.", "invalidValue");
    return send(groupJson(r.group, base(c.req.url), true));
  });

  app.delete("/Groups/:id", async (c) => {
    const id = c.req.param("id");
    const ok = ID.test(id) && (await stub(c.env).scimGroupDelete(id));
    return ok ? new Response(null, { status: 204 }) : error(404, "Group not found.");
  });

  app.all("*", () => error(404, "Not found."));
  return app;
}
