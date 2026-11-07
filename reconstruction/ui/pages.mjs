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

export function renderObservability(model) {
  const prefs = Boolean(model.prefMessage);
  const rows = model.routes
    .map(
      (row) => `<tr><td>${esc(row.path)}</td><td>${esc(row.status)}</td><td>${esc(row.meaning)}</td></tr>`,
    )
    .join("");
  return page(
    "Observability",
    "/reconstruction/observability",
    `<p class="note">NEW reconstruction. The verified still suggested this hierarchy. Third-party vendor-risk wording from that still is not used. This is not a pixel copy of the video.</p>
<h1>Observability</h1>
<p>${esc(model.who)}</p>
<div class="tabs" role="tablist" aria-label="Observability sections">
  <button type="button" role="tab" aria-selected="${prefs ? "false" : "true"}" aria-controls="panel-status" id="tab-status">Status</button>
  <button type="button" role="tab" aria-selected="false" aria-controls="panel-agents" id="tab-agents">Agents</button>
  <button type="button" role="tab" aria-selected="false" aria-controls="panel-audit" id="tab-audit">Audit</button>
  <button type="button" role="tab" aria-selected="${prefs ? "true" : "false"}" aria-controls="panel-prefs" id="tab-prefs">Preferences</button>
</div>
<section class="panel" id="panel-status" role="tabpanel" aria-labelledby="tab-status"${prefs ? " hidden" : ""}>
  <h2>Local status</h2>
  <div class="grid">
    <article class="panel"><p class="k">Readiness</p><p>${chip(model.ready.kind, model.ready.label)}</p><p>${esc(model.ready.detail)}</p></article>
    <article class="panel"><p class="k">Health</p><p>${chip(model.health.kind, model.health.label)}</p><p>${esc(model.health.detail)}</p></article>
    <article class="panel"><p class="k">AI processor</p><p>${chip(model.ai.kind, model.ai.label)}</p><p>${esc(model.ai.detail)}</p></article>
    <article class="panel"><p class="k">Freshness</p><p>${chip("unknown", "Unknown")}</p><p>No recovered route reports source refresh success. Connector sync is not bound here.</p></article>
  </div>
  <h3>Recovered routes this session called</h3>
  <label>Filter <input id="route-filter" type="search" placeholder="Filter routes"></label>
  <table id="route-table"><thead><tr><th>Route</th><th>Status</th><th>Meaning</th></tr></thead><tbody>${rows}</tbody></table>
</section>
<section class="panel" id="panel-agents" role="tabpanel" aria-labelledby="tab-agents" hidden>
  <h2>Agent connections</h2>
  <p class="note">Synthetic demo. These host records come from the recovered local seed. They are not live agent runs, and a zero is not a measured quiet period.</p>
  ${model.agentRows}
  <p class="note">The recovered planner returns query components such as KpiRow. The delivered renderer has its own metric tile. This page does not rename one to the other.</p>
</section>
<section class="panel" id="panel-audit" role="tabpanel" aria-labelledby="tab-audit" hidden>
  <h2>Audit</h2>
  <p>${chip(model.audit.kind, model.audit.label)}</p>
  <p>${esc(model.audit.detail)}</p>
  <details><summary>Response detail</summary><pre>${esc(model.audit.raw)}</pre></details>
</section>
<section class="panel" id="panel-prefs" role="tabpanel" aria-labelledby="tab-prefs"${prefs ? "" : " hidden"}>
  <h2>Language preference</h2>
  <p class="note">This is the recovered PUT /v1/ux/prefs contract. It does not change Workers telemetry.</p>
  <form method="post" action="/reconstruction/observability/prefs">
    <label>Language
      <select name="lang">
        <option value="">Follow unset</option>
        <option value="en" ${model.lang === "en" ? "selected" : ""}>English</option>
        <option value="fr" ${model.lang === "fr" ? "selected" : ""}>French</option>
      </select>
    </label>
    <button class="action" type="submit">Save preference</button>
  </form>
  <p class="${model.prefMessage.startsWith("Save failed") ? "error" : ""}" role="${model.prefMessage ? "status" : "none"}">${esc(model.prefMessage)}</p>
  <h3>Workers telemetry</h3>
  <p>${chip("unknown", "Unavailable")}</p>
  <label><input type="checkbox" disabled> Enable traces <span class="note">No recovered route writes sampling, logs, or paid telemetry.</span></label>
  <p class="note">Cost and live uptime are unknown. This page does not invent them.</p>
</section>
<script>
const tabs = [...document.querySelectorAll('[role="tab"]')];
const panels = [...document.querySelectorAll('[role="tabpanel"]')];
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
    if (event.key === "ArrowRight") { event.preventDefault(); tabs[(i + 1) % tabs.length].focus(); select(tabs[(i + 1) % tabs.length].id); }
    if (event.key === "ArrowLeft") { event.preventDefault(); tabs[(i + tabs.length - 1) % tabs.length].focus(); select(tabs[(i + tabs.length - 1) % tabs.length].id); }
  });
}
document.getElementById("route-filter").addEventListener("input", (event) => {
  const q = event.target.value.toLowerCase();
  for (const row of document.querySelectorAll("#route-table tbody tr")) row.hidden = q && !row.textContent.toLowerCase().includes(q);
});
</script>`,
  );
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
