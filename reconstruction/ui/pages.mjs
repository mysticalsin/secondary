/**
 * NEW RECONSTRUCTION pages. Not recovered TypeScript and not the captured shell.
 * Visual direction is taken from the verified still: light gray canvas, ink navigation,
 * white rounded panels, muted labels, one restrained purple accent.
 * Mandate, Nova, SOC 2, and the numbers in that still are not copied.
 */
import {
  exactKeys,
  inertHttpUrl,
  isRecord,
  nonEmpty,
  projectRegister,
  sharePointText,
  utf8Bytes,
  validateRegister,
  visibleRows,
  whole,
} from "../shared-documents/register.mjs";

/**
 * @typedef {{
 *   id: string,
 *   session_id?: string | null,
 *   capture?: string,
 *   finished_at?: string | null,
 *   started_at?: string | null,
 *   activity_label?: string,
 *   what_reviewed?: string | null,
 *   outcome?: { completed?: boolean, exit_code?: number | null, overall_verdict?: string | null, counts?: Record<string, number | null> },
 *   token_usage?: { value?: number | null, label?: string },
 *   observed_writes_detected?: boolean,
 *   context_scope?: { usual_notes_loaded?: boolean | null },
 *   evidence_provenance_pointers?: string[],
 *   untrusted_notes?: string,
 *   synthetic?: boolean,
 *   reported_by?: { agent?: string, tool?: { name?: string } },
 *   analysis_kind?: string
 * }} ActivityView
 * @typedef {{
 *   items?: ActivityView[],
 *   detail?: ActivityView | null,
 *   empty?: boolean,
 *   snapshot_complete?: boolean,
 *   message?: string,
 *   failed?: boolean,
 *   q?: string,
 *   capture?: string,
 *   kind?: string,
 *   date?: string
 * }} ActivityState
 * @typedef {{ trust?: string, evidence?: string, operation?: string, outcome?: string, inputTokens?: number | null, requestId?: string }} LedgerEventRow
 * @typedef {{ value: number | null, complete?: boolean }} TokenDimension
 * @typedef {{
 *   roleLabel: string,
 *   principalId: string,
 *   tenantId: string,
 *   persona: string,
 *   prefMessage: string,
 *   section: string,
 *   release: boolean,
 *   preset: string,
 *   routes: { path: string, status: string, meaning: string }[],
 *   ready: { kind: string, label: string, detail: string, technical: string },
 *   health: { kind: string, label: string, detail: string },
 *   ai: { kind: string, label: string, detail: string },
 *   agentRows: string,
 *   audit: { kind: string, label: string, detail: string, raw: string },
 *   lang: string,
 *   ledger: { status: number, events: LedgerEventRow[], summary: null | { operations: number, tokenCoverage: { unknown: number }, input: TokenDimension | null }, error: string, operation: string, trust: string, requestId: string },
 *   activity?: ActivityState,
 *   links?: [string, string][],
 *   currentHref?: string,
 *   banner?: string,
 *   identity?: string,
 *   allowImport?: boolean,
 *   activityAction?: string
 * }} ObservabilityModel
 * @typedef {{
 *   who: string,
 *   tenant: string,
 *   message?: string,
 *   items: { externalId?: string, version?: number | string | null, text?: string, contentSha256?: string | null }[],
 *   kept?: number,
 *   total?: number,
 *   shown?: number,
 *   coverage?: string,
 *   preset?: string,
 *   release: boolean,
 *   links?: [string, string][],
 *   currentHref?: string
 * }} ImportModel
 * @typedef {{ status: number, email: string, links?: [string, string][], currentHref?: string, plan?: { error?: string, principalId?: string, tenantId?: string, context?: { externalId?: string, version?: number | null, text?: string, contentSha256?: string | null }[], empty?: boolean, coverage?: string, shown?: number, total?: number } }} PersonalModel
 * @typedef {{ who?: string, personal?: string, request?: string, planStatus?: string | number, planHtml?: string }} GenuiState
 */

export const CSS = `
:root {
  color-scheme: light;
  --canvas: #eef1f4;
  --ink: #1b2433;
  --nav: #1e2636;
  --panel: #ffffff;
  --muted: #3e4b5f;
  --line: #e4e7ee;
  --accent: #6d5bd0;
  --ok: #0f6b4c;
  --bad: #8d2f39;
  --shadow: 0 10px 30px rgba(27, 36, 51, 0.08);
  font-family: ui-sans-serif, system-ui, sans-serif;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--canvas); color: var(--ink); }
a { color: var(--ink); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.nav {
  display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
  background: var(--nav); color: white; padding: 12px 16px;
}
.nav a, .nav button {
  border: 0; border-radius: 999px; background: transparent; color: white;
  padding: 8px 12px; text-decoration: none; font: inherit; cursor: pointer;
}
.nav a[aria-current="page"], .nav button[aria-pressed="true"] { background: #f4f6f8; color: var(--ink); }
.nav a:hover, .nav button:hover { background: rgba(255,255,255,0.12); }
.nav a[aria-current="page"]:hover { background: #ffffff; }
button.action:hover { background: #2a3548; }
.badge {
  display: inline-block; margin-left: 6px; min-width: 1.1rem; padding: 0 6px;
  border-radius: 999px; background: var(--accent); color: white; font-size: 11px; line-height: 18px;
  text-align: center;
}
.wrap { max-width: 1080px; margin: 0 auto; padding: 20px 16px 48px; }
.note { color: var(--muted); font-size: 14px; }
.grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
.panel {
  background: var(--panel); border: 1px solid var(--line); border-radius: 18px;
  box-shadow: var(--shadow); padding: 16px 18px;
}
.panel h2, .panel h3 { margin: 0 0 8px; font-size: 16px; }
.k { color: var(--muted); font-size: 12px; letter-spacing: 0.02em; }
.chip {
  display: inline-block; border-radius: 999px; padding: 2px 8px; font-size: 12px;
  background: #f3f1fb; color: var(--accent);
}
.chip.ok { background: #e7f6ef; color: var(--ok); }
.chip.bad { background: #fdecef; color: var(--bad); }
.chip.unknown { background: #eef1f4; color: var(--muted); }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
label { display: block; font-size: 14px; margin: 8px 0; }
input, select, button.action {
  font: inherit; border-radius: 10px; border: 1px solid var(--line); padding: 8px 10px; background: white;
}
button.action { background: var(--ink); color: white; cursor: pointer; }
button.action:disabled, input:disabled { opacity: 0.55; cursor: not-allowed; }
.tabs { display: flex; gap: 8px; margin: 12px 0; flex-wrap: wrap; }
.tabs button {
  border: 1px solid var(--line); border-radius: 999px; background: transparent;
  color: var(--muted); padding: 8px 14px; font: inherit; cursor: pointer;
}
.tabs button[aria-selected="true"] { background: var(--ink); color: white; border-color: var(--ink); }
input[type="search"] { width: min(100%, 280px); }
.error { color: var(--bad); }
@media (max-width: 720px) {
  .nav { padding: 10px; }
  .wrap { padding: 12px; }
}
@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; scroll-behavior: auto !important; }
}
`;

/**
 * @param {unknown} value
 * @returns {string}
 */
const esc = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/**
 * @param {string} current
 * @returns {string}
 */
function nav(current) {
  /**
   * @param {string} href
   * @param {string} label
   * @param {string} [badge]
   * @returns {string}
   */
  const item = (href, label, badge) =>
    `<a href="${href}" ${current === href ? 'aria-current="page"' : ""}>${label}${
      badge ? `<span class="badge">${badge}</span>` : ""
    }</a>`;
  return `<nav class="nav" aria-label="Reconstruction">
    <a href="/">Shell</a>
    ${item("/reconstruction/genui", "GenUI")}
    ${item("/reconstruction/observability", "Observability", "local")}
  </nav>`;
}

/**
 * @param {string} title
 * @param {string} current
 * @param {string} body
 * @returns {string}
 */
