// Append-only audit log. Reachable only through service bindings:
//  - wrangler.jsonc turns off workers.dev and preview URLs and declares no routes, so there is no public URL;
//  - every request must carry `X-Audit-Key`, a secret that only the bound workers hold. There are three
//    keys: one append key per writer (api, mcp) and one read key (api only, for the Auditor views).
//    The key decides the receipt `source`, so a writer cannot claim to be the other one, and the
//    MCP worker, which faces the internet, holds no read key;
//  - as defence in depth, a request that carries CF-Connecting-IP (public traffic) is refused.
// Each receipt is written once as its own R2 object holding one JSON line, keyed by date and tenant.
// Nothing here updates or deletes. Receipts hold who, what, where and the decision, never content.

import { Hono } from "hono";
import {
  PRINCIPAL_ID,
  parseReceipt,
  type ReceiptSource,
  TENANT_ID,
} from "../../../packages/contracts/src/audit-receipt.ts";


const MAX_BYTES = 4_096;

/** Constant-time string comparison (length is not secret here, the content is). */
function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

type Role = { kind: "append"; source: ReceiptSource } | { kind: "read" };

const app = new Hono<{ Bindings: Env; Variables: { role: Role } }>();

function roleOf(c: { env: Env; req: { header: (n: string) => string | undefined } }): Role | null {
  const given = c.req.header("X-Audit-Key") ?? "";
  if (!given) return null;
  const keys: [string | undefined, Role][] = [
    [c.env.AUDIT_KEY_API, { kind: "append", source: "api" }],
    [c.env.AUDIT_KEY_MCP, { kind: "append", source: "mcp" }],
    [c.env.AUDIT_KEY_READ, { kind: "read" }],
  ];
  let found: Role | null = null;
  // Compare against every configured key so timing does not reveal which one matched.
  for (const [key, role] of keys) if (key && key.length >= 32 && safeEqual(given, key)) found = role;
  return found;
}

app.use("*", async (c, next) => {
  if (c.req.header("CF-Connecting-IP")) return c.json({ error: "forbidden" }, 403);
  const role = roleOf(c);
  if (!role) return c.json({ error: "unauthorized" }, 401);
  c.set("role", role);
  await next();
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
});

const str = (v: unknown, re: RegExp): string | null =>
  typeof v === "string" && re.test(v) ? v : null;

app.post("/append", async (c) => {
  const role = c.get("role");
  if (role.kind !== "append") return c.json({ error: "forbidden" }, 403);
  const raw = await c.req.text();
  if (raw.length > MAX_BYTES) return c.json({ error: "payload_too_large" }, 413);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const receipt = parseReceipt(parsed, role.source);
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
  if (c.get("role").kind !== "read") return c.json({ error: "forbidden" }, 403);
  const tenant = str(c.req.query("tenant"), TENANT_ID);
  const principalParam = c.req.query("principal");
  // No principal: the tenant's recent receipts (admin view). With one: that principal only.
  const principal = principalParam === undefined ? null : str(principalParam, PRINCIPAL_ID);
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
