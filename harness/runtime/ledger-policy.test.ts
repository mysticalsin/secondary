import assert from "node:assert/strict";
import { test } from "node:test";
import { decideAppend, summarize, syntheticFixture, validateClientReport } from "../../reconstruction/ledger/policy.mjs";

test("usage reports reject extra fields, bad totals, and keep unknown distinct from zero", () => {
  const bad = validateClientReport({
    eventId: "evt-1",
    outcome: "ok",
    inputTokens: 2,
    outputTokens: 2,
    totalTokens: 4,
    trust: "provider_reported",
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.error, "unknown_field");
  const doubled = validateClientReport({
    eventId: "evt-1",
    outcome: "ok",
    inputTokens: 2,
    outputTokens: 2,
    cacheReadTokens: 5,
    totalTokens: 9,
  });
  assert.equal(doubled.error, "inconsistent_total");
  const negative = validateClientReport({ eventId: "evt-1", outcome: "ok", inputTokens: -1 });
  assert.equal(negative.error, "invalid_tokens");
  const partial = validateClientReport({ eventId: "evt-1", outcome: "partial", inputTokens: 3, totalTokens: 3 });
  assert.equal(partial.error, "inconsistent_total");
  const ok = validateClientReport({
    eventId: "evt-1",
    outcome: "ok",
    inputTokens: 2,
    outputTokens: 2,
    cacheReadTokens: 5,
    totalTokens: 4,
    provider: "synthetic",
    model: "synthetic-echo",
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.report.totalTokens, 4);
  assert.equal(ok.report.cacheReadTokens, 5);
  const zero = syntheticFixture("measured-zero");
  const cancelled = syntheticFixture("cancelled-unknown");
  assert.equal(zero.inputTokens, 0);
  assert.equal(zero.trust, "server_measured");
  assert.equal(cancelled.inputTokens, null);
  assert.equal(cancelled.outcome, "cancelled");
  const summary = summarize([
    { eventId: "a", operation: "import", requestId: "r1", trust: "unknown", evidence: "server_clock", inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, totalTokens: null, providerRequestId: null, describesRequestId: null, streamSeq: null },
    { eventId: "b", operation: "provider_fixture", requestId: "r2", trust: "server_measured", evidence: "server_clock", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, providerRequestId: null, describesRequestId: null, streamSeq: null },
  ]);
  assert.equal(summary.operations, 1);
  assert.equal(summary.tokenCoverage.unknown, 1);
  assert.equal(summary.input.value, 0);
  assert.equal(summary.input.complete, false);
  assert.equal(summary.cost, "unknown");
});

test("stream snapshots replace totals and a conflicting replay does not add", () => {
  const base = {
    eventId: "evt-1",
    principalId: "u_a",
    providerRequestId: "preq-1",
    streamSeq: 1,
    payloadHash: "h1",
    inputTokens: 2,
    outputTokens: 1,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    totalTokens: 3,
    serverAt: "2026-11-07T00:00:00.000Z",
  };
  const same = decideAppend(base, base, { ...base });
  assert.equal(same.action, "idempotent");
  const conflict = decideAppend(base, base, { ...base, payloadHash: "h2", inputTokens: 9 });
  assert.equal(conflict.action, "conflict");
  const next = decideAppend(null, base, {
    ...base,
    eventId: "evt-2",
    streamSeq: 2,
    payloadHash: "h3",
    inputTokens: 5,
    outputTokens: 4,
    totalTokens: 9,
    serverAt: "2026-11-07T00:00:02.000Z",
  });
  assert.equal(next.action, "replace");
  assert.equal(next.event.eventId, "evt-1");
  assert.equal(next.event.inputTokens, 5);
  const retry = decideAppend(null, null, { ...base, eventId: "evt-3", providerRequestId: "preq-2", payloadHash: "h4" });
  assert.equal(retry.action, "insert");
  const described = summarize([
    { ...base, operation: "provider_fixture", requestId: "r", trust: "provider_reported", evidence: "synthetic_fixture", describesRequestId: null },
    { eventId: "client", operation: "usage_report", requestId: "c", trust: "client_reported", evidence: "client_report", providerRequestId: null, describesRequestId: "evt-1", inputTokens: 99, outputTokens: 99, cacheReadTokens: null, cacheWriteTokens: null, totalTokens: 198, streamSeq: null },
  ]);
  assert.equal(described.input.value, 2);
  assert.equal(described.tokenCoverage.clientReported, 1);
});
