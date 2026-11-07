/**
 * Build one offline HTML page. The page has no records and no credentials.
 * It does not fetch a schema.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function activitySha256(bytes) {
  const msg = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const bitLen = msg.length * 8;
  const padded = new Uint8Array(((msg.length + 9 + 63) >> 6) << 6);
  padded.set(msg);
  padded[msg.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 2 ** 32));
  view.setUint32(padded.length - 4, bitLen >>> 0);
  const k = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const rotr = (value, bits) => (value >>> bits) | (value << (32 - bits));
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) w[index] = view.getUint32(offset + index * 4);
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotr(w[index - 15], 7) ^ rotr(w[index - 15], 18) ^ (w[index - 15] >>> 3);
      const s1 = rotr(w[index - 2], 17) ^ rotr(w[index - 2], 19) ^ (w[index - 2] >>> 10);
      w[index] = (w[index - 16] + s0 + w[index - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + k[index] + w[index]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((value) => value.toString(16).padStart(8, "0")).join("");
}

const root = new URL("./", import.meta.url);
const schemaText = readFileSync(new URL("./relay.codex-review-run-1.schema.json", root));
const schemaHash = createHash("sha256").update(schemaText).digest("hex");
if (activitySha256(schemaText) !== schemaHash) throw new Error("offline sha256 does not match node");
if (schemaHash !== "7ec06819c880305c91c7eba47b383715c765810c4dcbe4e8380f0d6348993fbb") throw new Error("schema pin moved");

let validator = readFileSync(new URL("./validate.mjs", root), "utf8").replaceAll("export ", "");
validator = validator.replace(
  `async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("");
}`,
  `async function sha256Hex(bytes) {
  if (globalThis.crypto?.subtle && globalThis.isSecureContext) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("");
  }
  return globalThis.activitySha256(bytes);
}`,
);
const client = readFileSync(new URL("./offline/client.js", root), "utf8");
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Review activity · local paste</title>
<style>
:root { color-scheme: light; --canvas:#f8f6f9; --ink:#17121a; --accent:#6600ae; --line:#d8d8df; --muted:#5c5d6d; --bad:#c70e1d; --shadow:0 16px 40px rgba(23,18,26,.08); }
* { box-sizing: border-box; }
html, body { margin:0; max-width:100%; }
body { background:var(--canvas); color:var(--ink); font-family:ui-sans-serif,system-ui,sans-serif; line-height:1.45; }
.frame { max-width:980px; margin:0 auto; padding:32px 20px 72px; }
#schema, .path, .boundary, .banner { overflow-wrap:anywhere; }
h1 { margin:8px 0 0; font-size:40px; letter-spacing:-.035em; line-height:1.05; }
.lede, .muted { color:var(--muted); }
.banner, .boundary { display:block; margin-top:16px; padding:10px 14px; border-radius:18px; background:#fcf3ff; color:var(--accent); font-weight:650; }
.boundary { background:#fff6d8; color:#5c4300; }
.toolbar, .import-card, .empty-card, .detail-card, .run { background:#fff; border:1px solid var(--line); border-radius:22px; box-shadow:var(--shadow); }
.toolbar { display:flex; flex-wrap:wrap; gap:10px 12px; align-items:end; padding:12px; margin-top:16px; }
label { margin:0; display:grid; gap:6px; min-width:0; color:var(--muted); font-size:12px; font-weight:650; }
.toolbar label:first-of-type { flex:1 1 240px; }
.toolbar label { flex:1 1 140px; }
input, select, textarea, button { font:inherit; font-size:16px; color:var(--ink); max-width:100%; }
.toolbar input, .toolbar select, textarea, input[type="file"], #label { width:100%; min-height:44px; border:1px solid var(--line); border-radius:12px; padding:10px 12px; background:#fff; }
textarea { min-height:120px; }
button { min-height:44px; border:0; border-radius:12px; background:var(--accent); color:#fff; padding:10px 16px; cursor:pointer; }
button:hover { background:#41007c; }
.empty-card, .import-card, .detail-card { padding:18px; margin-top:14px; }
.empty-card h2, .import-card h2, .detail-card h2 { margin:0; font-size:22px; letter-spacing:-.03em; }
.runs { display:grid; gap:10px; margin-top:14px; min-width:0; max-width:100%; }
.run { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:6px 16px; align-items:center; width:100%; max-width:100%; min-width:0; text-align:left; background:#fff; color:var(--ink); }
.run strong, .id, .path, .detail-card, .detail-card p, .detail-card h2, .detail-card h3, details, summary { overflow-wrap:anywhere; min-width:0; max-width:100%; }
.run strong { display:block; font-size:16px; }
.run-side { display:flex; flex-wrap:wrap; gap:6px; justify-content:flex-end; align-items:center; min-width:0; max-width:100%; }
.chip { display:inline-flex; border-radius:999px; padding:4px 10px; background:#fcf3ff; color:var(--accent); font-size:12px; font-weight:650; }
.chip.fixture { background:#fff6d8; color:#5c4300; }
.chip.unknown { background:#eeeef0; color:#4b4c59; }
.chips { display:flex; flex-wrap:wrap; gap:6px; margin:10px 0; }
.id, .k { color:var(--muted); font-size:12px; }
.path { overflow-wrap:anywhere; }
.alert { color:var(--bad); font-weight:650; }
.coverage { margin:14px 0; }
details { margin-top:16px; background:#fff; border:1px solid var(--line); border-radius:18px; padding:12px 16px; }
summary { cursor:pointer; font-weight:650; }
@media (max-width:720px) {
  .frame { padding:20px 16px 48px; }
  h1 { font-size:32px; }
  .toolbar label, .toolbar label:first-of-type { flex-basis:100%; }
  .run { grid-template-columns:1fr; }
  .run-side { justify-content:flex-start; }
}
</style>
</head>
<body>
<main class="frame">
<p class="banner">Local paste only. No model was called. AI is disabled. Nothing in this file is a review record.</p>
<p class="boundary">This typed local label and this browser session cache are not authentication. This page is not the signed-in Settings → Observability release page.</p>
<h1>Review activity</h1>
<p class="lede">Paste or choose an NDJSON file on this computer. Nothing is uploaded. Evidence paths are text and are not opened. The page starts empty.</p>
<p id="schema" class="muted"></p>
<label>Local label <input id="label" value="local" autocomplete="off"></label>
<p id="status" class="coverage" role="status"></p>
<form id="filters" class="toolbar">
<label>Search <input id="q" placeholder="Notes or label"></label>
<label>Capture <select id="capture"><option value="">Any</option><option value="historical-manual">Historical manual</option><option value="live-exporter">Reported completion export</option></select></label>
<label>Kind <select id="kind"><option value="">Any</option><option value="static">Static review</option><option value="runtime">Runtime review</option></select></label>
<label>Date <input id="date" placeholder="YYYY-MM-DD" inputmode="numeric"></label>
<button type="submit">Filter</button>
</form>
<article id="empty" class="empty-card"><h2>No reviews yet</h2><p>Nothing has been imported.</p></article>
<div id="list" class="runs"></div>
<article id="detail" class="detail-card" hidden></article>
<form id="importer" class="import-card">
<h2>Import a ledger</h2>
<p class="muted">One relay.codex-review-run/1 record per line. A conflicting duplicate is refused. An incomplete final line is not a full snapshot.</p>
<label>Ledger file <input id="activity-file" type="file" accept=".ndjson,.jsonl,.txt,text/plain"></label>
<label>Review records <textarea id="ndjson" rows="5" placeholder="One relay.codex-review-run/1 record per line"></textarea></label>
<button id="import" type="button">Import review records</button>
</form>
</main>
<script>
${activitySha256.toString()}
</script>
<script type="module">
const EMBEDDED_SCHEMA = ${JSON.stringify(schemaText.toString("utf8")).replaceAll("<", "\\u003c")};
${validator}
${client}
</script>
</body>
</html>
`;
if (html.includes("eyJ") || /Bearer |PRIVATE KEY|x-dev-email/.test(html)) throw new Error("offline page contains a credential-like string");
const destination = resolve(process.argv[2] ?? fileURLToPath(new URL("./offline/index.html", root)));
mkdirSync(dirname(destination), { recursive: true });
writeFileSync(destination, html);
console.log(`${schemaHash} ${destination} ${html.length}`);
