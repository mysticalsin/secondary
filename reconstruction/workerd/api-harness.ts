/**
 * NEW RECONSTRUCTION test harness. Not a recovered route and not an original Worker.
 * Re-exports the recovered API handler and calls recovered Durable Object methods.
 * /harness/import is the reconstruction import gate. It reuses recovered signature
 * checks, tenant derivation, and personal item creation. Query fields do not grant access.
 */
import app, { TenantPolicy, Workspace } from "../worker-root/worker/src/index.ts";
import { tenantFor } from "../worker-root/worker/src/auth.ts";
import { principalIdFor } from "../worker-root/worker/src/auth/identity-store.ts";
import { verifyInternalRequest, signInternalRequest } from "../worker-root/worker/src/internal-auth.ts";
import { personaId } from "../worker-root/worker/src/org.ts";
import { internalKeys } from "../worker-root/worker/src/replay.ts";
import { personalScope } from "../worker-root/worker/src/scope.ts";
import { workspaceStub } from "../worker-root/worker/src/stubs.ts";
import { matchReceipt, sha256Hex, storedBody, validateImport, visibleText } from "../import/policy.mjs";

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

async function identityOf(env: HarnessEnv, email: string, persona: string | undefined) {
  const tenantId = tenantFor(email, env as never);
  const principalId = persona
    ? await personaId(persona as never, email)
    : await principalIdFor(email);
  return { tenantId, principalId };
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
    if (!read) return Response.json({ error: "insufficient_scope" }, { status: 403 });
    const who = await identityOf(env, principal.email, principal.persona);
    const items = await ownItems(env, who.tenantId, who.principalId);
    return Response.json({
      principalId: who.principalId,
      tenantId: who.tenantId,
      usage: "unknown",
      items: items.map((item) => ({
        id: item.id,
        text: visibleText(item.body),
        authorId: item.authorId,
      })),
    });
  }
  if (request.method !== "POST") return Response.json({ error: "method" }, { status: 405 });
  if (!write) return Response.json({ error: "insufficient_scope" }, { status: 403 });
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
  if (!checked.ok) return Response.json({ error: checked.error, outcome: "rejected" }, { status: 400 });
  const who = await identityOf(env, principal.email, principal.persona);
  if (who.principalId === "u_consultant" || who.principalId === "u_ceo") {
    return Response.json({ error: "seed_owner_not_rewritten" }, { status: 403 });
  }
  const contentSha256 = await sha256Hex(checked.text);
  const items = await ownItems(env, who.tenantId, who.principalId);
  const found = matchReceipt(items, { ...checked, contentSha256 });
  if (found.conflict) return Response.json({ error: "version_conflict", outcome: "rejected" }, { status: 409 });
  if (found.same) {
    return Response.json({
      outcome: "duplicate",
      id: found.same.id,
      principalId: who.principalId,
      tenantId: who.tenantId,
      contentSha256,
      usage: "unknown",
    });
  }
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
    usage: "unknown",
  };
  const body = storedBody(receipt, checked.text);
  if (body.length > MAX_STORED) return Response.json({ error: "invalid_text", outcome: "rejected" }, { status: 400 });
  const createBody = JSON.stringify({ kind: "note", title: checked.externalId, body });
  const url = "https://api.internal/v1/personal/items";
  const headers = await signInternalRequest({
    secret: env.INTERNAL_HMAC_KEY ?? "",
    method: "POST",
    url,
    body: createBody,
    principal: { ...principal, tool: "personal_note_create" },
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
    return Response.json({ error: "not_stored", status: saved.status, outcome: "failed" }, { status: 502 });
  }
  const made = (await saved.json()) as { id?: string };
  const after = await ownItems(env, who.tenantId, who.principalId);
  if (!after.some((item) => item.id === made.id)) {
    return Response.json({ error: "not_confirmed", outcome: "failed" }, { status: 503 });
  }
  return Response.json({ ...receipt, id: made.id }, { status: 201 });
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