function page(title, current, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='4' fill='%231e2636'/%3E%3C/svg%3E"><style>${CSS}</style></head><body>
${nav(current)}<main class="wrap">${body}</main></body></html>`;
}

/**
 * @param {string} kind
 * @param {unknown} text
 * @returns {string}
 */
function chip(kind, text) {
  return `<span class="chip ${kind}">${esc(text)}</span>`;
}

const OBS_CSS = `
/* Palette for this page only.
   Official public tokens, https://mantu.com/_next/static/chunks/0f4n.iw4c7x10.css :root
   (fetched 2026-11-07): --primary-main #6600ae, --primary-50 #fcf3ff, --primary-950 #41007c,
   --dark-main #17121a, --dark-50 #f8f6f9, --white #fff, --grey-200 #d8d8df, --grey-600 #5c5d6d,
   --yellow-main #ffc709, --red-50 #fff1f1, --red-200 #ffcccf, --red-700 #c70e1d.
   The same primary #6600ae is also --purple in recovered-delivery/shell-six/assets/index-DiBYRwP4.css.
   Success uses that recovered stylesheet's --st-done #1e6b34 and --add-bg #e6f6ea.
   mantu.com publishes no success-green token. The reel accent #6d5bd0 is not used. */
:root {
  color-scheme: light;
  --canvas: #f8f6f9;
  --ink: #17121a;
  --nav: #6600ae;
  --panel: #ffffff;
  --muted: #5c5d6d;
  --line: #d8d8df;
  --accent: #6600ae;
  --ok: #1e6b34;
  --ok-bg: #e6f6ea;
  --bad: #c70e1d;
  --bad-bg: #fff1f1;
  --focus-on-dark: #ffc709;
  --shadow: 0 16px 40px rgba(23, 18, 26, 0.08);
  font-family: ui-sans-serif, system-ui, sans-serif;
}
* { box-sizing: border-box; }
html, body { margin: 0; max-width: 100%; }
body { background: var(--canvas); color: var(--ink); line-height: 1.45; }
a { color: inherit; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.frame { max-width: 980px; margin: 0 auto; padding: 32px 20px 72px; }
.crumb { margin: 0 0 14px; color: var(--muted); font-size: 14px; }
.crumb a { text-decoration: none; }
.crumb a:hover { text-decoration: underline; }
h1 { margin: 8px 0 0; font-size: 40px; line-height: 1.05; letter-spacing: -0.035em; font-weight: 650; }
.lede { margin: 14px 0 0; font-size: 17px; color: var(--ink); }
.banner {
  display: inline-flex; align-items: center; gap: 8px; margin-top: 16px;
  padding: 6px 12px; border-radius: 999px; background: #fcf3ff; color: var(--accent);
  font-size: 13px; font-weight: 650;
}
.banner i { width: 8px; height: 8px; border-radius: 99px; background: var(--accent); display: block; }
.pills, .tabs {
  display: flex; flex-wrap: wrap; gap: 6px; max-width: 100%;
}
.pills {
  width: fit-content; margin: 18px 0 16px; padding: 4px;
  background: #17121a; border-radius: 999px;
}
.pills a, .tabs button {
  border: 0; border-radius: 999px; font: inherit; font-size: 14px;
  text-decoration: none; padding: 9px 14px; cursor: pointer; line-height: 1.2;
}
.pills a { color: #ffffff; background: transparent; }
.pills a[aria-current="page"] { background: #ffffff; color: var(--ink); }
.pills a:hover { background: rgba(255,255,255,0.14); }
.pills a[aria-current="page"]:hover { background: #ffffff; }
.pills a:focus-visible { outline-color: var(--focus-on-dark); }
.tabs { margin: 0 0 18px; }
.tabs button, .tabs a[role="tab"] {
  background: transparent; color: var(--muted); border: 1px solid transparent;
  border-radius: 999px; font: inherit; font-size: 14px; text-decoration: none; padding: 9px 14px; line-height: 1.2;
}
.tabs button[aria-selected="true"], .tabs a[role="tab"][aria-selected="true"] {
  background: white; color: var(--ink); border-color: var(--line); box-shadow: var(--shadow);
}
.grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr)); }
.stat, .sheet, .callout {
  background: var(--panel); border: 1px solid var(--line); border-radius: 22px;
  box-shadow: var(--shadow);
}
.stat { padding: 18px 18px 16px; min-width: 0; }
.mark {
  width: 36px; height: 36px; border-radius: 12px; display: grid; place-items: center;
  background: #fcf3ff; color: var(--accent); margin-bottom: 14px;
}
.k { margin: 0; color: var(--muted); font-size: 13px; }
.value { margin: 8px 0 0; font-size: 22px; letter-spacing: -0.03em; }
.hint { margin: 8px 0 0; color: var(--muted); font-size: 14px; }
.sheet { padding: 8px 8px 4px; }
.host { display: flex; justify-content: space-between; gap: 12px; align-items: center; padding: 14px 12px; border-bottom: 1px solid var(--line); }
.host:last-child { border-bottom: 0; }
.host strong { display: block; font-size: 15px; }
.host span { color: var(--muted); font-size: 13px; }
.chip { display: inline-flex; align-items: center; border-radius: 999px; padding: 4px 10px; font-size: 12px; font-weight: 650; background: #fcf3ff; color: var(--accent); white-space: nowrap; }
.chip.ok { background: var(--ok-bg); color: var(--ok); }
.chip.bad { background: var(--bad-bg); color: var(--bad); }
.chip.unknown { background: #eeeef0; color: #4b4c59; }
.chip.fixture { background: #fff6d8; color: #5c4300; }
.callout { padding: 18px 20px; }
.callout.bad { background: var(--bad-bg); border-color: #ffcccf; }
.callout h2, .block h2 { margin: 0 0 8px; font-size: 18px; letter-spacing: -0.02em; }
.block { margin-top: 16px; }
label { display: block; margin: 12px 0; font-size: 14px; }
select, button.save, input[type="search"] {
  font: inherit; border-radius: 12px; border: 1px solid var(--line); background: white; padding: 10px 12px;
}
button.save { background: var(--accent); color: white; cursor: pointer; }
button.save:hover { background: #41007c; }
input:disabled { opacity: 0.6; }
.alert { margin: 12px 0 0; color: var(--bad); font-weight: 650; }
details { margin-top: 28px; background: white; border: 1px solid var(--line); border-radius: 18px; padding: 12px 16px; }
summary { cursor: pointer; font-weight: 650; }
pre, table { max-width: 100%; overflow-wrap: anywhere; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; padding: 8px 4px; border-bottom: 1px solid var(--line); vertical-align: top; }
.muted { color: var(--muted); font-size: 14px; }
#panel-activity .activity-lead { margin: 8px 0 0; max-width: 62ch; }
#panel-activity .coverage { margin: 14px 0; }
#panel-activity .toolbar, #panel-activity .import-card, #panel-activity .empty-card, #panel-activity .detail-card {
  background: white; border: 1px solid var(--line); border-radius: 22px; box-shadow: var(--shadow);
}
#panel-activity .toolbar {
  display: flex; flex-wrap: wrap; gap: 10px 12px; align-items: end; padding: 12px;
}
#panel-activity .toolbar label, #panel-activity .import-card label {
  margin: 0; display: grid; gap: 6px; min-width: 0; color: var(--muted); font-size: 12px; font-weight: 650;
}
#panel-activity .toolbar label:first-of-type { flex: 1 1 240px; }
#panel-activity .toolbar label { flex: 1 1 140px; }
#panel-activity .toolbar input, #panel-activity .toolbar select, #panel-activity .import-card textarea, #panel-activity .import-card input[type="file"] {
  width: 100%; min-height: 44px; font: inherit; font-size: 16px; color: var(--ink);
  border: 1px solid var(--line); border-radius: 12px; background: #fff; padding: 10px 12px;
}
#panel-activity .toolbar button, #panel-activity .import-card button { min-height: 44px; padding: 10px 16px; }
#panel-activity .empty-card, #panel-activity .import-card, #panel-activity .detail-card { padding: 18px 18px 16px; margin-top: 14px; }
#panel-activity .empty-card h2, #panel-activity .import-card h2, #panel-activity .detail-card h2 {
  margin: 0; font-size: 22px; letter-spacing: -0.03em;
}
#panel-activity .runs { display: grid; gap: 10px; margin: 14px 0 0; min-width: 0; max-width: 100%; }
#panel-activity .run {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 16px; align-items: center;
  text-decoration: none; background: white; border: 1px solid var(--line); border-radius: 18px;
  padding: 14px 16px; box-shadow: var(--shadow); width: 100%; max-width: 100%; min-width: 0;
}
#panel-activity .run[aria-current="page"] { border-color: #c9a4e4; box-shadow: 0 0 0 3px #fcf3ff; }
#panel-activity .run strong, #panel-activity .id, #panel-activity .path, #panel-activity .detail-card, #panel-activity .detail-card p, #panel-activity .detail-card h2, #panel-activity .detail-card h3 {
  overflow-wrap: anywhere; min-width: 0; max-width: 100%;
}
#panel-activity .run strong { display: block; font-size: 16px; letter-spacing: -0.02em; }
#panel-activity .run-side { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; align-items: center; min-width: 0; max-width: 100%; }
#panel-activity .id { color: var(--muted); font-size: 12px; }
#panel-activity .chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0; }
#panel-activity .detail-card details { margin-top: 16px; max-width: 100%; min-width: 0; }
#panel-activity .path { margin: 4px 0; }
@media (max-width: 720px) {
  .frame { padding: 20px 16px 48px; }
  h1 { font-size: 32px; }
  .value { font-size: 20px; }
  .host { align-items: flex-start; }
  #panel-activity .toolbar label, #panel-activity .toolbar label:first-of-type { flex-basis: 100%; }
  #panel-activity .run { grid-template-columns: 1fr; }
  #panel-activity .run-side { justify-content: flex-start; }
}
.home-grid { display: grid; gap: 14px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.dest, .unknowns article {
  background: white; border: 1px solid var(--line); border-radius: 22px; box-shadow: var(--shadow);
  padding: 18px; min-width: 0; max-width: 100%;
}
.dest h2 { margin: 0 0 8px; font-size: 22px; letter-spacing: -0.03em; overflow-wrap: anywhere; }
.dest p, .unknowns p, .lede, .eyebrow { overflow-wrap: anywhere; max-width: 100%; }
.dest .goto {
  display: inline-block; margin-top: 14px; background: var(--accent); color: white; text-decoration: none;
  border-radius: 999px; padding: 9px 14px; font-weight: 650;
}
.unknowns { display: grid; gap: 14px; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-top: 22px; }
.unknowns .value { font-size: 22px; margin: 4px 0; letter-spacing: -0.03em; }
.eyebrow { margin: 0; color: var(--accent); font-size: 13px; font-weight: 750; letter-spacing: 0.04em; text-transform: uppercase; }
@media (max-width: 720px) {
  .home-grid, .unknowns { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; scroll-behavior: auto !important; }
}
`;

/**
 * @param {string} paths
 * @returns {string}
 */
function mark(paths) {
  return `<span class="mark" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg></span>`;
}

/**
 * @param {[string, string][]} links
 * @param {string} currentHref
 * @returns {string}
 */
function textNav(links, currentHref) {
  return `<nav class="capsule" aria-label="Second Brain">${links.map(([href, text]) =>
    `<a href="${href}"${href === currentHref ? ' aria-current="page"' : ""}>${esc(text)}</a>`,
  ).join("")}</nav>`;
}

/**
 * @param {[string, string][]} links
 * @param {string} currentHref
 * @param {string} label
 * @returns {string}
 */
function appPills(links, currentHref, label) {
  return `<nav class="pills" aria-label="${esc(label)}">${links.map(([href, text]) =>
    `<a href="${href}"${href === currentHref ? ' aria-current="page"' : ""}>${esc(text)}</a>`,
  ).join("")}</nav>`;
}

/** @type {[string, string][]} */
export const RELEASE_APP_LINKS = [
  ["/", "Home"],
  ["/brains/me", "Personal brain"],
  ["/reconstruction/import", "Import"],
  ["/settings/observability", "Observability"],
  ["/settings/observability?section=activity", "Activity"],
  ["/shared-documents", "Shared documents"],
];

const SETTINGS_LINKS = [
  ["/settings/profile", "Profile"],
  ["/settings/brains", "Brains"],
  ["/settings/agents", "Agents"],
  ["/settings/security", "Security"],
  ["/settings/privacy", "Privacy"],
  ["/settings/appearance", "Appearance"],
  ["/settings/usage", "Usage"],
  ["/settings/observability", "Observability"],
];

/**
 * @param {TokenDimension | null | undefined} dimension
 * @returns {string}
 */
function tokenLabel(dimension) {
  if (!dimension || dimension.value === null) return "Unknown";
  if (dimension.value === 0 && dimension.complete) return "0 measured";
  if (!dimension.complete) return `${dimension.value} known, coverage incomplete`;
  return String(dimension.value);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function reported(value) {
  if (value === null || value === undefined || value === "") return "Not reported";
  return esc(value);
}

/**
 * @param {string | undefined} capture
 * @returns {string}
 */
function captureLabel(capture) {
  if (capture === "historical-manual") return "Historical manual";
  if (capture === "live-exporter") return "Reported completion export";
  return "Capture not reported";
}

/**
 * @param {ObservabilityModel} model
 * @returns {string}
 */
function activityPanel(model) {
  const activity = model.activity;
  if (!activity) {
    return `<p class="muted">Review activity is not loaded on this page.</p>`;
  }
  const items = Array.isArray(activity.items) ? activity.items : [];
  const detail = activity.detail ?? null;
  const filtering = Boolean(activity.q || activity.capture || activity.kind || activity.date);
  const list = items.map((item) => {
    const query = new URLSearchParams({ section: "activity", record: item.id });
    if (activity.q) query.set("q", activity.q);
    if (activity.capture) query.set("capture", activity.capture);
    if (activity.kind) query.set("kind", activity.kind);
    if (activity.date) query.set("date", activity.date);
    const synthetic = item.synthetic ? `<span class="chip fixture">Synthetic fixture</span>` : "";
    return `<a class="run" href="/settings/observability?${esc(query.toString())}"${detail?.id === item.id ? ' aria-current="page"' : ""}>
      <span><strong>${reported(item.what_reviewed)}</strong><span class="muted">${esc(item.activity_label)} · ${esc(captureLabel(item.capture))}</span></span>
      <span class="run-side">${synthetic}<span class="muted">${reported(item.finished_at)}</span><span class="id">${esc(item.id)}</span></span>
    </a>`;
  }).join("");
  const counts = detail?.outcome?.counts ?? {};
  const evidence = (detail?.evidence_provenance_pointers ?? []).map((path) => `<p class="path">${esc(path)}</p>`).join("");
  const captureNote = detail?.capture === "historical-manual"
    ? "Historical. This manual record is not a live capture."
    : detail?.capture === "live-exporter"
      ? "Reported live exporter. This is a cooperative approved-run completion export, not a universal runtime capture."
      : "";
  const writes = detail?.observed_writes_detected === false
    ? "No writes were reported. A reported false is not proof that no transient writes occurred."
    : detail?.observed_writes_detected === true
      ? "Writes were reported by the producer. This page did not perform a write."
      : "Writes were not reported.";
  const status = activity.empty
    ? (filtering ? "No supplied records match this filter." : "No review records for this session. Nothing has been imported.")
    : `Showing ${items.length} supplied record${items.length === 1 ? "" : "s"}. ${activity.snapshot_complete === false ? "The final line was incomplete and was not imported. This is not a full snapshot." : "Coverage is the supplied records only."}`;
  const importForm = model.release && model.allowImport !== false ? `<form class="import-card" method="post" action="/settings/observability/activity">
      <h2>${activity.empty ? "Import a ledger" : "Import another ledger"}</h2>
      <p class="muted">Paste review records, or choose a file on this computer. The file is read here and stored for this signed-in user only. It is not sent to a model. Evidence paths are not opened.</p>
      <label>Ledger file <input id="activity-file" type="file" accept=".ndjson,.jsonl,.txt,text/plain"></label>
      <label>Review records <textarea name="ndjson" rows="5" placeholder="One relay.codex-review-run/1 record per line"></textarea></label>
      <button class="save" type="submit">Import review records</button>
    </form>` : "";
  return `<p class="banner"><i></i>Read-only review activity. No model was called. AI is disabled.</p>
    <p class="activity-lead muted">${model.identity ? esc(model.identity) : `Signed in as ${esc(model.principalId)} in ${esc(model.tenantId)}.`} Only records imported for this sign-in are shown. Evidence paths are untrusted text and are not opened.</p>
    <p class="coverage" role="status">${esc(status)}</p>
    ${activity.message ? `<p class="${activity.failed ? "alert" : ""}" role="status">${esc(activity.message)}</p>` : ""}
    <form class="toolbar" method="get" action="${esc(model.activityAction ?? "/settings/observability")}">
      <input type="hidden" name="section" value="activity">
      <label>Search <input name="q" value="${esc(activity.q ?? "")}" placeholder="Notes or label"></label>
      <label>Capture <select name="capture"><option value="">Any</option><option value="historical-manual" ${activity.capture === "historical-manual" ? "selected" : ""}>Historical manual</option><option value="live-exporter" ${activity.capture === "live-exporter" ? "selected" : ""}>Reported completion export</option></select></label>
      <label>Kind <select name="kind"><option value="">Any</option><option value="static" ${activity.kind === "static" ? "selected" : ""}>Static review</option><option value="runtime" ${activity.kind === "runtime" ? "selected" : ""}>Runtime review</option></select></label>
      <label>Date <input name="date" value="${esc(activity.date ?? "")}" placeholder="YYYY-MM-DD" inputmode="numeric"></label>
      <button class="save" type="submit">Filter</button>
    </form>
    ${activity.empty && !filtering ? `<article class="empty-card"><h2>No reviews yet</h2><p>Nothing has been imported.</p></article>` : ""}
    ${items.length ? `<div class="runs">${list}</div>` : ""}
    ${activity.empty ? importForm : ""}
    ${detail ? `<article class="sheet detail-card">
      <p class="k">Selected review</p>
      <h2>${reported(detail.what_reviewed)}</h2>
      <div class="chips">${detail.synthetic ? `<span class="chip fixture">Synthetic fixture</span>` : ""}${chip("", captureLabel(detail.capture))}${chip("", detail.activity_label)}<span class="chip unknown">Not a trusted capture</span></div>
      <p>${esc(captureNote)}</p>
      <p class="path">${esc(detail.untrusted_notes)}</p>
      <h3>Evidence paths</h3>
      ${evidence}
      <p>${esc(detail.token_usage?.label)}: ${reported(detail.token_usage?.value)}</p>
      <p>${esc(writes)}</p>
      <details>
        <summary>Technical record</summary>
        <p>record_id ${esc(detail.id)}</p>
        <p>session_id ${reported(detail.session_id)}</p>
        <p>capture ${reported(detail.capture)}</p>
        <p>analysis_kind ${reported(detail.analysis_kind)}</p>
        <p>started_at ${reported(detail.started_at)}</p>
        <p>finished_at ${reported(detail.finished_at)}</p>
        <p>overall_verdict ${reported(detail.outcome?.overall_verdict)}</p>
        <p>exit_code ${reported(detail.outcome?.exit_code)}</p>
        <p>completed ${esc(String(detail.outcome?.completed))}</p>
        <p>Reported counts. These are not edits performed by this page. High ${reported(counts.high)}, medium ${reported(counts.medium)}, low ${reported(counts.low)}, fixed ${reported(counts.fixed)}, cannot determine ${reported(counts.cannot_determine)}.</p>
        <p>writes_detected=${esc(String(detail.observed_writes_detected))}</p>
        <p>artifact_only_enforced=false. usual_notes_loaded=${reported(detail.context_scope?.usual_notes_loaded)} does not prove a six-guide setup.</p>
        <p>trusted_runtime_capture=false</p>
        <p>agent ${esc(detail.reported_by?.agent ?? "")} tool ${esc(detail.reported_by?.tool?.name ?? "")}</p>
      </details>
    </article>` : ""}
    ${activity.empty ? "" : importForm}`;
}

/**
 * @param {LedgerEventRow} event
 * @returns {string}
 */
function trustChip(event) {
  if (event.trust === "synthetic_fixture" || event.evidence === "synthetic_fixture") return chip("fixture", "Synthetic fixture");
  if (event.trust === "client_reported") return chip("", "Client-reported");
  if (event.trust === "server_measured") return chip("ok", "Server-measured");
  return chip("unknown", "Unknown");
}

/**
 * @param {ObservabilityModel} model
 * @returns {string}
 */
export function renderObservability(model) {
  const prefs = model.section === "prefs" || Boolean(model.prefMessage);
  const usageOn = model.section === "usage";
  const activityOn = model.section === "activity";
  const failed = model.prefMessage.startsWith("Save failed");
  const ledger = model.ledger ?? { events: [], summary: null, error: "", status: 0, operation: "", trust: "", requestId: "" };
  const usageEmpty = ledger.status === 200 && ledger.events.length === 0 && !ledger.requestId;
  const usageDenied = ledger.status === 404 || ledger.error === "not_found";
  const usageRows = ledger.events
    .map(
      (event) => `<tr>
        <td>${trustChip(event)}</td>
        <td>${esc(event.operation)}</td>
        <td>${esc(event.outcome)}</td>
        <td>${event.inputTokens === null || event.inputTokens === undefined ? "Unknown" : esc(event.inputTokens)}</td>
        <td><code>${esc(event.requestId)}</code></td>
      </tr>`,
    )
    .join("");
  const rows = model.routes
    .map(
      (row) => `<tr><td>${esc(row.path)}</td><td>${esc(row.status)}</td><td>${esc(row.meaning)}</td></tr>`,
    )
    .join("");
  const linkRows = model.links ?? (model.release ? RELEASE_APP_LINKS : SETTINGS_LINKS);
  const currentHref = model.currentHref ?? (activityOn ? "/settings/observability?section=activity" : "/settings/observability");
  const settings = linkRows.map(
    ([href, label]) =>
      `<a href="${href}" ${model.links || model.release ? (href === currentHref ? 'aria-current="page"' : "") : href.endsWith("/observability") ? 'aria-current="page"' : ""}>${label}</a>`,
  ).join("");
  /**
   * @param {string} id
   * @param {string} panel
   * @param {string} label
   * @param {boolean} on
   * @returns {string}
   */
  const tab = (id, panel, label, on) =>
    `<button type="button" role="tab" id="${id}" aria-controls="${panel}" aria-selected="${on ? "true" : "false"}">${label}</button>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Settings · Observability</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='4' fill='%236600ae'/%3E%3C/svg%3E">
<style>${OBS_CSS}</style></head><body>
<main class="frame">
  <p class="crumb"><a href="/settings">Settings</a> <span aria-hidden="true">/</span> Observability</p>
  <h1>Observability</h1>
  <p class="lede">${esc(model.roleLabel)}</p>
  <p class="banner"><i></i>${esc(model.banner ?? (model.release ? "Deterministic view. No model was called. AI is disabled." : "Local preview · synthetic data"))}</p>
  <nav class="pills" aria-label="Settings">${settings}</nav>
  <div class="tabs" role="tablist" aria-label="Observability sections">
    ${tab("tab-status", "panel-status", "Status", !prefs && !usageOn && !activityOn)}
    ${tab("tab-agents", "panel-agents", "Agents", false)}
    <a role="tab" id="tab-activity" href="/settings/observability?section=activity" aria-controls="panel-activity" aria-selected="${activityOn ? "true" : "false"}">Activity</a>
    ${tab("tab-audit", "panel-audit", "Audit", false)}
    ${tab("tab-usage", "panel-usage", "Usage", usageOn)}
    ${tab("tab-prefs", "panel-prefs", "Preferences", prefs && !usageOn && !activityOn)}
  </div>
  <section id="panel-status" role="tabpanel" aria-labelledby="tab-status"${prefs || usageOn || activityOn ? " hidden" : ""}>
    <div class="grid">
      <article class="stat">${mark('<circle cx="12" cy="12" r="8"/><path d="m8.5 12.2 2.2 2.2 4.6-5"/>')}<p class="k">Readiness</p><p class="value">${esc(model.ready.label)}</p><p class="hint">${esc(model.ready.detail)}</p></article>
      <article class="stat">${mark('<path d="M3 12h4l2-5 3 10 2-5h7"/>')}<p class="k">Health</p><p class="value">${esc(model.health.label)}</p><p class="hint">${esc(model.health.detail)}</p></article>
      <article class="stat">${mark('<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>')}<p class="k">AI processor</p><p class="value">${esc(model.ai.label)}</p><p class="hint">${esc(model.ai.detail)}</p></article>
      <article class="stat">${mark('<circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2"/>')}<p class="k">Freshness</p><p class="value">Unknown</p><p class="hint">Source refresh success is not reported. Connector sync is not bound.</p></article>
    </div>
  </section>
  <section id="panel-activity" role="tabpanel" aria-labelledby="tab-activity"${activityOn ? "" : " hidden"}>
    ${activityPanel(model)}
  </section>
  <section id="panel-agents" role="tabpanel" aria-labelledby="tab-agents" hidden>
    <p class="banner"><i></i>Local preview · synthetic data</p>
    <p class="muted">These host records come from the recovered local seed. They are not live agent runs.</p>
    <div class="sheet">${model.agentRows}</div>
  </section>
  <section id="panel-audit" role="tabpanel" aria-labelledby="tab-audit" hidden>
    <div class="callout ${model.audit.kind === "ok" ? "" : "bad"}">
      <h2>Audit</h2>
      <p>${chip(model.audit.kind, model.audit.label)}</p>
      <p>${esc(model.audit.detail)}</p>
    </div>
    <details>
      <summary>Audit response</summary>
      <pre>${esc(model.audit.raw)}</pre>
    </details>
  </section>
  <section id="panel-usage" role="tabpanel" aria-labelledby="tab-usage"${usageOn ? "" : " hidden"}>
    <p class="banner"><i></i>${model.release ? "Deterministic ledger. No model was called. AI is disabled." : "Local preview · synthetic data"}</p>
    <p class="muted">Signed in as ${esc(model.principalId)} in ${esc(model.tenantId)}. ${model.release ? "This page shows only this token's ledger." : "Switching session loads that person's ledger."} Cost is unknown. Client-reported numbers are not provider-verified.</p>
    ${model.release ? "" : `<form method="post" action="/settings/observability/session" class="tabs">
      <button type="submit" name="preset" value="person_a" aria-pressed="${model.preset === "person_b" ? "false" : "true"}">Consultant session</button>
      <button type="submit" name="preset" value="person_b" aria-pressed="${model.preset === "person_b" ? "true" : "false"}">Plus-address session</button>
    </form>`}
    <form method="get" action="/settings/observability">
      <input type="hidden" name="section" value="usage">
      <label>Operation <input name="operation" value="${esc(ledger.operation)}" placeholder="import"></label>
      <label>Trust <input name="trust" value="${esc(ledger.trust)}" placeholder="unknown"></label>
      <label>Request <input name="requestId" value="${esc(ledger.requestId)}" placeholder="Request id"></label>
      <button class="save" type="submit">Filter</button>
    </form>
    ${usageDenied ? `<p class="alert" role="status">That operation is not in this session. Nothing from another person is shown.</p>` : ""}
    ${usageEmpty ? `<p role="status">No usage events for this session. That is an empty ledger, not a measured zero.</p>` : ""}
    ${ledger.summary ? `<div class="grid">
      <article class="stat"><p class="k">Import operations</p><p class="value">${esc(ledger.summary.operations)}</p><p class="hint">Distinct import requests. Not a token count.</p></article>
      <article class="stat"><p class="k">Unknown usage</p><p class="value">${esc(ledger.summary.tokenCoverage.unknown)}</p><p class="hint">Events with no measured tokens.</p></article>
      <article class="stat"><p class="k">Input tokens</p><p class="value">${esc(tokenLabel(ledger.summary.input))}</p><p class="hint">Known inputs are not summed with unknown events. Cache is separate. Cost is unknown.</p></article>
    </div>` : ""}
    ${usageRows ? `<table><thead><tr><th>Evidence</th><th>Operation</th><th>State</th><th>Input</th><th>Request</th></tr></thead><tbody>${usageRows}</tbody></table>` : ""}
    ${model.release ? "" : `<form method="post" action="/settings/observability/usage">
      <button class="save" type="submit" name="kind" value="report">Record synthetic client report (2 + 2)</button>
      <button class="save" type="submit" name="kind" value="fixture">Record synthetic zero fixture</button>
    </form>`}
    <p class="muted">A client report stays client-reported and is not provider-verified. A synthetic fixture, including a zero, is not server-measured and is not added to live token totals. Unknown usage is not zero. Provider-verified billing is not available.</p>
  </section>
  <section id="panel-prefs" role="tabpanel" aria-labelledby="tab-prefs"${prefs && !usageOn ? "" : " hidden"}>
    <div class="callout">
      <h2>Language</h2>
      <p class="muted">Saves the recovered language preference for this local session. It does not change telemetry.</p>
      <form method="post" action="/settings/observability/prefs">
        <label>Language
          <select name="lang">
            <option value="">Follow unset</option>
            <option value="en" ${model.lang === "en" ? "selected" : ""}>English</option>
            <option value="fr" ${model.lang === "fr" ? "selected" : ""}>French</option>
          </select>
        </label>
        <button class="save" type="submit">Save preference</button>
      </form>
      <p class="${failed ? "alert" : ""}" role="${model.prefMessage ? "alert" : "none"}">${esc(model.prefMessage)}</p>
    </div>
    <div class="block">
      <h2>Telemetry</h2>
      <p>${chip("unknown", "Unavailable")}</p>
      <label><input type="checkbox" disabled> Enable traces</label>
      <p class="muted">No recovered route writes sampling, logs, or paid telemetry. Cost and live uptime are unknown.</p>
    </div>
  </section>
  <details>
    <summary>Technical details</summary>
    <p class="muted">Role ${esc(model.roleLabel)}. Principal ${esc(model.principalId)}. Tenant ${esc(model.tenantId)}. Persona ${esc(model.persona)}.</p>
    <p class="muted">This screen is a reconstruction served beside the captured app. The stored shell has no Observability settings item; its settings router sends an unknown section back to Profile. The Settings link is added on the served page only. Readiness checks the local Durable Object and storage, not source freshness. ${esc(model.ready.technical)}</p>
    <label>Filter routes <input id="route-filter" type="search" placeholder="Filter routes"></label>
    <table id="route-table"><thead><tr><th>Route</th><th>Status</th><th>Meaning</th></tr></thead><tbody>${rows}</tbody></table>
  </details>
</main>
<script>
const tabs = [...document.querySelectorAll('[role="tab"]')];
function select(id) {
  for (const tab of tabs) {
    const on = tab.id === id;
    tab.setAttribute("aria-selected", on ? "true" : "false");
    document.getElementById(tab.getAttribute("aria-controls")).hidden = !on;
  }
}
for (const tab of tabs) {
  tab.addEventListener("click", () => select(tab.id));
  tab.addEventListener("keydown", (event) => {
    const i = tabs.indexOf(tab);
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const next = tabs[(i + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      next.focus();
      select(next.id);
    }
  });
}
document.getElementById("route-filter").addEventListener("input", (event) => {
  const q = event.target.value.toLowerCase();
  for (const row of document.querySelectorAll("#route-table tbody tr")) row.hidden = q && !row.textContent.toLowerCase().includes(q);
});
const activityFile = document.getElementById("activity-file");
if (activityFile) activityFile.addEventListener("change", async () => {
  const chosen = activityFile.files && activityFile.files[0];
  const area = document.querySelector("textarea[name=ndjson]");
  if (chosen && area) area.value = await chosen.text();
});
</script>
</body></html>`;
}

/**
 * @param {ImportModel} model
 * @returns {string}
 */
export function renderImport(model) {
  const failed = /Nothing was stored|could not be read back|was not reported/.test(model.message ?? "");
  const items = model.items
    .map((item) => {
      const hash = String(item.contentSha256 ?? "").slice(0, 12);
      return `<li><strong>${esc(item.externalId)}</strong> <span class="muted">v${esc(item.version)} · ${esc(hash)}</span><p>${esc(item.text)}</p></li>`;
    })
    .join("");
  const preset = model.preset === "person_b" ? "person_b" : "person_a";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Import</title>
<style>
:root { color-scheme: light; --canvas:#f8f6f9; --ink:#17121a; --accent:#6600ae; --line:#d8d8df; --muted:#5c5d6d; --bad:#c70e1d; --panel:#fff; }
* { box-sizing: border-box; }
body { margin:0; background:var(--canvas); color:var(--ink); font-family:ui-sans-serif,system-ui,sans-serif; }
.frame { max-width: 760px; margin: 0 auto; padding: 28px 16px 64px; }
h1 { margin: 8px 0; font-size: 36px; letter-spacing: -0.03em; }
a { color: inherit; }
.banner { display:inline-flex; margin: 8px 0 16px; padding: 6px 12px; border-radius: 999px; background:#fcf3ff; color:var(--accent); font-size:13px; font-weight:650; }
form, .sheet, details { background:var(--panel); border:1px solid var(--line); border-radius:22px; padding:16px; }
details { margin: 12px 0 16px; }
summary { cursor: pointer; font-weight: 650; }
label { display:block; margin:10px 0; font-size:14px; }
input, textarea, select, button { font:inherit; width:100%; border-radius:12px; border:1px solid var(--line); padding:10px; }
button { width:auto; background:var(--accent); color:white; cursor:pointer; }
.switch { display:flex; gap:8px; flex-wrap:wrap; margin-top:12px; }
.switch button { background:#fff; color:var(--ink); }
.switch button[aria-current="true"] { background:var(--accent); color:#fff; }
.alert { color:var(--bad); font-weight:650; }
.muted { color:var(--muted); }
.capsule { display:flex; flex-wrap:wrap; gap:2px; width:fit-content; max-width:100%; background:#17121a; border-radius:999px; padding:4px; margin:0 0 16px; }
.capsule a { color:#fff; text-decoration:none; font-size:13px; padding:6px 10px; border-radius:999px; }
.capsule a[aria-current="page"] { background:#fff; color:#17121a; }
:focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
@media (max-width:720px) { h1 { font-size:30px; } }
</style></head><body><main class="frame">
<p><a href="/settings">Settings</a> / Import</p>
<h1>Import into your brain</h1>
<p class="banner">${model.release ? "Deterministic import. No model was called. AI is disabled." : "Local preview"}</p>
${textNav(model.links ?? RELEASE_APP_LINKS, model.currentHref ?? "/reconstruction/import")}
<p class="muted">Paste text, or choose a .txt or .md file. Limit 7000 characters and 8000 bytes. Other types, path names, scripts, and URL fetches are refused. Model usage stays unknown.</p>
<p>Signed in as <strong>${esc(model.who)}</strong> in <strong>${esc(model.tenant)}</strong>.</p>
<details><summary>Session limits</summary>
<p>${model.release ? "The release edge chooses the person from the verified token. The form cannot grant a person, a tenant, or model usage. This is not a live model view." : "The server chooses the person and tenant from this fixture session. The form cannot grant either, and it cannot set model usage. The default session is the seeded consultant. The other button is the CEO plus-address in this same local tenant, not a second company. Two new users in two tenants are covered by the local MCP OAuth test."}</p>
</details>
${model.release ? "" : `<form method="post" action="/reconstruction/import/session" class="switch">
<button name="preset" value="person_a" type="submit" aria-current="${preset === "person_a" ? "true" : "false"}">Consultant session</button>
<button name="preset" value="person_b" type="submit" aria-current="${preset === "person_b" ? "true" : "false"}">Plus-address session</button>
</form>`}
<p id="import-status" class="${failed ? "alert" : ""}" role="status">${esc(model.message)}</p>
<form method="post" action="/reconstruction/import">
<label>External id <input name="externalId" required maxlength="64" value="note-1"></label>
<label>Version <input name="version" type="number" min="1" max="1000" value="1" required></label>
<label>Source
<select name="source"><option value="paste">Pasted text</option><option value="file">Text file</option></select>
</label>
<label>File name, only for a file <input name="filename" placeholder="notes.md"></label>
<label>Text <textarea name="text" rows="8" required></textarea></label>
<label>Optional .txt or .md file <input id="local-file" type="file" accept=".txt,.md,text/plain,text/markdown"></label>
<button type="submit">Store in my personal brain</button>
</form>
<script>
document.getElementById("local-file").addEventListener("change", async (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const name = file.name || "";
  const allowed = /\.(txt|md)$/i.test(name);
  document.querySelector("[name=filename]").value = name;
  document.querySelector("[name=source]").value = "file";
  document.querySelector("[name=text]").value = allowed ? await file.text() : "";
  const status = document.getElementById("import-status");
  if (!allowed && status) {
    status.textContent = "Only .txt and .md files are accepted. Nothing was stored.";
    status.className = "alert";
  }
});
</script>
<section class="sheet"><h2>Imported text</h2><p class="muted">Showing ${esc(model.shown ?? (Array.isArray(model.items) ? model.items.length : 0))} of ${esc(model.total ?? model.kept ?? 0)}. Coverage is ${esc(model.coverage || "full")}. Existing notes were not deleted.</p><p><a href="/brains/me">Open Personal brain</a></p><ul>${items || "<li>No import is stored for this session.</li>"}</ul></section>
</main></body></html>`;
}

/**
 * @param {GenuiState} state
 * @returns {string}
 */
export function renderGenui(state) {
  return page(
    "GenUI flow",
    "/reconstruction/genui",
    `<p class="note">NEW reconstruction. The captured shell does not call /v1/genui/plan. This page does, through the local recovered API. KpiRow is not renamed to KpiTile.</p>
<h1>Per-person view</h1>
<p>${esc(state.who)}</p>
<p>Personal brain from /v1/brains/nav: ${esc(state.personal)}</p>
<p>Recovered planner ${esc(state.request)} returned ${esc(state.planStatus)}. Another principal's personal node is not substituted.</p>
<form method="post" action="/reconstruction/session">
  <button class="action" name="preset" value="person_a" type="submit">Person A consultant</button>
  <button class="action" name="preset" value="person_b" type="submit">Person B ceo</button>
  <button class="action" name="scope" value="personal" type="submit">Personal plan</button>
  <button class="action" name="scope" value="company" type="submit">Company accounts plan</button>
</form>
<section class="panel" id="plan">${state.planHtml}</section>
<form method="post" action="/reconstruction/genui/reject">
  <input type="hidden" name="title" value="&lt;script&gt;SECRET_TOKEN_99&lt;/script&gt;">
  <button class="action" type="submit">Submit an unsafe plan</button>
</form>
<p class="note">A tenant query on this page is ignored. The session tenant comes from /v1/me.</p>`,
  );
}

/**
 * @param {PersonalModel} model
 * @returns {string}
 */
export function renderPersonal(model) {
  const plan = model.plan ?? {};
  const denied = model.status !== 200;
  const notes = denied || !Array.isArray(plan.context) ? [] : plan.context;
  const cards = notes
    .map(
      (item) => `<article class="note">
        <h2>${esc(item.externalId)}</h2>
        <p class="meta">Version ${esc(item.version)} · ${esc(String(item.contentSha256 ?? "").slice(0, 12))}</p>
        <p class="body">${esc(item.text)}</p>
      </article>`,
    )
    .join("");
  const coverage = denied
    ? ""
    : plan.empty
      ? `<p class="empty" role="status">This personal brain has no imported context yet. That is an empty brain, not a consultant or CEO task list.</p>`
      : `<p class="meta" data-coverage="${esc(plan.coverage)}">Showing ${esc(plan.shown)} of ${esc(plan.total)}. Coverage is ${esc(plan.coverage)}.</p>${cards}`;
  const state = denied
    ? `<p class="alert" role="status">That brain is not open to this session. Nothing from another owner is shown.</p>`
    : coverage;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Your personal brain</title>
<style>
:root { color-scheme: light; --canvas:#f8f6f9; --ink:#17121a; --accent:#6600ae; --line:#d8d8df; --muted:#5c5d6d; --bad:#c70e1d; --panel:#fff; }
* { box-sizing: border-box; }
body { margin:0; background:var(--canvas); color:var(--ink); font-family:ui-sans-serif,system-ui,sans-serif; }
.frame { max-width: 760px; margin: 0 auto; padding: 28px 16px 64px; }
nav { display:flex; flex-wrap:wrap; gap:10px; margin: 0 0 16px; }
nav a { color: var(--accent); }
h1 { margin: 8px 0; font-size: 36px; letter-spacing: -0.03em; overflow-wrap: anywhere; }
h2 { margin: 0 0 4px; font-size: 18px; overflow-wrap: anywhere; }
.banner { display:inline-flex; margin: 8px 0 16px; padding: 6px 12px; border-radius: 999px; background:#fcf3ff; color:var(--accent); font-size:13px; font-weight:650; }
.note, .empty { background:var(--panel); border:1px solid var(--line); border-radius:22px; padding:16px; margin: 12px 0; }
.body, .meta, .empty { overflow-wrap: anywhere; }
.meta { color: var(--muted); font-size: 14px; }
.alert { color: var(--bad); font-weight: 650; }
.capsule { display:flex; flex-wrap:wrap; gap:2px; width:fit-content; max-width:100%; background:#17121a; border-radius:999px; padding:4px; margin:0 0 16px; }
.capsule a { color:#fff; text-decoration:none; font-size:13px; padding:6px 10px; border-radius:999px; }
.capsule a[aria-current="page"] { background:#fff; color:#17121a; }
@media (max-width: 720px) { h1 { font-size: 30px; } .frame { padding: 20px 12px 48px; } }
</style></head><body><main class="frame">
${textNav(model.links ?? RELEASE_APP_LINKS, model.currentHref ?? "/brains/me")}
<p class="banner">Deterministic plan. No model was called. AI is disabled.</p>
<h1>Your personal brain</h1>
<p class="meta">Signed in as ${esc(plan.principalId || model.email || "unknown")} in ${esc(plan.tenantId || "unknown")}. The server chose this owner. A requested brain id is not a grant. Provider configuration is absent, so this is not a live model view.</p>
${state}
</main></body></html>`;
}

/**
 * @typedef {{
 *   surface: "release" | "preview",
 *   who: string,
 *   tenant: string,
 *   links: [string, string][],
 *   currentHref: string,
 *   brain: { state: "empty" | "open" | "denied" | "unavailable", shown: number | null, total: number | null, coverage: string | null, detail: string },
 *   activity: { state: "empty" | "open" | "unavailable", count: number | null, detail: string },
 *   usage: { state: "unknown" | "empty" | "recorded" | "unavailable", detail: string },
 *   notice: string
 * }} HomeModel
 */

/**
 * @param {HomeModel} model
 * @returns {string}
 */
export function renderHome(model) {
  /**
   * @param {string} label
   * @returns {string}
   */
  const href = (label) => model.links.find((entry) => entry[1] === label)?.[0] ?? "#";
  const brainLine = model.brain.state === "open" && model.brain.shown !== null && model.brain.total !== null
    ? `Showing ${model.brain.shown} of ${model.brain.total}. Coverage is ${model.brain.coverage ?? "unknown"}.`
    : model.brain.detail;
  const activityLine = model.activity.state === "open" && model.activity.count !== null
    ? `${model.activity.count} review record${model.activity.count === 1 ? "" : "s"} stored for this sign-in.`
    : model.activity.detail;
  const statusLine = model.surface === "preview"
    ? "Not signed in. No account was contacted. This file has no review records."
    : "Signed in. No model was called. AI is disabled.";
  /**
   * @param {string} state
   * @returns {string}
   */
  const chip = (state) => {
    const label = { empty: "Empty", open: "Stored", denied: "Not open", unavailable: "Not loaded", unknown: "Unknown", recorded: "Recorded" }[state] ?? "Unknown";
    const kind = state === "denied" ? "bad" : state === "open" || state === "recorded" ? "ok" : "unknown";
    return `<span class="chip ${kind}">${esc(label)}</span>`;
  };
  /**
   * @param {string} state
   * @param {number | null} value
   * @returns {string}
   */
  const metric = (state, value) => {
    if (state === "open" && value !== null) return String(value);
    if (state === "empty") return "None";
    if (state === "recorded") return "Recorded";
    if (state === "denied") return "Not open";
    return "Unknown";
  };
  const notesMetric = metric(model.brain.state, model.brain.state === "open" ? model.brain.shown : null);
  const reviewMetric = metric(model.activity.state, model.activity.count);
  const usageMetric = model.usage.state === "empty" ? "None" : model.usage.state === "recorded" ? "Recorded" : "Unknown";
  /** @type {{ kind: string, href: string, label: string, hint: string, filter: string }[]} */
  const actions = [
    ...model.links.map(([link, label]) => ({ kind: "go", href: link, label: `Go to ${label}`, hint: "Open this page", filter: label.toLowerCase() })),
    { kind: "limits", href: href("Import"), label: "Show what this screen will not do", hint: "No model, no approval, no agent run", filter: "limits" },
  ];
  const rows = [
    ["notes", "Personal brain", "Notes", model.brain.state, brainLine, href("Personal brain")],
    ["reviews", "Review activity", "Reviews", model.activity.state, activityLine, href("Activity")],
    ["usage", "Usage ledger", "Usage", model.usage.state, model.usage.detail, href("Observability")],
  ];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Second Brain</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='4' fill='%2317121a'/%3E%3C/svg%3E">
<style>
/* Tokens observed 2026-11-07 from https://mantu.com/ via https://mantu.com/_next/static/chunks/0f4n.iw4c7x10.css : --primary-main #6600ae, --primary-50 #fcf3ff, --primary-950 #41007c, --dark-main #17121a, --dark-50 #f8f6f9, --grey-200 #d8d8df, --grey-600 #5c5d6d, --red-700 #c70e1d, --yellow-main #ffc709. Recovered index-DiBYRwP4.css repeats --purple #6600ae and sets --st-done #1e6b34, --add-bg #e6f6ea. */
:root { color-scheme: light; --canvas:#f8f6f9; --ink:#17121a; --muted:#5c5d6d; --line:#d8d8df; --accent:#6600ae; --bad:#c70e1d; --ok:#1e6b34; --tint:#fcf3ff; --focus-dark:#ffc709; }
* { box-sizing: border-box; }
html, body { margin: 0; max-width: 100%; }
body { background: var(--canvas); color: var(--ink); font: 14px/1.4 ui-sans-serif, system-ui, sans-serif; }
button, input { font: inherit; }
.top { display: grid; grid-template-columns: minmax(0,1fr) auto minmax(0,1fr); align-items: center; gap: 10px; max-width: 1120px; margin: 0 auto; padding: 14px 16px 6px; }
.brand { font-size: 13px; font-weight: 720; letter-spacing: -0.03em; }
.capsule { display: flex; flex-wrap: wrap; gap: 2px; justify-content: center; background: #17121a; color: #fff; border-radius: 999px; padding: 3px; max-width: 100%; }
.capsule a { color: #fff; text-decoration: none; font-size: 13px; padding: 6px 11px; border-radius: 999px; white-space: nowrap; }
.capsule a[aria-current="page"] { background: #fff; color: #17121a; }
.utils { justify-self: end; display: flex; align-items: center; gap: 8px; min-width: 0; }
.who { color: var(--muted); font-size: 12px; overflow-wrap: anywhere; text-align: right; }
.util { border: 1px solid var(--line); background: #fff; border-radius: 999px; padding: 6px 10px; cursor: pointer; font-size: 12px; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.capsule a:focus-visible, .util:focus-visible { outline-color: var(--focus-dark); }
.util kbd { font: inherit; color: var(--muted); }
.workspace { max-width: 1120px; margin: 8px auto 28px; background: #fff; border: 1px solid var(--line); border-radius: 18px; padding: 18px 18px 20px; min-width: 0; }
h1 { margin: 0; font-size: 22px; line-height: 1.15; letter-spacing: -0.03em; font-weight: 640; }
.sub, .notice { margin: 4px 0 0; color: var(--muted); font-size: 13px; overflow-wrap: anywhere; }
.notice { color: var(--bad); }
.filters { display: flex; flex-wrap: wrap; gap: 2px; margin-top: 12px; }
.filters button { border: 0; background: transparent; color: var(--muted); border-radius: 8px; padding: 5px 9px; cursor: pointer; }
.filters button[aria-pressed="true"] { background: var(--tint); color: #41007c; }
.band { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 0; background: #17121a; color: #fff; border-radius: 14px; padding: 14px 6px; margin: 14px 0 12px; }
.band div { padding: 0 12px; min-width: 0; }
.band .k { color: #d8d8df; font-size: 11px; font-weight: 650; }
.band .n { font-size: 22px; font-weight: 640; letter-spacing: -0.03em; margin: 2px 0; overflow-wrap: anywhere; }
.band .s { color: #d8d8df; font-size: 11px; }
.table-wrap { max-width: 100%; overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: left; font-size: 11px; font-weight: 650; color: var(--muted); padding: 8px 10px; border-bottom: 1px solid var(--line); }
td { padding: 10px; border-bottom: 1px solid #f4f1f6; vertical-align: middle; }
td:last-child { overflow-wrap: anywhere; }
td a { color: inherit; }
.chip { display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 999px; background: #eef0f3; color: #3c4454; white-space: nowrap; }
.chip.ok { background: #e6f6ea; color: var(--ok); }
.chip.bad { background: #fff1f1; color: var(--bad); }
.chip.unknown { background: #eef0f3; color: #5c6574; }
.overlay[hidden] { display: none; }
.overlay { position: fixed; inset: 0; z-index: 20; background: rgba(23,18,26,.38); display: grid; align-items: start; justify-content: center; padding: 11vh 16px 16px; }
.panel { width: min(560px, 100%); background: #fff; border-radius: 16px; box-shadow: 0 24px 60px rgba(23,18,26,.18); overflow: hidden; }
.panel header, .panel p { padding: 0 16px; }
.panel h2 { margin: 14px 16px 6px; font-size: 16px; letter-spacing: -0.02em; }
.panel input { width: 100%; border: 0; border-bottom: 1px solid #eee; padding: 14px 16px; outline: none; font-size: 15px; }
.panel [role="option"], .panel .close, .panel .go { display: block; width: 100%; text-align: left; background: #fff; border: 0; padding: 10px 16px; cursor: pointer; }
.panel [role="option"][aria-selected="true"] { background: var(--tint); box-shadow: inset 2px 0 0 var(--accent); }
.panel .hint { color: var(--muted); font-size: 12px; }
.panel .actions { display: flex; gap: 8px; padding: 12px 16px 16px; }
.panel .actions a, .panel .actions button { width: auto; border-radius: 999px; padding: 8px 12px; text-decoration: none; font-size: 13px; }
.panel .actions button { border: 1px solid #ddd; background: #fff; cursor: pointer; }
.panel .actions a { background: #17121a; color: #fff; }
@media (max-width: 720px) {
  .top { grid-template-columns: 1fr auto; }
  .capsule { grid-column: 1 / -1; justify-content: flex-start; }
  .band { grid-template-columns: 1fr 1fr; gap: 10px 0; }
  h1 { font-size: 20px; }
  thead { display: none; }
  table, tbody { display: block; width: 100%; }
  tr:not([hidden]) { display: block; width: 100%; padding: 8px 0 10px; border-bottom: 1px solid #f4f1f6; }
  tr[hidden] { display: none; }
  td { display: block; width: 100%; border: 0; padding: 1px 0; }
  td:nth-child(2) { color: var(--muted); font-size: 12px; }
}
</style></head><body>
<header class="top">
  <div class="brand">Mantu</div>
  <nav class="capsule" aria-label="Second Brain">${model.links.map(([link, label]) => `<a href="${esc(link)}"${link === model.currentHref ? ' aria-current="page"' : ""}>${esc(label)}</a>`).join("")}</nav>
  <div class="utils">
    <span class="who">${esc(model.who)}</span>
    <button class="util" id="open-palette" type="button">Search <kbd>Ctrl K</kbd></button>
  </div>
</header>
<main class="workspace">
  <h1>Second Brain</h1>
  <p class="sub">${esc(statusLine)} ${esc(model.tenant)}.</p>
  ${model.notice ? `<p class="notice" role="status">${esc(model.notice)}</p>` : ""}
  <div class="filters" role="toolbar" aria-label="Rows">
    <button type="button" data-filter="all" aria-pressed="true">All</button>
    <button type="button" data-filter="notes" aria-pressed="false">Notes</button>
    <button type="button" data-filter="reviews" aria-pressed="false">Reviews</button>
    <button type="button" data-filter="usage" aria-pressed="false">Usage</button>
  </div>
  <section class="band" aria-label="Not a live scoreboard">
    <div><p class="k">Notes</p><p class="n">${esc(notesMetric)}</p><p class="s">${model.brain.state === "empty" ? "Nothing stored" : "Stored notes, or unknown"}</p></div>
    <div><p class="k">Reviews</p><p class="n">${esc(reviewMetric)}</p><p class="s">Imported records only</p></div>
    <div><p class="k">Usage</p><p class="n">${esc(usageMetric)}</p><p class="s">Not a token total</p></div>
    <div><p class="k">Cost</p><p class="n">Unknown</p><p class="s">No price list. Not zero.</p></div>
    <div><p class="k">Uptime</p><p class="n">Unknown</p><p class="s">Not measured</p></div>
  </section>
  <div class="table-wrap">
    <table>
      <thead><tr><th>Item</th><th>Kind</th><th>Status</th><th>Detail</th></tr></thead>
      <tbody>
        ${rows.map(([kind, item, group, state, detail, link]) => `<tr data-kind="${kind}"><td><a href="${esc(link)}">${esc(item)}</a></td><td>${esc(group)}</td><td>${chip(state)}</td><td>${esc(detail)}</td></tr>`).join("")}
        <tr data-kind="none" hidden><td colspan="4">No rows in this filter.</td></tr>
      </tbody>
    </table>
  </div>
</main>
<div class="overlay" id="palette" hidden>
  <div class="panel" role="dialog" aria-modal="true" aria-labelledby="palette-title">
    <h2 id="palette-title">Command palette</h2>
    <input id="palette-q" type="text" placeholder="Search pages" autocomplete="off">
    <div id="palette-list" role="listbox" aria-label="Actions"></div>
  </div>
</div>
<div class="overlay" id="limits" hidden>
  <div class="panel" role="dialog" aria-modal="true" aria-labelledby="limits-title">
    <h2 id="limits-title">What this screen will not do</h2>
    <p>It does not start an agent, approve a plan, or check a security policy. Nothing here is a completed run.</p>
    <p>Opening Import does not store a note until that page is submitted in the signed-in app. This dialog does not submit anything.</p>
    <p>Cost, uptime, and agent coverage stay unknown. Unknown is not zero.</p>
    <div class="actions">
      <button class="close" id="close-limits" type="button">Close</button>
      <a class="go" href="${esc(href("Import"))}">Go to import</a>
    </div>
  </div>
</div>
<script>
(function () {
  const actions = ${JSON.stringify(actions)};
  const palette = document.getElementById("palette");
  const limits = document.getElementById("limits");
  const input = document.getElementById("palette-q");
  const list = document.getElementById("palette-list");
  const openBtn = document.getElementById("open-palette");
  const closeLimitsBtn = document.getElementById("close-limits");
  let active = 0;
  let lastFocus = null;
  let shown = actions.slice();
  function matches(item, query) {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (item.label + " " + item.hint + " " + item.filter).toLowerCase().includes(q);
  }
  function render(query) {
    shown = actions.filter((item) => matches(item, query));
    if (active >= shown.length) active = 0;
    list.replaceChildren();
    shown.forEach((item, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", index === active ? "true" : "false");
      button.innerHTML = item.label + '<div class="hint">' + item.hint + "</div>";
      button.addEventListener("click", () => { active = index; activate(); });
      list.appendChild(button);
    });
    if (!shown.length) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "No matching page.";
      list.appendChild(empty);
    }
  }
  function openPalette() {
    lastFocus = document.activeElement;
    limits.hidden = true;
    palette.hidden = false;
    input.value = "";
    render("");
    input.focus();
  }
  function closePalette() {
    palette.hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function openLimits() {
    lastFocus = lastFocus || document.activeElement;
    palette.hidden = true;
    limits.hidden = false;
    closeLimitsBtn.focus();
  }
  function closeLimits() {
    limits.hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function move(step) {
    if (!shown.length) return;
    active = (active + step + shown.length) % shown.length;
    render(input.value);
  }
  function activate() {
    const item = shown[active];
    if (!item) return;
    if (item.kind === "limits") { openLimits(); return; }
    location.href = item.href;
  }
  function trap(event, root) {
    if (event.key !== "Tab" || root.hidden) return;
    const nodes = [...root.querySelectorAll("a, button, input")].filter((el) => !el.disabled);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  openBtn.addEventListener("click", openPalette);
  closeLimitsBtn.addEventListener("click", closeLimits);
  input.addEventListener("input", () => { active = 0; render(input.value); });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
    else if (event.key === "Enter") { event.preventDefault(); activate(); }
  });
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (palette.hidden) openPalette();
      else closePalette();
      return;
    }
    if (event.key === "Escape") {
      if (!limits.hidden) { event.preventDefault(); closeLimits(); return; }
      if (!palette.hidden) { event.preventDefault(); closePalette(); }
    }
    trap(event, palette);
    trap(event, limits);
  });
  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      const filter = button.getAttribute("data-filter");
      document.querySelectorAll("[data-filter]").forEach((peer) => peer.setAttribute("aria-pressed", peer === button ? "true" : "false"));
      let visible = 0;
      document.querySelectorAll("tbody tr[data-kind]").forEach((row) => {
        const kind = row.getAttribute("data-kind");
        const show = kind !== "none" && (filter === "all" || kind === filter);
        row.hidden = !show;
        if (show) visible += 1;
      });
      const none = document.querySelector('tr[data-kind="none"]');
      if (none) none.hidden = visible !== 0;
    });
  });
})();
</script>
</body></html>`;
}

/**
 * @param {{ surface: "release" | "preview", links: [string, string][], currentHref: string, who: string }} model
 * @returns {string}
 */
export function renderSharedDocuments(model) {
  const program = [isRecord, exactKeys, nonEmpty, whole, utf8Bytes, sharePointText, inertHttpUrl, validateRegister, projectRegister, visibleRows]
    .map((fn) => fn.toString())
    .join("\n");
  const status = model.surface === "preview"
    ? "Not signed in. No account was contacted. This file starts empty."
    : `Signed in as ${model.who}. A register stays in this browser and is not uploaded.`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Shared documents</title>
<style>
:root { color-scheme: light; --canvas:#f8f6f9; --ink:#17121a; --muted:#5c5d6d; --line:#d8d8df; --accent:#6600ae; --bad:#c70e1d; --ok:#1e6b34; --tint:#fcf3ff; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--canvas); color: var(--ink); font: 14px/1.45 ui-sans-serif, system-ui, sans-serif; }
.top { display: grid; grid-template-columns: minmax(0,1fr) auto minmax(0,1fr); gap: 10px; align-items: center; max-width: 1120px; margin: 0 auto; padding: 14px 16px 6px; }
.brand { font-size: 13px; font-weight: 720; }
.capsule { display: flex; flex-wrap: wrap; gap: 2px; justify-content: center; background: #17121a; border-radius: 999px; padding: 3px; max-width: 100%; }
.capsule a { color: #fff; text-decoration: none; font-size: 13px; padding: 6px 11px; border-radius: 999px; }
.capsule a[aria-current="page"] { background: #fff; color: #17121a; }
.workspace { max-width: 1120px; margin: 8px auto 28px; background: #fff; border: 1px solid var(--line); border-radius: 18px; padding: 18px; min-width: 0; }
h1 { margin: 0; font-size: 22px; letter-spacing: -0.03em; }
.sub, .notice { margin: 6px 0 0; color: var(--muted); font-size: 13px; overflow-wrap: anywhere; }
.notice { color: var(--bad); }
label { display: grid; gap: 6px; margin: 12px 0; font-size: 12px; color: var(--muted); font-weight: 650; }
textarea, input[type="search"], select, input[type="file"] { width: 100%; font: inherit; color: var(--ink); border: 1px solid var(--line); border-radius: 12px; padding: 10px; background: #fff; }
.row { display: flex; flex-wrap: wrap; gap: 8px; }
button { font: inherit; border-radius: 999px; border: 1px solid var(--line); background: #fff; padding: 8px 12px; cursor: pointer; }
button.primary { background: #6600ae; color: #fff; border-color: #6600ae; }
.band { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 8px; background: #17121a; color: #fff; border-radius: 14px; padding: 12px; margin: 14px 0; }
.band p { margin: 0; }
.band .k { color: #d8d8df; font-size: 11px; }
.band .n { font-size: 18px; margin: 2px 0; overflow-wrap: anywhere; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { text-align: left; padding: 8px; border-bottom: 1px solid #f4f1f6; vertical-align: top; overflow-wrap: anywhere; }
th { color: var(--muted); font-size: 11px; }
.chip { display: inline-block; border-radius: 999px; padding: 2px 8px; background: var(--tint); color: #41007c; font-size: 11px; }
:focus-visible { outline: 2px solid #6600ae; outline-offset: 2px; }
@media (max-width: 720px) {
  .top { grid-template-columns: 1fr; }
  .band { grid-template-columns: 1fr 1fr; }
  thead { display: none; }
  table, tbody, tr, td { display: block; width: 100%; }
  tr { padding: 8px 0; border-bottom: 1px solid #f4f1f6; }
  td { border: 0; padding: 2px 0; }
}
</style></head><body>
<header class="top">
  <div class="brand">Mantu</div>
  <nav class="capsule" aria-label="Second Brain">${model.links.map(([link, label]) => `<a href="${esc(link)}"${link === model.currentHref ? ' aria-current="page"' : ""}>${esc(label)}</a>`).join("")}</nav>
</header>
<main class="workspace">
  <h1>Shared documents</h1>
  <p class="sub">${esc(status)} Possession, current identity, ACL, and unique document identity stay unknown unless a field in the file says otherwise. Null is not zero.</p>
  <p class="sub">SharePoint-bearing text is refused and is not opened. Links are shown as text and are not fetched.</p>
  <label>Local JSON file <input id="reg-file" type="file" accept=".json,application/json"></label>
  <label>Or paste JSON <textarea id="reg-paste" rows="6" placeholder="partial-shared-register-metadata-v1"></textarea></label>
  <div class="row">
    <button class="primary" id="reg-import" type="button">Import in this browser</button>
    <button id="reg-clear" type="button">Clear</button>
  </div>
  <p id="reg-status" class="sub" role="status">Empty. No shared-document register is loaded.</p>
  <label>Search <input id="reg-q" type="search" placeholder="Title, sender, subject, or id"></label>
  <label>Filter <select id="reg-filter"><option value="all">All occurrences</option><option value="variants">Variant candidates</option><option value="unknown-possession">Unknown possession</option><option value="shared-link">Has a shared link</option></select></label>
  <div id="reg-view"></div>
</main>
<script>
${program}
(function () {
  let current = null;
  const statusEl = document.getElementById("reg-status");
  const view = document.getElementById("reg-view");
  const paste = document.getElementById("reg-paste");
  const file = document.getElementById("reg-file");
  const search = document.getElementById("reg-q");
  const filter = document.getElementById("reg-filter");
  function line(parent, label, value) {
    const p = document.createElement("p");
    p.textContent = label + ": " + (value === null || value === undefined || value === "" ? "Unknown" : String(value));
    parent.appendChild(p);
  }
  function render() {
    view.replaceChildren();
    if (!current) return;
    const band = document.createElement("section");
    band.className = "band";
    const unique = current.counts.verified_unique_underlying_documents;
    for (const [label, value] of [
      ["Retained occurrences", current.counts.retained_occurrences],
      ["Retained events", current.counts.retained_sharing_evidence_events],
      ["Dedup candidates", current.counts.dedup_candidates],
      ["Variant groups", current.counts.identity_conflicts_or_variants],
      ["Verified copies", current.counts.verified_content_copies],
      ["Unique documents", unique === null ? "Unknown" : unique],
    ]) {
      const cell = document.createElement("div");
      const k = document.createElement("p");
      k.className = "k";
      k.textContent = label;
      const n = document.createElement("p");
      n.className = "n";
      n.textContent = String(value);
      cell.append(k, n);
      band.appendChild(cell);
    }
    view.appendChild(band);
    const trust = document.createElement("p");
    trust.className = "sub";
    trust.textContent = current.trustNote + (current.manifestClaim ? " The file claims manifest_checksum_verified." : " The file does not claim a verified manifest checksum.");
    view.appendChild(trust);
    const coverage = document.createElement("p");
    coverage.textContent = current.coverage;
    view.appendChild(coverage);
    const history = document.createElement("p");
    history.className = "sub";
    history.textContent = "Historical master: " + (current.historyPresent ? "rowset present" : "rowset absent") + ". " + current.historyCoverage;
    view.appendChild(history);
    if (current.conflicts.length) {
      const note = document.createElement("p");
      note.textContent = "Variant groups are not extra documents and do not establish a unique document.";
      view.appendChild(note);
    }
    const rows = visibleRows(current, search.value, filter.value);
    const table = document.createElement("table");
    const head = document.createElement("tr");
    for (const name of ["What", "Who", "When", "Provenance", "Identity"]) head.appendChild(Object.assign(document.createElement("th"), { textContent: name }));
    const thead = document.createElement("thead");
    thead.appendChild(head);
    const body = document.createElement("tbody");
    for (const row of rows) {
      const tr = document.createElement("tr");
      const what = document.createElement("td");
      what.textContent = row.title + " (" + row.type + ")";
      const who = document.createElement("td");
      who.textContent = row.events.map((event) => event.sender == null ? "Unknown" : String(event.sender)).join("; ") || "Unknown";
      const when = document.createElement("td");
      when.textContent = row.events.map((event) => event.dateOriginal + " / " + event.dateSaoPaulo).join("; ") || "Unknown";
      const prov = document.createElement("td");
      prov.textContent = row.pointer + (row.line == null ? " (no source line)" : " line " + row.line) + " · " + row.batch;
      const ident = document.createElement("td");
      ident.textContent = "Possession " + row.possession + ". Existence " + row.existence + ". Identity " + row.identity + ". ACL " + row.acl + ". Verified copy " + (row.verifiedCopy ? "true" : "false") + ". Candidate " + row.candidateId + (row.variant ? " (variant group)" : "") + ".";
      tr.append(what, who, when, prov, ident);
      body.appendChild(tr);
      for (const event of row.events) {
        const detail = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = 5;
        line(cell, "Subject", event.subject);
        line(cell, "Caveat", event.caveat);
        line(cell, "Date semantics", event.dateSemantics);
        line(cell, "Email link (not opened)", event.emailLink);
        line(cell, "Shared link (not opened)", event.sharedLink);
        line(cell, "Evidence id", event.evidenceId);
        detail.appendChild(cell);
        body.appendChild(detail);
      }
    }
    if (!rows.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 5;
      td.textContent = "No occurrences match this search or filter.";
      tr.appendChild(td);
      body.appendChild(tr);
    }
    table.append(thead, body);
    view.appendChild(table);
  }
  document.getElementById("reg-import").addEventListener("click", async () => {
    let text = paste.value;
    const chosen = file.files && file.files[0];
    if (chosen) text = await chosen.text();
    const result = validateRegister(text);
    if (!result.ok) {
      statusEl.className = "notice";
      statusEl.textContent = "Not imported (" + result.error + "). The previous register was kept.";
      return;
    }
    current = projectRegister(result.register);
    statusEl.className = "sub";
    statusEl.textContent = "Imported " + current.rows.length + " occurrence(s) in this browser. Provenance is supplied, not a pinned hash.";
    render();
  });
  document.getElementById("reg-clear").addEventListener("click", () => {
    current = null;
    paste.value = "";
    if (file.value) file.value = "";
    statusEl.className = "sub";
    statusEl.textContent = "Empty. No shared-document register is loaded.";
    render();
  });
  search.addEventListener("input", render);
  filter.addEventListener("change", render);
})();
</script>
</body></html>`;
}
