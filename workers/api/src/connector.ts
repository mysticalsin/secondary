// Connector link (workers/connector <-> workers/api), both directions over service bindings.
//
// IN  /internal/connector/{upsert,delete,purge}: the connector writes synced SharePoint/OneDrive items into a
//     Workspace. Signed with CONNECTOR_HMAC_KEY (the shared internal-auth helper); the principal must be the
//     connector service. This path is not under /v1 and never accepts a user identity.
// OUT checkSourceAccess: the read-time permission check. The API signs the requesting user's id and email and
//     asks the connector whether Graph still lets that user read the file. FAIL CLOSED: a missing binding or
//     key, a connector that is off, any HTTP or parse problem, and every answer that is not an explicit
//     `allowed: true` all mean the item stays hidden.

import { Hono } from "hono";
import {
  type InternalPrincipal,
  signInternalRequest,
  verifyInternalRequest,
} from "./internal-auth.ts";
import { connectorKeys, replayStore } from "./replay.ts";
import { ruleServiceCheck } from "./rules/service.ts";
import { workspaceStub } from "./stubs.ts";
import { wikiNotify } from "./wiki/hooks.ts";
import type { SourceItem } from "./workspace.ts";

export const NOT_CONFIRMED = "source permission could not be confirmed";

const TENANT_ID = /^[a-z0-9_]{3,64}$/;
const NODE_ID = /^[a-z0-9][a-z0-9_.:-]{0,127}$/;
const SOURCE_ID = /^[a-z][a-z0-9_]{5,39}$/;
export const SOURCE_ITEM_ID = /^src:[a-z][a-z0-9_]{5,39}:[0-9a-f]{24}$/;
const MAX_ITEMS = 200;
const MAX_BODY = 32_000;

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

function parseItem(
  v: unknown,
  sourceId: string,
  gateNodeId: string,
  plane: string,
): SourceItem | null {
  const o = obj(v);
  if (!o) return null;
  const { id, title, body, webUrl, mime, size, eTag, syncedAt } = o;
  if (typeof id !== "string" || !SOURCE_ITEM_ID.test(id) || !id.startsWith(`src:${sourceId}:`))
    return null;
  if (typeof title !== "string" || title.length < 1 || title.length > 300) return null;
  if (body !== null && (typeof body !== "string" || body.length > MAX_BODY)) return null;
  if (
    webUrl !== null &&
    (typeof webUrl !== "string" || webUrl.length > 2000 || !webUrl.startsWith("https://"))
  )
    return null;
  if (mime !== null && (typeof mime !== "string" || mime.length > 100)) return null;
  if (typeof size !== "number" || !Number.isInteger(size) || size < 0 || size > 104_857_600)
    return null;
  if (typeof eTag !== "string" || eTag.length > 200) return null;
  if (typeof syncedAt !== "number" || !Number.isFinite(syncedAt)) return null;
  return { id, sourceId, gateNodeId, plane, title, body, webUrl, mime, size, eTag, syncedAt };
}

/**
 * Do the tenant's brain rules stop this batch? The connector is a machine: `block` and every approval
 * effect hold the batch back (nothing written, the next sync tries again). Returns `ruleId@version`
 * of the rule that did, "" when the rules could not be read (fail closed), else null. The batch text
 * is read for content flags (client names, personal data), never stored.
 */
async function connectorRule(
  env: Env,
  tenantId: string,
  scopeId: string,
  gateNodeId: string,
  rows: SourceItem[],
): Promise<string | null> {
  const v = await ruleServiceCheck(env, {
    tenantId,
    principalId: "secondary-connector",
    scopeId,
    nodeId: gateNodeId,
    action: "import",
    actor: "connector",
    text: rows.map((x) => `${x.title}\n${x.body ?? ""}`).join("\n\n"),
    cites: rows.length,
    pages: rows.length,
    approval: "hold",
  });
  return v.stop ? (v.rule ?? "") : null;
}

