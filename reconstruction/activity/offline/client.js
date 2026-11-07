const labelInput = document.getElementById("label");
const status = document.getElementById("status");
const list = document.getElementById("list");
const detail = document.getElementById("detail");
const empty = document.getElementById("empty");
const schemaLine = document.getElementById("schema");
const importButton = document.getElementById("import");

const storageKey = () => `secondary-activity-local:${labelInput.value.trim() || "local"}`;

function load() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(storageKey()) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(records) {
  sessionStorage.setItem(storageKey(), JSON.stringify(records));
}

function reported(value) {
  return value === null || value === undefined || value === "" ? "Not reported" : String(value);
}

function captureLabel(capture) {
  if (capture === "historical-manual") return "Historical manual";
  if (capture === "live-exporter") return "Reported completion export";
  return "Capture not reported";
}

function addText(parent, tag, value, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = value;
  parent.append(node);
  return node;
}

function render() {
  const q = document.getElementById("q").value.trim().toLowerCase();
  const capture = document.getElementById("capture").value;
  const kind = document.getElementById("kind").value;
  const date = document.getElementById("date").value;
  const filtering = Boolean(q || capture || kind || date);
  let records = load();
  if (q) records = records.filter((record) => [record.record_id, record.session_id, record.notes, record.target?.label].join("\n").toLowerCase().includes(q));
  if (capture) records = records.filter((record) => record.capture === capture);
  if (kind) records = records.filter((record) => record.analysis_kind === kind);
  if (date) records = records.filter((record) => String(record.started_at ?? "").startsWith(date) || String(record.finished_at ?? "").startsWith(date));
  const items = sortRecords(records).map(viewRecord);
  list.replaceChildren();
  empty.hidden = items.length !== 0 || filtering;
  if (items.length === 0) {
    status.textContent = filtering
      ? "No supplied records match this filter."
      : "No review records for this label. Nothing has been imported. Coverage is the supplied records only.";
  } else {
    status.textContent = `Showing ${items.length} supplied record${items.length === 1 ? "" : "s"}. Coverage is the supplied records only.`;
  }
  for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "run";
    const main = document.createElement("span");
    addText(main, "strong", reported(item.what_reviewed));
    addText(main, "span", `${item.activity_label} · ${captureLabel(item.capture)}`, "muted");
    const side = document.createElement("span");
    side.className = "run-side";
    if (item.synthetic) addText(side, "span", "Synthetic fixture", "chip fixture");
    addText(side, "span", reported(item.finished_at), "muted");
    addText(side, "span", item.id, "id");
    button.append(main, side);
    button.addEventListener("click", () => show(item));
    list.append(button);
  }
}

function show(item) {
  detail.hidden = false;
  detail.replaceChildren();
  addText(detail, "p", "Selected review", "k");
  addText(detail, "h2", reported(item.what_reviewed));
  const chips = document.createElement("div");
  chips.className = "chips";
  if (item.synthetic) addText(chips, "span", "Synthetic fixture", "chip fixture");
  addText(chips, "span", captureLabel(item.capture), "chip");
  addText(chips, "span", item.activity_label, "chip");
  addText(chips, "span", "Not a trusted capture", "chip unknown");
  detail.append(chips);
  const captureNote = item.capture === "historical-manual"
    ? "Historical. This manual record is not a live capture."
    : "Reported live exporter. This is a cooperative approved-run completion export, not a universal runtime capture.";
  addText(detail, "p", captureNote);
  addText(detail, "p", item.untrusted_notes);
  addText(detail, "h3", "Evidence paths");
  for (const path of item.evidence_provenance_pointers) addText(detail, "p", path, "path");
  addText(detail, "p", `${item.token_usage.label}: ${reported(item.token_usage.value)}`);
  addText(detail, "p", item.observed_writes_detected === false
    ? "No writes were reported. A reported false is not proof that no transient writes occurred."
    : "Writes were reported by the producer. This page did not perform a write.");
  const facts = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "Technical record";
  facts.append(summary);
  const counts = item.outcome?.counts ?? {};
  const lines = [
    `record_id ${item.id}`,
    `session_id ${reported(item.session_id)}`,
    `capture ${reported(item.capture)}`,
    `analysis_kind ${reported(item.analysis_kind)}`,
    `started_at ${reported(item.started_at)}`,
    `finished_at ${reported(item.finished_at)}`,
    `overall_verdict ${reported(item.outcome?.overall_verdict)}`,
    `exit_code ${reported(item.outcome?.exit_code)}`,
    `completed ${String(item.outcome?.completed)}`,
    `Reported counts. These are not edits performed by this page. High ${reported(counts.high)}, medium ${reported(counts.medium)}, low ${reported(counts.low)}, fixed ${reported(counts.fixed)}, cannot determine ${reported(counts.cannot_determine)}.`,
    `writes_detected=${String(item.observed_writes_detected)}`,
    `artifact_only_enforced=false. usual_notes_loaded=${reported(item.context_scope?.usual_notes_loaded)} does not prove a six-guide setup.`,
    "trusted_runtime_capture=false",
    `agent ${item.reported_by?.agent ?? ""} tool ${item.reported_by?.tool?.name ?? ""}`,
  ];
  for (const line of lines) addText(facts, "p", line);
  detail.append(facts);
  detail.scrollIntoView({ block: "nearest" });
}

async function importText(text) {
  status.className = "coverage";
  const parsed = await parseNdjson(text);
  const current = load();
  const byId = new Map(current.map((record) => [record.record_id, record]));
  for (const record of parsed.records) {
    const prior = byId.get(record.record_id);
    if (prior && await recordHash(prior) !== await recordHash(record)) {
      const error = new Error("conflict");
      error.reason = "conflicting_duplicate";
      throw error;
    }
    byId.set(record.record_id, record);
  }
  save([...byId.values()]);
  status.textContent = parsed.incomplete
    ? "Imported the complete lines. The final line was incomplete and was not imported. This is not a full snapshot."
    : "Imported. Coverage is the supplied records only.";
  render();
}

labelInput.addEventListener("change", () => {
  detail.hidden = true;
  detail.replaceChildren();
  status.textContent = "Local label changed. This session cache is not authentication and is not the signed-in release page.";
  render();
});
document.getElementById("filters").addEventListener("submit", (event) => {
  event.preventDefault();
  render();
});
document.getElementById("activity-file").addEventListener("change", async (event) => {
  const chosen = event.target.files && event.target.files[0];
  if (!chosen) return;
  document.getElementById("ndjson").value = await chosen.text();
});
importButton.addEventListener("click", async () => {
  try {
    await importText(document.getElementById("ndjson").value);
  } catch (error) {
    status.textContent = `Not imported (${error.reason || "malformed_record"}). Nothing was written.`;
    status.className = "alert";
  }
});

const schemaBytes = new TextEncoder().encode(EMBEDDED_SCHEMA);
const schemaHash = await sha256Hex(schemaBytes);
schemaLine.textContent = schemaHash === SCHEMA_SHA256
  ? `Pinned schema SHA-256 ${SCHEMA_SHA256}. The embedded copy matches. No schema was fetched.`
  : "Embedded schema does not match the pin. Import is disabled.";
if (schemaHash !== SCHEMA_SHA256) importButton.disabled = true;
render();
