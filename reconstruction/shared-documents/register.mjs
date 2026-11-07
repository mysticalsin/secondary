/**
 * Local reader for partial-shared-register-metadata-v1.
 * It does not fetch links, upload a register, or treat file claims as verified.
 */
/**
 * @param {string} text
 * @returns {{ ok: true, register: Record<string, unknown> } | { ok: false, error: string }}
 */
export function validateRegister(text) {
const SCHEMA = "partial-shared-register-metadata-v1";
const MAX_BYTES = 2_000_000;
const ROOT_KEYS = [
  "schema",
  "source_provenance",
  "source_coverage_statement",
  "historical_master_reconciliation",
  "counts",
  "conflicts",
  "records",
  "limitations",
];
const PROVENANCE_KEYS = [
  "archive_sha256",
  "archive_bytes",
  "manifest_sha256",
  "manifest_member",
  "checksums_sha256",
  "manifest_checksum_verified",
  "archive_members_validated",
  "archive_expanded_bytes",
];
const HISTORY_KEYS = ["reported_occurrences", "reported_sharing_events", "rowset_present", "coverage"];
const COUNT_KEYS = [
  "source_document_occurrences",
  "source_sharing_evidence_events",
  "policy_excluded_sharepoint_occurrences",
  "policy_excluded_sharepoint_events",
  "retained_occurrences",
  "retained_sharing_evidence_events",
  "dedup_candidates",
  "verified_unique_underlying_documents",
  "verified_content_copies",
  "identity_conflicts_or_variants",
  "omitted_unusable_shared_links",
];
const RECORD_KEYS = [
  "occurrence_id",
  "source_batch",
  "source_pointer",
  "source_line",
  "source_document_id",
  "provided_title",
  "provided_type",
  "dedup_candidate_id",
  "dedup_confidence",
  "exact_identity_material_hashes",
  "sharing_events",
  "provided_possession_statement",
  "possession",
  "current_existence",
  "current_identity",
  "acl_status",
  "verified_local_copy",
];
const EVENT_KEYS = [
  "email_sender",
  "date_original",
  "date_sao_paulo",
  "source_email_id",
  "attachment_id",
  "archive_note",
  "caveat",
  "subject",
  "source_email_link",
  "allowed_shared_link",
  "link_query_and_fragment_omitted",
  "source_pointer",
  "event_evidence_id",
  "date_semantics",
];
const CONFLICT_KEYS = ["candidate_id", "reason", "occurrences", "identity_evidence_variants"];
/**
 * @param {string} text
 * @returns {{ ok: true, register: Record<string, unknown> } | { ok: false, error: string }}
 */
  if (typeof text !== "string") return { ok: false, error: "invalid_json" };
  if (utf8Bytes(text) > MAX_BYTES) return { ok: false, error: "register_too_large" };
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: "invalid_json" };
  }
  if (!isRecord(value) || !exactKeys(value, ROOT_KEYS)) return { ok: false, error: "invalid_register" };
  if (value.schema !== SCHEMA) return { ok: false, error: "unsupported_schema" };
  if (!isRecord(value.source_provenance) || !exactKeys(value.source_provenance, PROVENANCE_KEYS)) return { ok: false, error: "invalid_provenance" };
  const provenance = value.source_provenance;
  if (!nonEmpty(provenance.archive_sha256) || !nonEmpty(provenance.manifest_sha256) || !nonEmpty(provenance.checksums_sha256) || !nonEmpty(provenance.manifest_member)) {
    return { ok: false, error: "invalid_provenance" };
  }
  if (!whole(provenance.archive_bytes) || !whole(provenance.archive_members_validated) || !whole(provenance.archive_expanded_bytes)) {
    return { ok: false, error: "invalid_provenance" };
  }
  if (typeof provenance.manifest_checksum_verified !== "boolean") return { ok: false, error: "invalid_provenance" };
  if (typeof value.source_coverage_statement !== "string" || value.source_coverage_statement.length === 0) return { ok: false, error: "invalid_coverage" };
  if (!isRecord(value.historical_master_reconciliation) || !exactKeys(value.historical_master_reconciliation, HISTORY_KEYS)) return { ok: false, error: "invalid_history" };
  const history = value.historical_master_reconciliation;
  if (!whole(history.reported_occurrences) || !whole(history.reported_sharing_events) || typeof history.rowset_present !== "boolean" || typeof history.coverage !== "string") {
    return { ok: false, error: "invalid_history" };
  }
  if (!isRecord(value.counts) || !exactKeys(value.counts, COUNT_KEYS)) return { ok: false, error: "invalid_counts" };
  const counts = value.counts;
  if (counts.verified_unique_underlying_documents !== null) return { ok: false, error: "unique_documents_not_unknown" };
  for (const key of COUNT_KEYS) {
    if (key === "verified_unique_underlying_documents") continue;
    if (!whole(counts[key])) return { ok: false, error: "invalid_counts" };
  }
  if (!Array.isArray(value.limitations) || value.limitations.some((item) => typeof item !== "string")) return { ok: false, error: "invalid_limitations" };
  if (!Array.isArray(value.conflicts)) return { ok: false, error: "invalid_conflicts" };
  for (const conflict of value.conflicts) {
    if (!isRecord(conflict) || !exactKeys(conflict, CONFLICT_KEYS)) return { ok: false, error: "invalid_conflicts" };
    if (!nonEmpty(conflict.candidate_id) || typeof conflict.reason !== "string" || !whole(conflict.occurrences) || !whole(conflict.identity_evidence_variants)) {
      return { ok: false, error: "invalid_conflicts" };
    }
  }
  if (!Array.isArray(value.records)) return { ok: false, error: "invalid_records" };
  /** @type {string[]} */
  const candidateIds = [];
  let events = 0;
  for (const record of value.records) {
    if (!isRecord(record) || !exactKeys(record, RECORD_KEYS)) return { ok: false, error: "invalid_records" };
    if (sharePointText(record)) return { ok: false, error: "sharepoint_excluded" };
    for (const key of ["occurrence_id", "source_batch", "source_pointer", "source_document_id", "provided_title", "provided_type", "dedup_candidate_id", "dedup_confidence", "possession", "current_existence", "current_identity", "acl_status"]) {
      if (!nonEmpty(record[key])) return { ok: false, error: "invalid_records" };
    }
    if (!(record.source_line === null || whole(record.source_line))) return { ok: false, error: "invalid_records" };
    if (!(record.provided_possession_statement === null || typeof record.provided_possession_statement === "string")) return { ok: false, error: "invalid_records" };
    if (typeof record.verified_local_copy !== "boolean") return { ok: false, error: "invalid_records" };
    if (!Array.isArray(record.exact_identity_material_hashes) || record.exact_identity_material_hashes.some((item) => !nonEmpty(item))) {
      return { ok: false, error: "invalid_records" };
    }
    if (!Array.isArray(record.sharing_events)) return { ok: false, error: "invalid_events" };
    events += record.sharing_events.length;
    const candidateId = record.dedup_candidate_id;
    if (!nonEmpty(candidateId)) return { ok: false, error: "invalid_records" };
    candidateIds.push(candidateId);
    for (const event of record.sharing_events) {
      if (!isRecord(event) || !exactKeys(event, EVENT_KEYS)) return { ok: false, error: "invalid_events" };
      for (const key of ["date_original", "date_sao_paulo", "source_email_id", "source_pointer", "event_evidence_id", "date_semantics"]) {
        if (!nonEmpty(event[key])) return { ok: false, error: "invalid_events" };
      }
      for (const key of ["email_sender", "attachment_id", "archive_note", "caveat", "subject", "source_email_link"]) {
        if (!(event[key] === null || typeof event[key] === "string")) return { ok: false, error: "invalid_events" };
      }
      if (!(event.allowed_shared_link === null || typeof event.allowed_shared_link === "string")) return { ok: false, error: "invalid_events" };
      if (typeof event.link_query_and_fragment_omitted !== "boolean") return { ok: false, error: "invalid_events" };
      if (typeof event.source_email_link === "string" && !inertHttpUrl(event.source_email_link)) return { ok: false, error: "invalid_link" };
      if (typeof event.allowed_shared_link === "string" && !inertHttpUrl(event.allowed_shared_link)) return { ok: false, error: "invalid_link" };
    }
  }
  const distinct = new Set(candidateIds);
  if (counts.retained_occurrences !== value.records.length) return { ok: false, error: "inconsistent_counts" };
  if (counts.retained_sharing_evidence_events !== events) return { ok: false, error: "inconsistent_counts" };
  if (counts.dedup_candidates !== distinct.size) return { ok: false, error: "inconsistent_counts" };
  if (counts.identity_conflicts_or_variants !== value.conflicts.length) return { ok: false, error: "inconsistent_counts" };
  const retainedOccurrences = counts.retained_occurrences;
  const excludedOccurrences = counts.policy_excluded_sharepoint_occurrences;
  const retainedEvents = counts.retained_sharing_evidence_events;
  const excludedEvents = counts.policy_excluded_sharepoint_events;
  if (!whole(retainedOccurrences) || !whole(excludedOccurrences) || !whole(retainedEvents) || !whole(excludedEvents)) return { ok: false, error: "invalid_counts" };
  if (counts.source_document_occurrences !== retainedOccurrences + excludedOccurrences) return { ok: false, error: "inconsistent_counts" };
  if (counts.source_sharing_evidence_events !== retainedEvents + excludedEvents) return { ok: false, error: "inconsistent_counts" };
  for (const conflict of value.conflicts) {
    const conflictId = conflict.candidate_id;
    if (!nonEmpty(conflictId) || !distinct.has(conflictId)) return { ok: false, error: "inconsistent_counts" };
  }
  return { ok: true, register: value };
}

