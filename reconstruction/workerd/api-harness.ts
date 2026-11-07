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
import { UsageLedger } from "../ledger/object.mjs";
import { canonicalHash, personalBrain, syntheticFixture, validateClientReport } from "../ledger/policy.mjs";
import { personalPlan } from "../personal/plan.mjs";

export { TenantPolicy, Workspace, UsageLedger };

interface HarnessEnv {
  WORKSPACE: DurableObjectNamespace;
  TENANT_POLICY: DurableObjectNamespace;
  INTERNAL_HMAC_KEY?: string;
  DEFAULT_TENANT_ID?: string;
  TENANT_DOMAINS?: string;
  ENVIRONMENT?: string;
  USAGE_LEDGER?: DurableObjectNamespace;
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

async function ownItem(env: HarnessEnv, tenantId: string, principalId: string, id: string) {
  const stub = workspaceStub(env as never, tenantId, personalScope(principalId)) as DurableObjectStub<{
    get(id: string): Promise<{ id: string; body: string | null; authorId: string | null; kind?: string } | null>;
  }>;
  const item = await stub.get(id);
  if (!item || item.kind !== "personalitem") return null;
  return item;
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
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (id !== null) {
      const item = await ownItem(env, who.tenantId, who.principalId, id);
      const view = item ? present(item) : null;
      if (!view) return Response.json({ error: "not_found", reason: "not_found", outcome: "denied" }, { status: 404 });
      return Response.json({ principalId: who.principalId, tenantId: who.tenantId, usage: "unknown", item: view });
    }
    const q = url.searchParams.get("q");
    const listed = await importRpc(env, who.tenantId, "/import/list", {
      principalId: who.principalId,
      limit: url.searchParams.get("limit"),
      cursor: url.searchParams.get("cursor"),
      q,
    });
    if (!listed.ok) return Response.json(listed.body, { status: listed.status });
    const page = Array.isArray(listed.body.items) ? listed.body.items : [];
    const hydrated = [];
    for (const row of page) {
      const full = await ownItem(env, who.tenantId, who.principalId, String(row.id));
      const view = full ? present(full) : null;
      if (view) hydrated.push(view);
    }
    let items = hydrated;
    if (q) {
      const tokens = searchTokens(q);
      if (!tokens) return Response.json({ error: "invalid_query", reason: "invalid_query", outcome: "rejected" }, { status: 400 });
      const recent = await ownItems(env, who.tenantId, who.principalId);
      const seen = new Set(items.map((item) => item.id));
      for (const row of recent) {
        const view = present(row);
        if (!view || seen.has(view.id)) continue;
        const hay = `${view.text}\n${view.externalId ?? ""}`.toLowerCase();
        if (tokens.every((token) => hay.includes(token))) items.push(view);
      }
      items = items.slice(0, 20);
    }
    const total = Number(listed.body.total ?? items.length);
    const storeTotal = Number(listed.body.storeTotal ?? total);
    const complete = q ? storeTotal <= 100 && Boolean(listed.body.complete) : Boolean(listed.body.complete);
    return Response.json({
      principalId: who.principalId,
      tenantId: who.tenantId,
      usage: "unknown",
      items,
      total,
      complete,
      coverage: complete ? "full" : "partial",
      nextCursor: listed.body.nextCursor ?? null,
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
  const clientId = principal.client_id;
  if (!clientId) return Response.json({ error: "invalid_client", reason: "invalid_client", outcome: "rejected" }, { status: 400 });
  const contentSha256 = await sha256Hex(checked.text);
  const key = {
    principalId: who.principalId,
    clientId,
    source: checked.source,
    externalId: checked.externalId,
    version: checked.version,
    hash: contentSha256,
  };
  let began = await importRpc(env, who.tenantId, "/import/begin", key);
  for (let attempt = 0; began.ok && began.body.outcome === "in_flight" && attempt < 40; attempt += 1) {
    await scheduler.wait(50);
    began = await importRpc(env, who.tenantId, "/import/begin", key);
  }
  if (!began.ok) return Response.json(began.body, { status: began.status });
  if (began.body.outcome === "duplicate") {
    return Response.json({
      outcome: "duplicate",
      id: began.body.id,
      requestId: began.body.requestId,
      previous: began.body.previousId,
      contentSha256,
      externalId: checked.externalId,
      version: checked.version,
      source: checked.source,
      client: clientId,
      principalId: who.principalId,
      tenantId: who.tenantId,
      usage: "unknown",
    });
  }
  if (began.body.outcome !== "claim") {
    return Response.json({ error: "in_flight", reason: "in_flight", outcome: "rejected" }, { status: 409 });
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
    previous: began.body.previousId ?? null,
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
    await importRpc(env, who.tenantId, "/import/abort", key);
    return Response.json({ error: "not_stored", reason: "not_stored", status: saved.status, outcome: "failed" }, { status: 502 });
  }
  const made = (await saved.json()) as { id?: string };
  const finished = await importRpc(env, who.tenantId, "/import/finish", { ...key, itemId: made.id, requestId });
  if (!finished.ok || !made.id) {
    return Response.json({ error: "not_confirmed", reason: "not_confirmed", outcome: "failed" }, { status: 503 });
  }
  const recorded = await recordImportOperation(env, who, requestId, clientId);
  if (!recorded.ok) {
    return Response.json({ error: "ledger_not_confirmed", reason: "ledger_not_confirmed", outcome: "failed" }, { status: 503 });
  }
  return Response.json({ ...receipt, id: made.id, text: checked.text, ledger: recorded.body.outcome }, { status: 201 });
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

async function ledgerStub(env: HarnessEnv, tenantId: string) {
  const ns = env.USAGE_LEDGER;
  if (!ns) return null;
  return ns.get(ns.idFromName(tenantId));
}

async function ledgerAppend(env: HarnessEnv, tenantId: string, event: Record<string, unknown>) {
  const stub = await ledgerStub(env, tenantId);
  if (!stub) return { ok: false, status: 503, body: { error: "ledger_unavailable", outcome: "failed" } };
  const res = await stub.fetch("https://ledger.internal/append", {
    method: "POST",
    body: JSON.stringify(event),
  });
  const body = (await res.json()) as { outcome?: string; error?: string; event?: Record<string, unknown> };
  return { ok: res.ok, status: res.status, body };
}

async function ledgerQuery(env: HarnessEnv, tenantId: string, filter: Record<string, unknown>) {
  const stub = await ledgerStub(env, tenantId);
  if (!stub) return { ok: false, status: 503, body: { error: "ledger_unavailable" } };
  const res = await stub.fetch("https://ledger.internal/query", {
    method: "POST",
    body: JSON.stringify(filter),
  });
  const body = (await res.json()) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, body };
}

async function importRpc(env: HarnessEnv, tenantId: string, pathname: string, body: Record<string, unknown>) {
  const stub = await ledgerStub(env, tenantId);
  if (!stub) return { ok: false, status: 503, body: { error: "ledger_unavailable", reason: "ledger_unavailable", outcome: "failed" } };
  const res = await stub.fetch(`https://ledger.internal${pathname}`, { method: "POST", body: JSON.stringify(body) });
  const parsed = (await res.json()) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, body: parsed };
}

async function recordImportOperation(
  env: HarnessEnv,
  who: { principalId: string; tenantId: string },
  requestId: string,
  clientId: string,
) {
  const event = {
    eventId: `import:${requestId}`,
    clientId,
    tenantId: who.tenantId,
    principalId: who.principalId,
    brainId: personalBrain(who.principalId),
    runId: requestId,
    operation: "import",
    requestId,
    providerRequestId: null,
    streamSeq: null,
    retryOf: null,
    describesRequestId: null,
    payloadHash: await canonicalHash({ operation: "import", requestId, outcome: "ok", trust: "unknown" }),
    trust: "unknown",
    evidence: "server_clock",
    providerVerified: false,
    outcome: "ok",
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    totalTokens: null,
    reportedAt: null,
    serverAt: new Date().toISOString(),
    updatedAt: null,
    provider: null,
    model: null,
  };
  return ledgerAppend(env, who.tenantId, event);
}

async function ledgerCaller(request: Request, env: HarnessEnv, ctx: ExecutionContext, write: boolean) {
  if (request.headers.get("cf-connecting-ip")) {
    return Response.json({ error: "public_edge", reason: "public_edge" }, { status: 401 });
  }
  const verified = await verifyInternalRequest(request, internalKeys(env as never));
  if (!verified.ok) return Response.json({ error: "unauthorized", reason: verified.reason }, { status: 401 });
  const read = verified.principal.scope.includes("secondary.read");
  const canWrite = verified.principal.scope.includes("secondary.personal.write");
  if (!read || (write && !canWrite)) {
    return Response.json({ error: "insufficient_scope", reason: "insufficient_scope" }, { status: 403 });
  }
  const who = await sessionIdentity(env, ctx, verified.principal);
  if (who instanceof Response) return who;
  if (!verified.principal.client_id) {
    return Response.json({ error: "invalid_client", reason: "invalid_client" }, { status: 400 });
  }
  return { ...who, clientId: verified.principal.client_id };
}

function deniedBrain(who: { principalId: string; tenantId: string }, brain: unknown, tenantId: unknown, principalId: unknown) {
  if (typeof tenantId === "string" && tenantId !== who.tenantId) return "foreign_tenant";
  if (typeof principalId === "string" && principalId !== who.principalId) return "foreign_principal";
  if (typeof brain === "string" && brain !== personalBrain(who.principalId)) return "foreign_brain";
  return null;
}

async function ledgerGate(request: Request, env: HarnessEnv, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const write = request.method === "POST";
  const who = await ledgerCaller(request, env, ctx, write);
  if (who instanceof Response) return who;
  if (request.method === "GET") {
    const brain = url.searchParams.get("brain");
    const tenantId = url.searchParams.get("tenantId");
    const principalId = url.searchParams.get("principalId");
    const reason = deniedBrain(who, brain, tenantId, principalId);
    if (reason) return Response.json({ error: reason, reason }, { status: 403 });
    const result = await ledgerQuery(env, who.tenantId, {
      principalId: who.principalId,
      operation: url.searchParams.get("operation"),
      trust: url.searchParams.get("trust"),
      requestId: url.searchParams.get("requestId"),
      brainId: brain,
    });
    return Response.json(
      { ...result.body, principalId: who.principalId, tenantId: who.tenantId, brainId: personalBrain(who.principalId) },
      { status: result.status },
    );
  }
  if (!write) return Response.json({ error: "method" }, { status: 405 });
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(await request.text()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid_json", reason: "invalid_json" }, { status: 400 });
  }
  const reason = deniedBrain(who, payload.brain, payload.tenantId, payload.principalId);
  if (reason) return Response.json({ error: reason, reason }, { status: 403 });
  if (url.pathname === "/harness/ledger/fixture") {
    const keys = Object.keys(payload);
    if (keys.some((key) => key !== "fixture" && key !== "eventId")) {
      return Response.json({ error: "unknown_field", reason: "unknown_field" }, { status: 400 });
    }
    const fixture = syntheticFixture(payload.fixture);
    if (!fixture || typeof payload.eventId !== "string") {
      return Response.json({ error: "invalid_fixture", reason: "invalid_fixture" }, { status: 400 });
    }
    const requestId = crypto.randomUUID();
    const event = {
      eventId: payload.eventId,
      tenantId: who.tenantId,
      principalId: who.principalId,
      brainId: personalBrain(who.principalId),
      runId: requestId,
      operation: "provider_fixture",
      requestId,
      providerRequestId: null,
      streamSeq: null,
      retryOf: null,
      describesRequestId: null,
      payloadHash: await canonicalHash({ fixture: payload.fixture, eventId: payload.eventId, ...fixture }),
      reportedAt: null,
      serverAt: new Date().toISOString(),
      updatedAt: null,
      ...fixture,
    };
    const saved = await ledgerAppend(env, who.tenantId, event);
    return Response.json({ ...saved.body, usageTrust: fixture.trust, providerVerified: false }, { status: saved.status });
  }
  const checked = validateClientReport(payload);
  if (!checked.ok) return Response.json({ error: checked.error, reason: checked.error, field: checked.field ?? null }, { status: 400 });
  if (checked.report.brain && checked.report.brain !== personalBrain(who.principalId)) {
    return Response.json({ error: "foreign_brain", reason: "foreign_brain" }, { status: 403 });
  }
  if (checked.report.describesRequestId) {
    const prior = await ledgerQuery(env, who.tenantId, {
      principalId: who.principalId,
      requestId: checked.report.describesRequestId,
    });
    if (!prior.ok) return Response.json({ error: "foreign_request", reason: "foreign_request" }, { status: 403 });
  }
  const requestId = crypto.randomUUID();
  const event = {
    ...checked.report,
    brainId: personalBrain(who.principalId),
    tenantId: who.tenantId,
    principalId: who.principalId,
    runId: requestId,
    operation: "usage_report",
    requestId,
    clientId: who.clientId,
    trust: "client_reported",
    evidence: "client_report",
    providerVerified: false,
    payloadHash: await canonicalHash({ ...checked.report, trust: "client_reported" }),
    serverAt: new Date().toISOString(),
    updatedAt: null,
  };
  const saved = await ledgerAppend(env, who.tenantId, event);
  return Response.json({ ...saved.body, providerVerified: false }, { status: saved.status });
}

function orgDenied() {
  return Response.json({ error: "org_denied", reason: "org_denied", orgAcl: false }, { status: 403 });
}

async function personalPlanGate(request: Request, env: HarnessEnv, ctx: ExecutionContext) {
  if (request.method !== "GET") return Response.json({ error: "method", reason: "method", write: false }, { status: 405 });
  if (request.headers.get("cf-connecting-ip")) {
    return Response.json({ error: "public_edge", reason: "public_edge" }, { status: 401 });
  }
  const verified = await verifyInternalRequest(request, internalKeys(env as never));
  if (!verified.ok) return Response.json({ error: "unauthorized", reason: verified.reason }, { status: 401 });
  if (verified.principal.persona) return Response.json({ error: "persona_denied", reason: "persona_denied", orgAcl: false }, { status: 403 });
  if (!verified.principal.scope.includes("secondary.read")) {
    return Response.json({ error: "insufficient_scope", reason: "insufficient_scope", write: false }, { status: 403 });
  }
  const principal = { ...verified.principal };
  delete principal.persona;
  const who = await sessionIdentity(env, ctx, principal);
  if (who instanceof Response) return who;
  const url = new URL(request.url);
  const ownNode = `pb:${who.principalId}`;
  const nodeId = url.searchParams.get("nodeId");
  const brain = url.searchParams.get("brain");
  const owner = url.searchParams.get("owner") ?? url.searchParams.get("principalId");
  const tenantId = url.searchParams.get("tenantId");
  const email = url.searchParams.get("email");
  if (url.searchParams.get("persona") || url.searchParams.get("prompt")) return orgDenied();
  if (nodeId && nodeId !== ownNode) return orgDenied();
  if (brain && brain !== "me" && brain !== ownNode) return orgDenied();
  if (owner && owner !== who.principalId) return orgDenied();
  if (tenantId && tenantId !== who.tenantId) return orgDenied();
  if (email && email.toLowerCase() !== verified.principal.email.toLowerCase()) return orgDenied();
  const listed = await importRpc(env, who.tenantId, "/import/list", {
    principalId: who.principalId,
    limit: url.searchParams.get("limit") ?? "20",
    cursor: url.searchParams.get("cursor"),
  });
  if (!listed.ok) return Response.json(listed.body, { status: listed.status });
  const page = Array.isArray(listed.body.items) ? listed.body.items : [];
  const context = [];
  for (const row of page) {
    const full = await ownItem(env, who.tenantId, who.principalId, String(row.id));
    const view = full ? present(full) : null;
    if (view) context.push(view);
  }
  const itemId = url.searchParams.get("item");
  if (itemId) {
    const owned = await ownItem(env, who.tenantId, who.principalId, itemId);
    const view = owned ? present(owned) : null;
    if (!view) return Response.json({ error: "not_found", reason: "not_found", write: false }, { status: 404 });
    const one = personalPlan({
      principalId: who.principalId,
      tenantId: who.tenantId,
      items: [view],
      total: 1,
      complete: true,
    });
    return Response.json({ ...one, focused: true });
  }
  const total = Number(listed.body.total ?? context.length);
  const plan = personalPlan({
    principalId: who.principalId,
    tenantId: who.tenantId,
    items: context,
    total,
    complete: Boolean(listed.body.complete) && context.length === total,
  });
  return Response.json(plan);
}

async function genuiGate(request: Request, env: HarnessEnv, ctx: ExecutionContext) {
  const raw = await request.text();
  const next = () => app.fetch(new Request(request.url, { method: request.method, headers: request.headers, body: raw }), env, ctx);
  let payload: Record<string, unknown> = {};
  try {
    payload = raw ? JSON.parse(raw) as Record<string, unknown> : {};
  } catch {
    return next();
  }
  const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
  if (!prompt) return next();
  const verified = await verifyInternalRequest(
    new Request(request.url, { method: request.method, headers: request.headers, body: raw }),
    internalKeys(env as never),
  );
  if (!verified.ok) return next();
  const email = verified.principal.email.trim().toLowerCase();
  const local = email.split("@")[0] ?? "";
  if (verified.principal.persona && local !== verified.principal.persona) return orgDenied();
  const principal = { ...verified.principal };
  delete principal.persona;
  const meUrl = "https://api.internal/v1/me";
  const meHeaders = await signInternalRequest({
    secret: env.INTERNAL_HMAC_KEY ?? "",
    method: "GET",
    url: meUrl,
    principal,
  });
  const me = await app.fetch(new Request(meUrl, { method: "GET", headers: { ...meHeaders, accept: "application/json" } }), env, ctx);
  if (!me.ok) return next();
  const body = await me.json() as { principal?: { roleIds?: string[] } };
  const roles = Array.isArray(body.principal?.roleIds) ? body.principal.roleIds : [];
  if (roles.length === 0) return orgDenied();
  return next();
}

function shimLocalDurableObjects(env: HarnessEnv): HarnessEnv {
  if ((env as { LOCAL_DO_SHIM?: string }).LOCAL_DO_SHIM !== "workerd") return env;
  const wrap = (ns: DurableObjectNamespace) => new Proxy(ns, {
    get(target, prop, receiver) {
      if (prop === "jurisdiction") return () => target;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return new Proxy(env, {
    get(target, prop, receiver) {
      if (prop === "TENANT_POLICY" || prop === "WORKSPACE" || prop === "USAGE_LEDGER") {
        const ns = Reflect.get(target, prop, receiver);
        return ns ? wrap(ns as DurableObjectNamespace) : ns;
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as HarnessEnv;
}

export default {
  async fetch(request: Request, env: HarnessEnv, ctx: ExecutionContext): Promise<Response> {
    env = shimLocalDurableObjects(env);
    const url = new URL(request.url);
    if (url.pathname === "/harness/personal/plan") return personalPlanGate(request, env, ctx);
    if (url.pathname === "/v1/genui/plan" && request.method === "POST") return genuiGate(request, env, ctx);
    if (url.pathname === "/harness/ledger" || url.pathname === "/harness/ledger/fixture") {
      return ledgerGate(request, env, ctx);
    }
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
