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
:root {
  color-scheme: light;
  --canvas: #e8ebf0;
  --ink: #1b2433;
  --nav: #1c2433;
  --panel: #ffffff;
  --muted: #3e4b5f;
  --line: #e3e7ee;
  --accent: #6d5bd0;
  --ok: #0f6b4c;
  --bad: #8d2f39;
  --shadow: 0 16px 40px rgba(27, 36, 51, 0.08);
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
  padding: 6px 12px; border-radius: 999px; background: #f3f0ff; color: #5346b8;
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
.pills a { color: #f5f7fa; background: transparent; }
.pills a[aria-current="page"] { background: #f7f8fa; color: var(--ink); }
.pills a:hover { background: rgba(255,255,255,0.14); }
.pills a[aria-current="page"]:hover { background: #ffffff; }
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
  background: #f3f0ff; color: var(--accent); margin-bottom: 14px;
}
.k { margin: 0; color: var(--muted); font-size: 13px; }
.value { margin: 8px 0 0; font-size: 22px; letter-spacing: -0.03em; }
.hint { margin: 8px 0 0; color: var(--muted); font-size: 14px; }
.sheet { padding: 8px 8px 4px; }
.host { display: flex; justify-content: space-between; gap: 12px; align-items: center; padding: 14px 12px; border-bottom: 1px solid var(--line); }
.host:last-child { border-bottom: 0; }
.host strong { display: block; font-size: 15px; }
.host span { color: var(--muted); font-size: 13px; }
.chip { display: inline-flex; align-items: center; border-radius: 999px; padding: 4px 10px; font-size: 12px; font-weight: 650; background: #f3f0ff; color: var(--accent); white-space: nowrap; }
.chip.ok { background: #e7f6ef; color: var(--ok); }
.chip.bad { background: #fdecef; color: var(--bad); }
.chip.unknown { background: #eef1f4; color: var(--muted); }
.callout { padding: 18px 20px; }
.callout.bad { background: #fff7f8; border-color: #f3d5da; }
.callout h2, .block h2 { margin: 0 0 8px; font-size: 18px; letter-spacing: -0.02em; }
.block { margin-top: 16px; }
label { display: block; margin: 12px 0; font-size: 14px; }
select, button.save, input[type="search"] {
  font: inherit; border-radius: 12px; border: 1px solid var(--line); background: white; padding: 10px 12px;
}
button.save { background: var(--ink); color: white; cursor: pointer; }
button.save:hover { background: #2c3850; }
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

export function renderObservability(model) {
  const prefs = Boolean(model.prefMessage);
  const failed = model.prefMessage.startsWith("Save failed");
  const rows = model.routes
    .map(
      (row) => `<tr><td>${esc(row.path)}</td><td>${esc(row.status)}</td><td>${esc(row.meaning)}</td></tr>`,
    )
    .join("");
  const settings = SETTINGS_LINKS.map(
    ([href, label]) =>
      `<a href="${href}" ${href.endsWith("/observability") ? 'aria-current="page"' : ""}>${label}</a>`,
  ).join("");
  const tab = (id, panel, label, on) =>
    `<button type="button" role="tab" id="${id}" aria-controls="${panel}" aria-selected="${on ? "true" : "false"}">${label}</button>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Settings · Observability</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='4' fill='%231c2433'/%3E%3C/svg%3E">
<style>${OBS_CSS}</style></head><body>
<main class="frame">
  <p class="crumb"><a href="/settings">Settings</a> <span aria-hidden="true">/</span> Observability</p>
  <h1>Observability</h1>
  <p class="lede">${esc(model.roleLabel)}</p>
  <p class="banner"><i></i>Local preview · synthetic data</p>
  <nav class="pills" aria-label="Settings">${settings}</nav>
  <div class="tabs" role="tablist" aria-label="Observability sections">
    ${tab("tab-status", "panel-status", "Status", !prefs)}
    ${tab("tab-agents", "panel-agents", "Agents", false)}
    ${tab("tab-audit", "panel-audit", "Audit", false)}
    ${tab("tab-prefs", "panel-prefs", "Preferences", prefs)}
  </div>
  <section id="panel-status" role="tabpanel" aria-labelledby="tab-status"${prefs ? " hidden" : ""}>
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
  <section id="panel-prefs" role="tabpanel" aria-labelledby="tab-prefs"${prefs ? "" : " hidden"}>
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

export function renderGenui(state) {
  return page(
    "GenUI flow",
    "/reconstruction/genui",
    `<p class="note">NEW reconstruction. The captured shell does not call /v1/genui/plan. This page does, through the local recovered API. KpiRow is not renamed to KpiTile.</p>
<h1>Per-person view</h1>
<p>${esc(state.who)}</p>
<p>Personal brain from /v1/brains/nav: ${esc(state.personal)}</p>
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
