/**
 * NEW RECONSTRUCTION usage policy. Not a recovered route.
 * Caller fields never choose a principal or tenant. Token numbers stay null
 * when they were not measured. Zero is only stored when a server path measured it.
 * Cost is unknown: this milestone has no versioned price list.
 */

export const MAX_TOKENS = 1_000_000_000;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,80}$/;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._: /-]{0,63}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const OUTCOMES = new Set(["ok", "failed", "cancelled", "partial"]);
const TOKEN_KEYS = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "totalTokens"];
const REPORT_KEYS = new Set([
  "eventId",
  "provider",
  "model",
  "providerRequestId",
  "streamSeq",
  "retryOf",
  "describesRequestId",
  "outcome",
  "reportedAt",
  "brain",
  ...TOKEN_KEYS,
]);

export function personalBrain(principalId) {
  return `personal:${principalId}`;
}

function token(value, key) {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_TOKENS) {
    return { ok: false, error: "invalid_tokens", field: key };
  }
  return { ok: true, value };
}

function optionalId(value, key) {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  if (typeof value !== "string" || !ID.test(value)) return { ok: false, error: "invalid_id", field: key };
  return { ok: true, value };
}

function optionalLabel(value, key) {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  if (typeof value !== "string" || !LABEL.test(value)) return { ok: false, error: "invalid_label", field: key };
  return { ok: true, value };
}

export function validateClientReport(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "invalid_report" };
  const extra = Object.keys(input).filter((key) => !REPORT_KEYS.has(key));
  if (extra.length) return { ok: false, error: "unknown_field", field: extra[0] };
  const eventId = optionalId(input.eventId, "eventId");
  if (!eventId.ok || !eventId.value) return { ok: false, error: eventId.error ?? "invalid_id", field: "eventId" };
  if (!OUTCOMES.has(input.outcome)) return { ok: false, error: "invalid_outcome" };
  const provider = optionalLabel(input.provider, "provider");
  if (!provider.ok) return provider;
  const model = optionalLabel(input.model, "model");
  if (!model.ok) return model;
  const providerRequestId = optionalId(input.providerRequestId, "providerRequestId");
  if (!providerRequestId.ok) return providerRequestId;
  const retryOf = optionalId(input.retryOf, "retryOf");
  if (!retryOf.ok) return retryOf;
  const describesRequestId = optionalId(input.describesRequestId, "describesRequestId");
  if (!describesRequestId.ok) return describesRequestId;
  let streamSeq = null;
  if (input.streamSeq !== undefined && input.streamSeq !== null) {
    if (typeof input.streamSeq !== "number" || !Number.isInteger(input.streamSeq) || input.streamSeq < 0 || input.streamSeq > 10000) {
      return { ok: false, error: "invalid_stream" };
    }
    streamSeq = input.streamSeq;
  }
  let reportedAt = null;
  if (input.reportedAt !== undefined && input.reportedAt !== null) {
    if (typeof input.reportedAt !== "string" || !ISO.test(input.reportedAt)) return { ok: false, error: "invalid_time" };
    reportedAt = input.reportedAt;
  }
  /** @type {Record<string, number | null>} */
  const tokens = {};
  for (const key of TOKEN_KEYS) {
    const parsed = token(input[key], key);
    if (!parsed.ok) return parsed;
    tokens[key] = parsed.value ?? null;
  }
  const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalTokens } = tokens;
  if (inputTokens !== null && outputTokens !== null && totalTokens !== null && totalTokens !== inputTokens + outputTokens) {
    return { ok: false, error: "inconsistent_total" };
  }
  if (
    totalTokens !== null &&
    inputTokens !== null &&
    outputTokens !== null &&
    ((cacheReadTokens !== null && totalTokens === inputTokens + outputTokens + cacheReadTokens) ||
      (cacheReadTokens !== null &&
        cacheWriteTokens !== null &&
        totalTokens === inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens))
  ) {
    return { ok: false, error: "inconsistent_total" };
  }
  if (totalTokens !== null && (inputTokens === null) !== (outputTokens === null)) {
    return { ok: false, error: "inconsistent_total" };
  }
  let brain = null;
  if (input.brain !== undefined && input.brain !== null) {
    if (typeof input.brain !== "string" || !/^personal:[A-Za-z0-9_.:-]{1,80}$/.test(input.brain)) {
      return { ok: false, error: "invalid_brain" };
    }
    brain = input.brain;
  }
  return {
    ok: true,
    report: {
      eventId: eventId.value,
      provider: provider.value,
      model: model.value,
      providerRequestId: providerRequestId.value,
      streamSeq,
      retryOf: retryOf.value,
      describesRequestId: describesRequestId.value,
      outcome: input.outcome,
      reportedAt,
      brain,
      ...tokens,
    },
  };
}