/**
 * @param {Record<string, unknown>} register
 */
export function projectRegister(register) {
  const counts = /** @type {Record<string, unknown>} */ (register.counts);
  const provenance = /** @type {Record<string, unknown>} */ (register.source_provenance);
  const history = /** @type {Record<string, unknown>} */ (register.historical_master_reconciliation);
  const conflicts = /** @type {Record<string, unknown>[]} */ (register.conflicts);
  const variantIds = new Set(conflicts.map((item) => String(item.candidate_id)));
  const records = /** @type {Record<string, unknown>[]} */ (register.records);
  return {
    trust: "supplied",
    trustNote: "Supplied provenance. A true manifest_checksum_verified flag is a claim in the file, not a pinned-hash check by this page.",
    manifestClaim: provenance.manifest_checksum_verified === true,
    coverage: String(register.source_coverage_statement),
    historyCoverage: String(history.coverage),
    historyPresent: history.rowset_present === true,
    reportedOccurrences: history.reported_occurrences,
    reportedEvents: history.reported_sharing_events,
    counts,
    limitations: /** @type {string[]} */ (register.limitations),
    conflicts: conflicts.map((item) => ({
      candidateId: String(item.candidate_id),
      reason: String(item.reason),
      occurrences: item.occurrences,
      variants: item.identity_evidence_variants,
    })),
    rows: records.map((record) => ({
      occurrenceId: String(record.occurrence_id),
      title: String(record.provided_title),
      type: String(record.provided_type),
      candidateId: String(record.dedup_candidate_id),
      confidence: String(record.dedup_confidence),
      documentId: String(record.source_document_id),
      batch: String(record.source_batch),
      pointer: String(record.source_pointer),
      line: record.source_line,
      possessionStatement: record.provided_possession_statement,
      possession: String(record.possession),
      existence: String(record.current_existence),
      identity: String(record.current_identity),
      acl: String(record.acl_status),
      verifiedCopy: record.verified_local_copy === true,
      variant: variantIds.has(String(record.dedup_candidate_id)),
      events: /** @type {Record<string, unknown>[]} */ (record.sharing_events).map((event) => ({
        sender: event.email_sender,
        dateOriginal: String(event.date_original),
        dateSaoPaulo: String(event.date_sao_paulo),
        emailId: String(event.source_email_id),
        attachmentId: event.attachment_id,
        subject: event.subject,
        caveat: event.caveat,
        archiveNote: event.archive_note,
        emailLink: event.source_email_link,
        sharedLink: event.allowed_shared_link,
        pointer: String(event.source_pointer),
        evidenceId: String(event.event_evidence_id),
        dateSemantics: String(event.date_semantics),
      })),
    })),
  };
}

