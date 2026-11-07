/**
 * NEW RECONSTRUCTION pages. Not recovered TypeScript and not the captured shell.
 * Visual direction is taken from the verified still: light gray canvas, ink navigation,
 * white rounded panels, muted labels, one restrained purple accent.
 * Mandate, Nova, SOC 2, and the numbers in that still are not copied.
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

const esc = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

function nav(current) {
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

function page(title, current, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='4' fill='%231e2636'/%3E%3C/svg%3E"><style>${CSS}</style></head><body>
${nav(current)}<main class="wrap">${body}</main></body></html>`;
}

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
  width: fit-content; margin: 26px 0 22px; padding: 7px;
  background: var(--nav); border-radius: 28px;
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
.tabs button { background: transparent; color: var(--muted); border: 1px solid transparent; }
.tabs button[aria-selected="true"] { background: white; color: var(--ink); border-color: var(--line); box-shadow: var(--shadow); }
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
@media (max-width: 720px) {
  .frame { padding: 20px 16px 48px; }
  h1 { font-size: 32px; }
  .value { font-size: 20px; }
  .host { align-items: flex-start; }
}
@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; scroll-behavior: auto !important; }
}
`;

function mark(paths) {
  return `<span class="mark" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg></span>`;
}

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

function tokenLabel(dimension) {
  if (!dimension || dimension.value === null) return "Unknown";
  if (dimension.value === 0 && dimension.complete) return "0 measured";
  if (!dimension.complete) return `${dimension.value} known, coverage incomplete`;
  return String(dimension.value);
}

function trustChip(event) {
  if (event.trust === "synthetic_fixture" || event.evidence === "synthetic_fixture") return chip("fixture", "Synthetic fixture");
  if (event.trust === "client_reported") return chip("", "Client-reported");
  if (event.trust === "server_measured") return chip("ok", "Server-measured");
  return chip("unknown", "Unknown");
}

export function renderObservability(model) {
  const prefs = model.section === "prefs" || Boolean(model.prefMessage);
  const usageOn = model.section === "usage";
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
  const linkRows = model.release
    ? [["/settings", "Settings"], ["/brains/me", "Personal brain"], ["/reconstruction/import", "Import"], ["/settings/observability", "Observability"]]
    : SETTINGS_LINKS;
  const settings = linkRows.map(
    ([href, label]) =>
      `<a href="${href}" ${href.endsWith("/observability") ? 'aria-current="page"' : ""}>${label}</a>`,
  ).join("");
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
  <p class="banner"><i></i>${model.release ? "Deterministic view. No model was called. AI is disabled." : "Local preview · synthetic data"}</p>
  <nav class="pills" aria-label="Settings">${settings}</nav>
  <div class="tabs" role="tablist" aria-label="Observability sections">
    ${tab("tab-status", "panel-status", "Status", !prefs && !usageOn)}
    ${tab("tab-agents", "panel-agents", "Agents", false)}
    ${tab("tab-audit", "panel-audit", "Audit", false)}
    ${tab("tab-usage", "panel-usage", "Usage", usageOn)}
    ${tab("tab-prefs", "panel-prefs", "Preferences", prefs && !usageOn)}
  </div>
  <section id="panel-status" role="tabpanel" aria-labelledby="tab-status"${prefs || usageOn ? " hidden" : ""}>
    <div class="grid">
      <article class="stat">${mark('<circle cx="12" cy="12" r="8"/><path d="m8.5 12.2 2.2 2.2 4.6-5"/>')}<p class="k">Readiness</p><p class="value">${esc(model.ready.label)}</p><p class="hint">${esc(model.ready.detail)}</p></article>
      <article class="stat">${mark('<path d="M3 12h4l2-5 3 10 2-5h7"/>')}<p class="k">Health</p><p class="value">${esc(model.health.label)}</p><p class="hint">${esc(model.health.detail)}</p></article>
      <article class="stat">${mark('<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>')}<p class="k">AI processor</p><p class="value">${esc(model.ai.label)}</p><p class="hint">${esc(model.ai.detail)}</p></article>
      <article class="stat">${mark('<circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2"/>')}<p class="k">Freshness</p><p class="value">Unknown</p><p class="hint">Source refresh success is not reported. Connector sync is not bound.</p></article>
    </div>
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
</script>
</body></html>`;
}

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
:focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
@media (max-width:720px) { h1 { font-size:30px; } }
</style></head><body><main class="frame">
<p><a href="/settings">Settings</a> / Import</p>
<h1>Import into your brain</h1>
<p class="banner">${model.release ? "Deterministic import. No model was called. AI is disabled." : "Local preview"}</p>
<nav aria-label="Settings"><a href="/settings">Settings</a> · <a href="/brains/me">Personal brain</a> · <a href="/settings/observability?section=usage">Usage</a> · <a href="/reconstruction/import" aria-current="page">Import</a></nav>
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
@media (max-width: 720px) { h1 { font-size: 30px; } .frame { padding: 20px 12px 48px; } }
</style></head><body><main class="frame">
<nav aria-label="Settings"><a href="/settings">Settings</a><a href="/settings/observability">Observability</a><a href="/reconstruction/import">Import</a><a href="/brains/me" aria-current="page">Personal brain</a></nav>
<p class="banner">Deterministic plan. No model was called. AI is disabled.</p>
<h1>Your personal brain</h1>
<p class="meta">Signed in as ${esc(plan.principalId || model.email || "unknown")} in ${esc(plan.tenantId || "unknown")}. The server chose this owner. A requested brain id is not a grant. Provider configuration is absent, so this is not a live model view.</p>
${state}
</main></body></html>`;
}
