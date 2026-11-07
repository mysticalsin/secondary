/**
 * NEW RECONSTRUCTION test harness. Not a recovered route and not an original Worker.
 * Re-exports the recovered API handler and calls recovered Durable Object methods.
 * /harness/import is the reconstruction import gate. It reuses recovered signature
 * checks and personal item creation. The principal comes from GET /v1/me for the
 * signed internal caller. Query and body fields do not grant access.
 */
import app, { TenantPolicy, Workspace } from "../worker-root/worker/src/index.ts";
import { verifyInternalRequest, signInternalRequest } from "../worker-root/worker/src/internal-auth.ts";
import { internalKeys } from "../worker-root/worker/src/replay.ts";
import { personalScope } from "../worker-root/worker/src/scope.ts";
import { workspaceStub } from "../worker-root/worker/src/stubs.ts";
import { matchReceipt, readReceipt, sha256Hex, storedBody, validateImport, visibleText } from "../import/policy.mjs";

export { TenantPolicy, Workspace };

interface HarnessEnv {
  WORKSPACE: DurableObjectNamespace;
  TENANT_POLICY: DurableObjectNamespace;
  INTERNAL_HMAC_KEY?: string;
  DEFAULT_TENANT_ID?: string;
  TENANT_DOMAINS?: string;
  ENVIRONMENT?: string;
}

const MAX_STORED = 8000;

async function sessionIdentity(
  env: HarnessEnv,
  ctx: ExecutionContext,
  principal: Parameters<typeof signInternalRequest>[0]["principal"],
): Promise<{ principalId: string; tenantId: string } | Response> {
  const url = "https://api.internal/v1/me";
  const headers = await signInternalRequest({
    secret: env.INTERNAL_HMAC_KEY ?? "",
    method: "GET",
    url,
    principal,
  });
  const res = await app.fetch(
    new Request(url, { method: "GET", headers: { ...headers, accept: "application/json" } }),
    env,
    ctx,
  );
  if (!res.ok) return Response.json({ error: "identity_unavailable", reason: "identity_unavailable", outcome: "failed" }, { status: 502 });
  const me = (await res.json()) as { principal?: { id?: unknown }; tenantId?: unknown };
  if (typeof me.principal?.id !== "string" || typeof me.tenantId !== "string") {
    return Response.json({ error: "identity_unavailable", reason: "identity_unavailable", outcome: "failed" }, { status: 502 });
  }
  return { principalId: me.principal.id, tenantId: me.tenantId };
}

async function ownItems(env: HarnessEnv, tenantId: string, principalId: string) {
  const stub = workspaceStub(env as never, tenantId, personalScope(principalId)) as DurableObjectStub<{
    listByKind(kind: string, limit: number): Promise<{ id: string; body: string | null; authorId: string | null; createdAt: number }[]>;
  }>;
  const rows = await stub.listByKind("personalitem", 100);
  return Array.isArray(rows) ? rows : [];
}