/** Mounted at /internal/connector in index.ts. */
export function connectorRoutes(): Hono<{ Bindings: Env }> {
  const r = new Hono<{ Bindings: Env }>();

  r.use("*", async (c, next) => {
    // Public traffic carries CF-Connecting-IP; a service binding does not (L-02).
    if (c.req.header("CF-Connecting-IP")) return c.json({ error: "unauthorized" }, 401);
    const at = Date.now();
    const v = await verifyInternalRequest(c.req.raw, connectorKeys(c.env), {
      now: Math.floor(at / 1000),
      replay: replayStore(c.env, at),
      channel: "connector-in",
    });
    if (
      !v.ok ||
      v.principal.sub !== "secondary-connector" ||
      v.principal.client_id !== "secondary-connector"
    )
      return c.json({ error: "unauthorized" }, 401);
    await next();
  });

  const read = async (req: Request) => {
    try {
      return obj(await req.json());
    } catch {
      return null;
    }
  };

  r.post("/upsert", async (c) => {
    const b = await read(c.req.raw);
    if (!b) return c.json({ error: "invalid_body" }, 400);
    const { tenantId, sourceId, scopeId, gateNodeId, plane, items } = b;
    if (
      typeof tenantId !== "string" ||
      !TENANT_ID.test(tenantId) ||
      typeof sourceId !== "string" ||
      !SOURCE_ID.test(sourceId) ||
      typeof scopeId !== "string" ||
      !NODE_ID.test(scopeId) ||
      typeof gateNodeId !== "string" ||
      !NODE_ID.test(gateNodeId) ||
      (plane !== "TEAM_RESTRICTED" && plane !== "ACCOUNT_RESTRICTED") ||
      !Array.isArray(items) ||
      items.length > MAX_ITEMS
    )
      return c.json({ error: "invalid_body" }, 400);
    const rows: SourceItem[] = [];
    for (const it of items) {
      const row = parseItem(it, sourceId, gateNodeId, plane);
      if (!row) return c.json({ error: "invalid_item" }, 400);
      rows.push(row);
    }
    // Brain rules (v7): a sync cannot wait for a person, so an approval effect holds the batch back.
    const held = await connectorRule(c.env, tenantId, scopeId, gateNodeId, rows);
    if (held !== null) return c.json({ ok: true, changed: 0, held: held || "rules_unavailable" });
    const changed = await workspaceStub(c.env, tenantId, scopeId).sourceUpsert(rows);
    if (changed)
      await wikiNotify(
        c.env,
        tenantId,
        scopeId,
        rows.map((r) => r.id),
        Date.now(),
      );
    return c.json({ ok: true, changed });
  });

  r.post("/delete", async (c) => {
    const b = await read(c.req.raw);
    const { tenantId, scopeId, ids } = b ?? {};
    if (
      typeof tenantId !== "string" ||
      !TENANT_ID.test(tenantId) ||
      typeof scopeId !== "string" ||
      !NODE_ID.test(scopeId) ||
      !Array.isArray(ids) ||
      ids.length > MAX_ITEMS ||
      !ids.every((i) => typeof i === "string" && SOURCE_ITEM_ID.test(i))
    )
      return c.json({ error: "invalid_body" }, 400);
    const removed = await workspaceStub(c.env, tenantId, scopeId).sourceDelete(ids as string[]);
    return c.json({ ok: true, removed });
  });

  r.post("/purge", async (c) => {
    const b = await read(c.req.raw);
    const { tenantId, scopeId, sourceId } = b ?? {};
    if (
      typeof tenantId !== "string" ||
      !TENANT_ID.test(tenantId) ||
      typeof scopeId !== "string" ||
      !NODE_ID.test(scopeId) ||
      typeof sourceId !== "string" ||
      !SOURCE_ID.test(sourceId)
    )
      return c.json({ error: "invalid_body" }, 400);
    const removed = await workspaceStub(c.env, tenantId, scopeId).sourcePurge(sourceId);
    return c.json({ ok: true, removed });
  });

  return r;
}

/**
 * Ask the connector which of `itemIds` the user may still read. Returns the set of allowed ids.
 * Anything short of an explicit `allowed: true` for an id leaves it out.
 */
export async function checkSourceAccess(
  env: Env,
  tenantId: string,
  user: { id: string; email: string },
  itemIds: string[],
): Promise<Set<string>> {
  const allowed = new Set<string>();
  const secret = env.CONNECTOR_HMAC_KEY;
  if (!itemIds.length || !secret || !env.CONNECTOR) return allowed;
  try {
    const principal: InternalPrincipal = {
      v: 1,
      iss: "secondary-mcp",
      aud: "secondary-api",
      sub: user.id,
      email: user.email,
      client_id: "secondary-api",
      scope: [],
      tool: "acl.check",
    };
    const url = "https://connector.internal/internal/acl/check";
    const body = JSON.stringify({ tenantId, itemIds });
    const headers = await signInternalRequest({
      secret,
      kid: env.CONNECTOR_HMAC_KID,
      method: "POST",
      url,
      body,
      principal,
    });
    const res = await env.CONNECTOR.fetch(url, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body,
    });
    if (!res.ok) return allowed;
    const j = obj(await res.json());
    const results = obj(j?.results);
    if (!results) return allowed;
    for (const id of itemIds) if (obj(results[id])?.allowed === true) allowed.add(id);
  } catch {
    // Fail closed.
  }
  return allowed;
}

/**
 * Right to erasure: ask the connector to drop the cached read decisions of one person. Best effort by
 * design (the cache is keyed by an HMAC and expires on its own): true only when the connector confirmed.
 */
export async function forgetSourceAccess(
  env: Env,
  tenantId: string,
  user: { id: string; email: string },
): Promise<boolean> {
  const secret = env.CONNECTOR_HMAC_KEY;
  if (!secret || !env.CONNECTOR) return false;
  try {
    const principal: InternalPrincipal = {
      v: 1,
      iss: "secondary-mcp",
      aud: "secondary-api",
      sub: user.id,
      email: user.email,
      client_id: "secondary-api",
      scope: [],
      tool: "acl.forget",
    };
    const url = "https://connector.internal/internal/acl/forget";
    const body = JSON.stringify({ tenantId });
    const headers = await signInternalRequest({
      secret,
      kid: env.CONNECTOR_HMAC_KID,
      method: "POST",
      url,
      body,
      principal,
    });
    const res = await env.CONNECTOR.fetch(url, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body,
    });
    return res.ok;
  } catch {
    return false;
  }
}
