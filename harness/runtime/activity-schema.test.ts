import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { SCHEMA_SHA256, parseNdjson, recordHash, validateRecord } from "../../reconstruction/activity/validate.mjs";

function record(id, notes = "synthetic fixture") {
  return {
    schema_version: "relay.codex-review-run/1",
    record_id: id,
    capture: "historical-manual",
    agent: "Relay",
    tool: { name: "codex-cli", version: null, machine_label: null, model: null, reasoning_effort: null, sandbox: null },
    session_id: null,
    started_at: "2026-11-01T10:00:00-03:00",
    finished_at: "2026-11-01T11:00:00-03:00",
    timezone: "America/Sao_Paulo",
    analysis_kind: "static",
    target: { label: "synthetic fixture label", archive_sha256: null, bundle_sha256: null, tree: null, baseline_head: null, patch_sha256: null },
    outcome: { completed: true, exit_code: null, overall_verdict: null, counts: { high: null, medium: null, low: null, fixed: null, cannot_determine: null } },
    tokens_used: null,
    writes_detected: false,
    context_scope: { usual_notes_loaded: null, out_of_folder_reads_observed: null, artifact_only_enforced: false },
    evidence_paths: ["/workspace/synthetic/evidence.txt"],
    notes,
  };
}

test("the review schema hash is pinned and extra fields fail closed", async () => {
  const bytes = readFileSync("reconstruction/activity/relay.codex-review-run-1.schema.json");
  assert.equal(createHash("sha256").update(bytes).digest("hex"), SCHEMA_SHA256);
  const parsed = await parseNdjson(`${JSON.stringify(record("relay-synthetic-1"))}\n`);
  assert.equal(parsed.incomplete, false);
  assert.equal(parsed.records[0].tokens_used, null);
  assert.equal(parsed.records[0].outcome.counts.high, null);
  const extra = record("relay-synthetic-1");
  extra.owner = "u_ceo";
  assert.throws(() => validateRecord(extra), /unknown_field/);
  const tail = `${JSON.stringify(record("relay-synthetic-1"))}\n{"record_id":`;
  const incomplete = await parseNdjson(tail);
  assert.equal(incomplete.incomplete, true);
  assert.equal(incomplete.records.length, 1);
  assert.notEqual(await recordHash(record("relay-synthetic-1", "one")), await recordHash(record("relay-synthetic-1", "two")));
  const multibyte = record("relay-synthetic-1", "synthetic fixture café 日本語");
  assert.equal(validateRecord(multibyte).notes, "synthetic fixture café 日本語");
  assert.equal(new TextEncoder().encode(JSON.stringify(multibyte)).byteLength > JSON.stringify(multibyte).length, true);
  const huge = record("relay-synthetic-1", "x");
  huge.notes = "x".repeat(70_000);
  assert.throws(() => validateRecord(huge), /record_too_large/);
});
