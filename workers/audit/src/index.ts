// Append-only audit log. Reachable only through the API worker's service binding:
//  - wrangler.jsonc turns off workers.dev and preview URLs and declares no routes, so there is no public URL;
//  - as defence in depth, any request that carries CF-Connecting-IP (set by the edge on public traffic,
//    absent on service-binding calls) is refused.
// Each receipt is written once as its own R2 object holding one JSON line, keyed by date and tenant.
// Nothing here updates or deletes. Receipts hold who, what, where and the decision, never content.

import { Hono } from "hono";

const app = new Hono<{ Bindings: Env }>();

const MAX_BYTES = 4_096;
const ID = /^[A-Za-z0-9_.:@-]{1,128}$/;
const TENANT = /^[a-z0-9_]{3,64}$/;
const DECISIONS = new Set(["allow", "deny", "rejected"]);

app.use("*", async (c, next) => {
  if (c.req.header("CF-Connecting-IP")) return c.json({ error: "forbidden" }, 403);
  await next();
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
});

const str = (v: unknown, re: RegExp): string | null =>
  typeof v === "string" && re.test(v) ? v : null;
const nullable = (v: unknown, re: RegExp): string | null | undefined =>
  v === null ? null : (str(v, re) ?? undefined);

/** Picks exactly the allowed fields. Anything else in the body is dropped, so content cannot ride along. */
function parseReceipt(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const receiptId = str(o.receiptId, /^rcpt_[0-9a-f-]{36}$/);
  const tenantId = str(o.tenantId, TENANT);
  const principalId = str(o.principalId, ID);
  const action = str(o.action, /^[a-z_]{1,40}$/);
  const nodeId = nullable(o.nodeId, ID);
  const scopeId = nullable(o.scopeId, ID);
  const requestId = nullable(o.requestId, /^[0-9a-f-]{36}$/);
  const clientId = o.clientId === undefined ? null : nullable(o.clientId, ID);
  const tool = o.tool === undefined ? null : nullable(o.tool, /^[A-Za-z0-9_.-]{1,60}$/);
  const at = typeof o.at === "string" && Number.isFinite(Date.parse(o.at)) ? o.at : null;
  const reason = typeof o.reason === "string" ? o.reason.slice(0, 300) : null;
  const revision =
    o.revision === null || (Number.isInteger(o.revision) && (o.revision as number) >= 0)
      ? (o.revision as number | null)
      : undefined;
  const decision = typeof o.decision === "string" && DECISIONS.has(o.decision) ? o.decision : null;
  if (
    !receiptId ||
    !tenantId ||
    !principalId ||
    !action ||
    !at ||
    reason === null ||
    !decision ||
    nodeId === undefined ||
    scopeId === undefined ||
    requestId === undefined ||
    clientId === undefined ||
    tool === undefined ||
    revision === undefined
  )
    return null;
  return {
    receiptId,
    at,
    tenantId,
    principalId,
    action,
    nodeId,
    scopeId,
    decision,
    reason,
    revision,
    requestId,
    clientId,
    tool,
  };
}

app.post("/append", async (c) => {
  const raw = await c.req.text();
  if (raw.length > MAX_BYTES) return c.json({ error: "payload_too_large" }, 413);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const receipt = parseReceipt(parsed);
  if (!receipt) return c.json({ error: "invalid_receipt" }, 400);

  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const key = `${date}/${receipt.tenantId}/${now.getTime()}-${receipt.receiptId}.jsonl`;
  const line = `${JSON.stringify({ ...receipt, receivedAt: now.toISOString() })}\n`;
  // Never overwrite: a second write to the same key is refused.
  const stored = await c.env.AUDIT_LOG.put(key, line, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: "application/x-ndjson" },
  });
  if (!stored) return c.json({ error: "exists" }, 409);
  return c.json({ ok: true, key }, 202);
});

// The API only calls this for the Auditor role. Reading is scoped to one tenant and one principal.
app.get("/receipts", async (c) => {
  const tenant = str(c.req.query("tenant"), TENANT);
  const principalParam = c.req.query("principal");
  // No principal: the tenant's recent receipts (admin view). With one: that principal only.
  const principal = principalParam === undefined ? null : str(principalParam, ID);
  if (!tenant || (principalParam !== undefined && !principal))
    return c.json({ error: "invalid_query" }, 400);
  const days = Math.min(Math.max(Number.parseInt(c.req.query("days") ?? "7", 10) || 7, 1), 30);

  const keys: string[] = [];
  for (let d = 0; d < days && keys.length < 1000; d++) {
    const date = new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
    let cursor: string | undefined;
    do {
      const page = await c.env.AUDIT_LOG.list({
        prefix: `${date}/${tenant}/`,
        ...(cursor ? { cursor } : {}),
      });
      keys.push(...page.objects.map((o) => o.key));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor && keys.length < 1000);
  }
  const lines = await Promise.all(
    keys.slice(0, 1000).map(async (k) => (await (await c.env.AUDIT_LOG.get(k))?.text()) ?? ""),
  );
  const receipts = lines
    .flatMap((l) => (l.trim() ? [JSON.parse(l) as { principalId: string; at: string }] : []))
    .filter((r) => principal === null || r.principalId === principal)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 200);
  return c.json({ receipts });
});

app.all("*", (c) => c.json({ error: "not_found" }, 404));
app.onError((_e, c) => c.json({ error: "internal_error" }, 500));

export default app;
