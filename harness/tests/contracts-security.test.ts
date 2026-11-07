/**
 * Isolated tests of recovered receipt parsing, log redaction, and ops HMAC.
 * The replay store below is an in-memory test double of the recovered ReplayStore
 * interface. It is not a Durable Object and it stores nothing outside this process.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { parseReceipt } from "../../recovered-source/shared/packages/contracts/src/audit-receipt.ts";
import {
  buildLogLine,
  principalHash,
  redact,
} from "../../recovered-source/shared/packages/contracts/src/log.ts";
import {
  OPS_HEADER_SIGNATURE,
  signOpsRequest,
  verifyOpsRequest,
} from "../../recovered-source/shared/packages/contracts/src/ops-auth.ts";
import { keyringFromEnv, ringOf } from "../../recovered-source/shared/packages/contracts/src/signed-call.ts";

const SECRET = "synthetic-test-secret-not-a-key!!";
const URL = "https://api.invalid/v1/internal/ops/ping";
const NOW = 1_700_000_000;

function memoryReplay() {
  const seen = new Set<string>();
  return {
    async first(key: string): Promise<boolean> {
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    },
  };
}

const validReceipt = {
  receiptId: "rcpt_12345678-1234-1234-1234-123456789abc",
  at: "2026-11-07T00:00:00.000Z",
  tenantId: "tenant_mantu_synthetic",
  principalId: "u_consultant",
  action: "view_content",
  decision: "allow",
  reason: "Granted",
  body: "this text must not survive parsing",
  source: "mcp",
};

test("parseReceipt keeps the caller-supplied source and drops extra fields", () => {
  const parsed = parseReceipt(validReceipt, "api");
  assert.ok(parsed);
  assert.equal(parsed.source, "api");
  assert.equal(parsed.nodeId, null);
  assert.equal(parsed.scopeIds.length, 0);
  assert.equal(Object.hasOwn(parsed, "body"), false);
  assert.equal(JSON.stringify(parsed).includes("must not survive"), false);
  assert.equal(parseReceipt({ ...validReceipt, receiptId: "rcpt_not-a-valid-id" }, "api"), null);
  assert.equal(parseReceipt({ ...validReceipt, decision: "maybe" }, "api"), null);
});

test("log lines keep allowlisted keys and redact emails, bearers, and secrets", () => {
  const line = buildLogLine({
    event: "ready",
    route: "user ada@example.invalid Bearer abc.def.ghi secret=not-a-real-secret",
    body: "drop this",
    email: "ada@example.invalid",
  });
  assert.equal(line.event, "ready");
  assert.equal(line.body, undefined);
  assert.equal(line.email, undefined);
  const route = String(line.route);
  assert.match(route, /\[email\]/);
  assert.match(route, /\[token\]/);
  assert.match(route, /secret=\[redacted\]/);
  assert.equal(route.includes("ada@example.invalid"), false);
  assert.equal(route.includes("not-a-real-secret"), false);
  assert.equal(redact("x".repeat(80)), "[token]");
  assert.equal(redact(`${"safe phrase ".repeat(30)}`).endsWith("..."), true);
});

test("principalHash is stable, short, and differs by principal", async () => {
  const consultant = await principalHash("u_consultant");
  assert.equal(consultant, await principalHash("u_consultant"));
  assert.match(consultant, /^[0-9a-f]{16}$/);
  assert.notEqual(consultant, await principalHash("u_ceo"));
});

test("ops signatures verify once, then fail closed on replay, skew, and tampering", async () => {
  assert.deepEqual(ringOf(undefined), {});
  assert.deepEqual(ringOf(SECRET), { k1: SECRET });
  const ring = keyringFromEnv(SECRET, "k2", "previous-synthetic-secret-value!!", "k0");
  assert.equal(ring.k2, SECRET);
  assert.equal(ring.k0, "previous-synthetic-secret-value!!");

  const body = '{"ok":true}';
  const headers = await signOpsRequest({ secret: SECRET, method: "POST", url: URL, body, now: NOW });
  const replay = memoryReplay();
  const first = new Request(URL, { method: "POST", headers, body });
  assert.equal(await verifyOpsRequest(first, SECRET, { now: NOW, replay }), true);
  const again = new Request(URL, { method: "POST", headers, body });
  assert.equal(await verifyOpsRequest(again, SECRET, { now: NOW, replay }), false);

  const skewed = new Request(URL, { method: "POST", headers, body });
  assert.equal(await verifyOpsRequest(skewed, SECRET, { now: NOW + 120 }), false);

  const tampered = { ...headers, [OPS_HEADER_SIGNATURE]: `v2=${"ab".repeat(32)}` };
  const bad = new Request(URL, { method: "POST", headers: tampered, body });
  assert.equal(await verifyOpsRequest(bad, SECRET, { now: NOW }), false);
  assert.equal(await verifyOpsRequest(new Request(URL, { method: "POST", body }), undefined, { now: NOW }), false);

  await assert.rejects(
    () => signOpsRequest({ secret: "too-short", method: "GET", url: URL, now: NOW }),
    /ops secret too short/,
  );
});