export function canonicalHash(value) {
  const text = JSON.stringify(value);
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then((digest) =>
    [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
  );
}

export function reportPayload(report) {
  return {
    brain: report.brain,
    cacheReadTokens: report.cacheReadTokens,
    cacheWriteTokens: report.cacheWriteTokens,
    describesRequestId: report.describesRequestId,
    eventId: report.eventId,
    inputTokens: report.inputTokens,
    model: report.model,
    outcome: report.outcome,
    outputTokens: report.outputTokens,
    provider: report.provider,
    providerRequestId: report.providerRequestId,
    retryOf: report.retryOf,
    streamSeq: report.streamSeq,
    totalTokens: report.totalTokens,
    trust: "client_reported",
  };
}

function monotonic(previous, next) {
  for (const key of TOKEN_KEYS) {
    const before = previous[key];
    const after = next[key];
    if (before === null && after === null) continue;
    if (before === null && after !== null) continue;
    if (before !== null && after === null) return false;
    if (after < before) return false;
  }
  return true;
}

export function decideAppend(existingById, streamRow, incoming) {
  if (existingById) {
    if (existingById.payloadHash === incoming.payloadHash) return { action: "idempotent", event: existingById };
    return { action: "conflict" };
  }
  if (incoming.providerRequestId && streamRow) {
    const previous = streamRow.streamSeq;
    const next = incoming.streamSeq;
    if (previous === null || next === null) return { action: "conflict" };
    if (next < previous) return { action: "conflict" };
    if (next === previous) {
      return streamRow.payloadHash === incoming.payloadHash
        ? { action: "idempotent", event: streamRow }
        : { action: "conflict" };
    }
    if (!monotonic(streamRow, incoming)) return { action: "conflict" };
    return {
      action: "replace",
      event: {
        ...streamRow,
        ...Object.fromEntries(TOKEN_KEYS.map((key) => [key, incoming[key]])),
        streamSeq: next,
        payloadHash: incoming.payloadHash,
        updatedAt: incoming.serverAt,
      },
    };
  }
  return { action: "insert" };
}

function rank(event) {
  if (event.trust === "provider_reported") return 3;
  if (event.trust === "server_measured") return 2;
  if (event.trust === "client_reported") return 1;
  return 0;
}

export function summarize(events) {
  const operations = new Set(events.filter((event) => event.operation === "import").map((event) => event.requestId));
  const counted = [];
  const groups = new Map();
  for (const event of events) {
    if (event.describesRequestId) continue;
    const key = event.providerRequestId || event.eventId;
    const list = groups.get(key) ?? [];
    list.push(event);
    groups.set(key, list);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => rank(b) - rank(a) || String(b.streamSeq ?? -1) - String(a.streamSeq ?? -1));
    counted.push(list[0]);
  }
  const dimension = (key) => {
    let unknownEvents = 0;
    let knownEvents = 0;
    let value = 0;
    for (const event of counted) {
      if (event.trust === "synthetic_fixture" || event.evidence === "synthetic_fixture") continue;
      if (event.trust === "unknown") {
        unknownEvents += 1;
        continue;
      }
      const tokenValue = event[key];
      if (tokenValue === null || tokenValue === undefined) unknownEvents += 1;
      else {
        knownEvents += 1;
        value += tokenValue;
      }
    }
    if (knownEvents === 0) return { value: null, complete: false, unknownEvents, knownEvents };
    return { value, complete: unknownEvents === 0, unknownEvents, knownEvents };
  };
  const trustCount = (trust) => events.filter((event) => event.trust === trust).length;
  return {
    operations: operations.size,
    events: events.length,
    tokenCoverage: {
      unknown: trustCount("unknown"),
      clientReported: trustCount("client_reported"),
      serverMeasured: trustCount("server_measured"),
      syntheticFixture: events.filter((event) => event.evidence === "synthetic_fixture").length,
    },
    input: dimension("inputTokens"),
    output: dimension("outputTokens"),
    cacheRead: dimension("cacheReadTokens"),
    cacheWrite: dimension("cacheWriteTokens"),
    total: dimension("totalTokens"),
    cost: "unknown",
    pricingVersion: null,
    providerVerified: false,
  };
}

export function syntheticFixture(name) {
  if (name === "measured-zero") {
    return {
      trust: "synthetic_fixture",
      evidence: "synthetic_fixture",
      providerVerified: false,
      provider: "synthetic",
      model: "synthetic-echo",
      outcome: "ok",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
    };
  }
  if (name === "provider-sample") {
    return {
      trust: "synthetic_fixture",
      evidence: "synthetic_fixture",
      providerVerified: false,
      provider: "synthetic",
      model: "synthetic-echo",
      outcome: "ok",
      inputTokens: 11,
      outputTokens: 7,
      cacheReadTokens: 2,
      cacheWriteTokens: 0,
      totalTokens: 18,
    };
  }
  if (name === "cancelled-unknown") {
    return {
      trust: "synthetic_fixture",
      evidence: "synthetic_fixture",
      providerVerified: false,
      provider: "synthetic",
      model: "synthetic-echo",
      outcome: "cancelled",
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      totalTokens: null,
    };
  }
  return null;
}