/**
 * @param {ReturnType<typeof projectRegister>} view
 * @param {string} query
 * @param {string} filter
 */
export function visibleRows(view, query, filter) {
  const q = query.trim().toLowerCase();
  return view.rows.filter((row) => {
    if (filter === "variants" && !row.variant) return false;
    if (filter === "unknown-possession" && row.possession !== "UNKNOWN") return false;
    if (filter === "shared-link" && !row.events.some((event) => event.sharedLink)) return false;
    if (!q) return true;
    const haystack = [
      row.title,
      row.type,
      row.documentId,
      row.candidateId,
      row.occurrenceId,
      ...row.events.flatMap((event) => [event.sender, event.subject, event.emailId]),
    ].map((item) => (item == null ? "" : String(item).toLowerCase()));
    return haystack.some((item) => item.includes(q));
  });
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {Record<string, unknown>} value
 * @param {string[]} keys
 */
export function exactKeys(value, keys) {
  const present = Object.keys(value);
  return present.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
export function nonEmpty(value) {
  return typeof value === "string" && value.length > 0;
}

/**
 * @param {unknown} value
 * @returns {value is number}
 */
export function whole(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1_000_000_000;
}

/**
 * @param {string} text
 */
export function utf8Bytes(text) {
  return new TextEncoder().encode(text).length;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function sharePointText(value) {
  if (typeof value === "string") return value.toLowerCase().includes("sharepoint");
  if (Array.isArray(value)) return value.some((item) => sharePointText(item));
  if (isRecord(value)) return Object.values(value).some((item) => sharePointText(item));
  return false;
}

/**
 * @param {string} value
 */
export function inertHttpUrl(value) {
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (!url.hostname || url.username || url.password || url.search || url.hash) return false;
  return true;
}