async function importGate(request: Request, env: HarnessEnv, ctx: ExecutionContext): Promise<Response> {
  if (request.headers.get("cf-connecting-ip")) {
    return Response.json({ error: "public_edge" }, { status: 401 });
  }
  const verified = await verifyInternalRequest(request, internalKeys(env as never));
  if (!verified.ok) return Response.json({ error: "unauthorized", reason: verified.reason }, { status: 401 });
  const principal = verified.principal;
  const write = principal.scope.includes("secondary.personal.write");
  const read = principal.scope.includes("secondary.read");
  if (request.method === "GET") {
    if (!read) return Response.json({ error: "insufficient_scope", reason: "insufficient_scope" }, { status: 403 });
    const who = await sessionIdentity(env, ctx, principal);
    if (who instanceof Response) return who;
    const rows = await ownItems(env, who.tenantId, who.principalId);
    const items = rows.flatMap((item) => {
      const view = present(item);
      return view ? [view] : [];
    });
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (id !== null) {
      const found = items.find((item) => item.id === id);
      if (!found) return Response.json({ error: "not_found", reason: "not_found", outcome: "denied" }, { status: 404 });
      return Response.json({ principalId: who.principalId, tenantId: who.tenantId, usage: "unknown", item: found });
    }
    const q = url.searchParams.get("q");
    if (q !== null) {
      const tokens = searchTokens(q);
      if (!tokens) return Response.json({ error: "invalid_query", reason: "invalid_query", outcome: "rejected" }, { status: 400 });
      const hits = items.filter((item) => {
        const hay = `${item.text}\n${item.externalId ?? ""}`.toLowerCase();
        return tokens.every((token) => hay.includes(token));
      });
      return Response.json({
        principalId: who.principalId,
        tenantId: who.tenantId,
        usage: "unknown",
        items: hits.slice(0, 20),
      });
    }
    return Response.json({
      principalId: who.principalId,
      tenantId: who.tenantId,
      usage: "unknown",
      kept: rows.length - items.length,
      items,
    });
  }
  if (request.method !== "POST") return Response.json({ error: "method" }, { status: 405 });
  if (!write || !read) return Response.json({ error: "insufficient_scope", reason: "insufficient_scope" }, { status: 403 });
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(await request.clone().text()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const checked = validateImport({
    source: payload.source,
    externalId: payload.externalId,
    version: payload.version,
    filename: payload.filename,
    text: payload.text,
    url: payload.url,
  });
  if (!checked.ok) return Response.json({ error: checked.error, reason: checked.error, outcome: "rejected" }, { status: 400 });
  const who = await sessionIdentity(env, ctx, principal);
  if (who instanceof Response) return who;
  const contentSha256 = await sha256Hex(checked.text);
  const items = await ownItems(env, who.tenantId, who.principalId);
  const found = matchReceipt(items, { ...checked, contentSha256 });
  if (found.conflict) return Response.json({ error: "version_conflict", reason: "version_conflict", outcome: "rejected" }, { status: 409 });
  if (found.same) {
    const view = present(found.same);
    return Response.json({
      ...view,
      outcome: "duplicate",
      principalId: who.principalId,
      tenantId: who.tenantId,
      usage: "unknown",
    });
  }
  const requestId = crypto.randomUUID();
  const receipt = {
    import: 1,
    source: checked.source,
    client: principal.client_id,
    externalId: checked.externalId,
    version: checked.version,
    contentSha256,
    author: who.principalId,
    principal: who.principalId,
    principalId: who.principalId,
    tenant: who.tenantId,
    tenantId: who.tenantId,
    destination: `personal:${who.principalId}`,
    at: new Date().toISOString(),
    outcome: "stored",
    previous: found.previous?.id ?? null,
    requestId,
    usage: "unknown",
  };
  const body = storedBody(receipt, checked.text);
  if (body.length > MAX_STORED) return Response.json({ error: "invalid_text", reason: "invalid_text", outcome: "rejected" }, { status: 400 });
  const createBody = JSON.stringify({ kind: "note", title: checked.externalId, body });
  const url = "https://api.internal/v1/personal/items";
  const headers = await signInternalRequest({
    secret: env.INTERNAL_HMAC_KEY ?? "",
    method: "POST",
    url,
    body: createBody,
    principal: { ...principal, tool: principal.tool || "personal_import" },
  });
  const saved = await app.fetch(
    new Request(url, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json", accept: "application/json" },
      body: createBody,
    }),
    env,
    ctx,
  );
  if (saved.status !== 201) {
    return Response.json({ error: "not_stored", reason: "not_stored", status: saved.status, outcome: "failed" }, { status: 502 });
  }
  const made = (await saved.json()) as { id?: string };
  const after = await ownItems(env, who.tenantId, who.principalId);
  if (!after.some((item) => item.id === made.id)) {
    return Response.json({ error: "not_confirmed", reason: "not_confirmed", outcome: "failed" }, { status: 503 });
  }
  return Response.json({ ...receipt, id: made.id, text: checked.text }, { status: 201 });
}

function present(item: { id: string; body: string | null; authorId: string | null }) {
  const receipt = readReceipt(item.body);
  if (!receipt) return null;
  return {
    id: item.id,
    text: visibleText(item.body),
    source: receipt.source ?? null,
    externalId: receipt.externalId ?? null,
    version: receipt.version ?? null,
    contentSha256: receipt.contentSha256 ?? null,
    author: receipt.author ?? item.authorId,
    principal: receipt.principal ?? null,
    tenant: receipt.tenant ?? null,
    destination: receipt.destination ?? null,
    at: receipt.at ?? null,
    outcome: receipt.outcome ?? null,
    previous: receipt.previous ?? null,
    requestId: receipt.requestId ?? null,
    usage: "unknown",
  };
}

function searchTokens(q: string): string[] | null {
  if (q.length > 200) return null;
  const tokens = q
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2)
    .slice(0, 12);
  return tokens.length === 0 ? null : tokens;
}

export default {
  async fetch(request: Request, env: HarnessEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/harness/import") return importGate(request, env, ctx);
    if (url.pathname === "/harness/workspace") {
      const name = url.searchParams.get("name") ?? "";
      const ns = env.WORKSPACE;
      const stub = ns.get(ns.idFromName(name)) as DurableObjectStub<{
        listByKind(kind: string, limit: number): Promise<unknown[]>;
      }>;
      try {
        const rows = await stub.listByKind("note", 5);
        return Response.json({ count: Array.isArray(rows) ? rows.length : -1 });
      } catch (e) {
        return Response.json(
          { gap: "workspace_call_failed", name: e instanceof Error ? e.name : "error" },
          { status: 500 },
        );
      }
    }
    return app.fetch(request, env, ctx);
  },
};
