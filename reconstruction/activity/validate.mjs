/**
 * NEW RECONSTRUCTION consumer for relay.codex-review-run/1.
 * The schema file is pinned. This module does not fetch its $schema URL.
 * Evidence paths are strings, not locations to open.
 */
export const SCHEMA_SHA256 = "7ec06819c880305c91c7eba47b383715c765810c4dcbe4e8380f0d6348993fbb";
export const SCHEMA_VERSION = "relay.codex-review-run/1";
const LEDGER_BYTES = 2_097_152;
const RECORD_BYTES = 65_536;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-03:00$/;
const RECORD_ID = /^relay-[a-zA-Z0-9-]+$/;
const HEX64 = /^[a-f0-9]{64}$/;
const HEX40 = /^[a-f0-9]{40}$/;
const PATH = /^\/workspace\/[^\n\r]+$/;

/**
 * @typedef {{
 *   record_id: string,
 *   session_id: string | null,
 *   capture: string,
 *   agent: string,
 *   tool: { name: string },
 *   started_at: string | null,
 *   finished_at: string | null,
 *   analysis_kind: string,
 *   target: { label: string | null },
 *   outcome: { completed: boolean, exit_code: number | null, overall_verdict: string | null, counts: Record<string, number | null> },
 *   tokens_used: number | null,
 *   writes_detected: boolean,
 *   context_scope: { usual_notes_loaded: boolean | null },
 *   evidence_paths: string[],
 *   notes: string
 * }} ReviewRecord
 */

/**
 * @param {BufferSource} bytes
 * @returns {Promise<string>}
 */
async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

/**
 * @param {string} reason
 * @returns {Error & { reason: string }}
 */
function fail(reason) {
  return Object.assign(new Error(reason), { reason });
}

/**
 * @param {unknown} error
 * @returns {error is Error & { reason: string }}
 */
function hasReason(error) {
  return error instanceof Error && "reason" in error && typeof error.reason === "string" && error.reason !== "";
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {value is unknown[]}
 */
function isUnknownArray(value) {
  return Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function nullableString(value) {
  return value === null || typeof value === "string";
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function nullableInt(value) {
  return value === null || (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1_000_000_000);
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function nullableTime(value) {
  return value === null || (typeof value === "string" && TIME.test(value));
}

/**
 * @param {unknown} value
 * @param {readonly string[]} keys
 * @returns {value is Record<string, unknown>}
 */
function exactKeys(value, keys) {
  if (!isRecord(value)) return false;
  const present = Object.keys(value);
  return present.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/**
 * @param {string} text
 * @returns {number}
 */
function utf8Bytes(text) {
  return new TextEncoder().encode(text).byteLength;
}

/**
 * @param {string} text
 * @returns {ReviewRecord}
 */
export function parseStoredRecord(text) {
  let parsed;
  try {
    parsed = JSON.parse(String(text ?? ""));
  } catch {
    throw fail("stored_record_invalid");
  }
  try {
    return validateRecord(parsed);
  } catch (error) {
    if (hasReason(error)) throw error;
    throw fail("stored_record_invalid");
  }
}

/**
 * @param {unknown} value
 * @returns {ReviewRecord}
 */
export function validateRecord(value) {
  if (reviewRecordOk(value)) return value;
  throw fail("malformed_record");
}

/**
 * @param {unknown} value
 * @returns {value is ReviewRecord}
 */
function reviewRecordOk(value) {
  if (!isRecord(value)) throw fail("malformed_record");
  const encoded = JSON.stringify(value);
  if (utf8Bytes(encoded) > RECORD_BYTES) throw fail("record_too_large");
  if (!exactKeys(value, [
    "schema_version", "record_id", "capture", "agent", "tool", "session_id", "started_at", "finished_at",
    "timezone", "analysis_kind", "target", "outcome", "tokens_used", "writes_detected", "context_scope",
    "evidence_paths", "notes",
  ])) throw fail("unknown_field");
  if (value.schema_version !== SCHEMA_VERSION) throw fail("unknown_schema");
  if (typeof value.record_id !== "string" || !RECORD_ID.test(value.record_id)) throw fail("invalid_record_id");
  if (value.capture !== "historical-manual" && value.capture !== "live-exporter") throw fail("invalid_capture");
  if (value.agent !== "Relay") throw fail("invalid_agent");
  if (!exactKeys(value.tool, ["name", "version", "machine_label", "model", "reasoning_effort", "sandbox"])) throw fail("unknown_field");
  if (value.tool.name !== "codex-cli" || !nullableString(value.tool.version) || !nullableString(value.tool.machine_label) || !nullableString(value.tool.model) || !nullableString(value.tool.reasoning_effort) || !nullableString(value.tool.sandbox)) {
    throw fail("invalid_tool");
  }
  if (!nullableString(value.session_id)) throw fail("invalid_session");
  if (!nullableTime(value.started_at) || !nullableTime(value.finished_at)) throw fail("invalid_time");
  if (value.timezone !== "America/Sao_Paulo") throw fail("invalid_timezone");
  if (value.analysis_kind !== "static" && value.analysis_kind !== "runtime") throw fail("invalid_kind");
  if (!exactKeys(value.target, ["label", "archive_sha256", "bundle_sha256", "tree", "baseline_head", "patch_sha256"])) throw fail("unknown_field");
  if (!nullableString(value.target.label)) throw fail("invalid_target");
  for (const key of ["archive_sha256", "bundle_sha256", "patch_sha256"]) {
    if (!(value.target[key] === null || (typeof value.target[key] === "string" && HEX64.test(value.target[key])))) throw fail("invalid_target");
  }
  for (const key of ["tree", "baseline_head"]) {
    if (!(value.target[key] === null || (typeof value.target[key] === "string" && HEX40.test(value.target[key])))) throw fail("invalid_target");
  }
  if (!exactKeys(value.outcome, ["completed", "exit_code", "overall_verdict", "counts"])) throw fail("unknown_field");
  if (typeof value.outcome.completed !== "boolean" || !nullableInt(value.outcome.exit_code) || !nullableString(value.outcome.overall_verdict)) {
    throw fail("invalid_outcome");
  }
  if (!exactKeys(value.outcome.counts, ["high", "medium", "low", "fixed", "cannot_determine"])) throw fail("unknown_field");
  for (const key of ["high", "medium", "low", "fixed", "cannot_determine"]) {
    if (!nullableInt(value.outcome.counts[key])) throw fail("invalid_counts");
  }
  if (!nullableInt(value.tokens_used)) throw fail("invalid_tokens");
  if (typeof value.writes_detected !== "boolean") throw fail("invalid_writes");
  if (!exactKeys(value.context_scope, ["usual_notes_loaded", "out_of_folder_reads_observed", "artifact_only_enforced"])) throw fail("unknown_field");
  if (!(value.context_scope.usual_notes_loaded === null || typeof value.context_scope.usual_notes_loaded === "boolean")) throw fail("invalid_context");
  const reads = value.context_scope.out_of_folder_reads_observed;
  if (!(reads === null || (typeof reads === "string" && reads.length <= 200) || nullableInt(reads))) throw fail("invalid_context");
  if (value.context_scope.artifact_only_enforced !== false) throw fail("invalid_context");
  if (!isUnknownArray(value.evidence_paths) || value.evidence_paths.length < 1 || value.evidence_paths.some((item) => typeof item !== "string" || !PATH.test(item))) {
    throw fail("invalid_evidence");
  }
  if (typeof value.notes !== "string" || value.notes.length > 2000) throw fail("invalid_notes");
  return true;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function stable(value) {
  if (isUnknownArray(value)) return `[${value.map((item) => stable(item)).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalRecord(value) {
  return stable(value);
}

/**
 * @param {unknown} value
 * @returns {Promise<string>}
 */
export async function recordHash(value) {
  return sha256Hex(new TextEncoder().encode(canonicalRecord(value)));
}

/**
 * @param {string | Uint8Array} bytes
 * @returns {Promise<{ records: ReviewRecord[], incomplete: boolean, ledgerSha256: string, byteLength: number }>}
 */
export async function parseNdjson(bytes) {
  const encoded = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  if (encoded.byteLength > LEDGER_BYTES) throw fail("ledger_too_large");
  let text;
  try {
    // workers-types requires ignoreBOM beside fatal. false is the runtime default.
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(encoded);
  } catch {
    throw fail("malformed_record");
  }
  const ledgerSha256 = await sha256Hex(encoded);
  const lines = text.split("\n");
  let incomplete = false;
  if (text.length > 0 && !text.endsWith("\n")) {
    const tail = lines.pop() ?? "";
    if (tail.trim() !== "") {
      try {
        JSON.parse(tail);
        lines.push(tail);
      } catch {
        incomplete = true;
      }
    }
  }
  /** @type {ReviewRecord[]} */
  const records = [];
  for (const line of lines) {
    if (line.trim() === "") continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw fail("malformed_record");
    }
    records.push(validateRecord(parsed));
  }
  return { records, incomplete, ledgerSha256, byteLength: encoded.byteLength };
}

/**
 * @param {string} kind
 * @returns {string}
 */
export function activityLabel(kind) {
  if (kind === "static") return "Static review";
  if (kind === "runtime") return "Runtime review";
  return "Review";
}

/**
 * @template {ReviewRecord} T
 * @param {T[]} records
 * @returns {T[]}
 */
export function sortRecords(records) {
  return [...records].sort((a, b) => {
    const finished = String(a.finished_at ?? "").localeCompare(String(b.finished_at ?? ""));
    if (finished !== 0) return finished;
    const started = String(a.started_at ?? "").localeCompare(String(b.started_at ?? ""));
    if (started !== 0) return started;
    return a.record_id.localeCompare(b.record_id);
  });
}

/**
 * @param {Date} [date]
 * @returns {string}
 */
export function brtNow(date = new Date()) {
  const shifted = new Date(date.getTime() - 3 * 60 * 60 * 1000);
  return `${shifted.toISOString().slice(0, 19)}-03:00`;
}

/**
 * @param {ReviewRecord} record
 * @returns {{
 *   id: string,
 *   session_id: string | null,
 *   capture: string,
 *   reported_by: { agent: string, tool: { name: string } },
 *   started_at: string | null,
 *   finished_at: string | null,
 *   when_brt: { start: string | null, finish: string | null },
 *   analysis_kind: string,
 *   activity_label: string,
 *   artifact_identity: { label: string | null },
 *   what_reviewed: string | null,
 *   outcome: ReviewRecord["outcome"],
 *   token_usage: { value: number | null, label: string },
 *   observed_writes_detected: boolean,
 *   context_scope: ReviewRecord["context_scope"],
 *   evidence_provenance_pointers: string[],
 *   untrusted_notes: string,
 *   trusted_runtime_capture: false,
 *   synthetic: boolean
 * }}
 */
export function viewRecord(record) {
  return {
    id: record.record_id,
    session_id: record.session_id,
    capture: record.capture,
    reported_by: { agent: record.agent, tool: record.tool },
    started_at: record.started_at,
    finished_at: record.finished_at,
    when_brt: { start: record.started_at, finish: record.finished_at },
    analysis_kind: record.analysis_kind,
    activity_label: activityLabel(record.analysis_kind),
    artifact_identity: record.target,
    what_reviewed: record.target.label,
    outcome: record.outcome,
    token_usage: { value: record.tokens_used, label: "Reported CLI tokens; not provider usage or billing" },
    observed_writes_detected: record.writes_detected,
    context_scope: record.context_scope,
    evidence_provenance_pointers: record.evidence_paths,
    untrusted_notes: record.notes,
    trusted_runtime_capture: false,
    synthetic: String(record.notes).toLowerCase().includes("synthetic fixture"),
  };
}

