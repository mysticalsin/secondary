/**
 * NEW RECONSTRUCTION local fixture. Not the original host.
 * Serves preserved capture bytes at the paths the recovered shell names.
 * Does not modify those bytes and does not contact the live app, fonts, or logos.
 */
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ViewBoundary } from "../genui/boundary.ts";
import { renderGenui, renderObservability } from "../ui/pages.mjs";
import { callApi, probeEgress, startRecoveredApi } from "./recovered-api.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));

export const CAPTURED = {
  "/": `${root}/recovered-delivery/html-shell/index.html`,
  "/index.html": `${root}/recovered-delivery/html-shell/index.html`,
  "/assets/index-PLmoiPYI.js": `${root}/recovered-delivery/main-js/index-PLmoiPYI.dom-captured.js`,
  "/assets/index-DiBYRwP4.css": `${root}/recovered-delivery/shell-six/assets/index-DiBYRwP4.css`,
  "/assets/PinnedGrid-CuaLdMPY.js": `${root}/recovered-delivery/shell-six/assets/PinnedGrid-CuaLdMPY.js`,
  "/assets/Renderer-0G0MSIPy.js": `${root}/recovered-delivery/shell-six/assets/Renderer-0G0MSIPy.js`,
  "/assets/ViewCard-D5JbjyDb.js": `${root}/recovered-delivery/shell-six/assets/ViewCard-D5JbjyDb.js`,
  "/assets/agent-DA0iqiiF.js": `${root}/recovered-delivery/shell-six/assets/agent-DA0iqiiF.js`,
  "/assets/agent-Wsu4vetM.css": `${root}/recovered-delivery/shell-six/assets/agent-Wsu4vetM.css`,
  "/assets/AgentPage-DHJmJKpV.js": `${root}/recovered-delivery/lazy-six/assets/AgentPage-DHJmJKpV.js`,
  "/assets/AgentPanel-Dn16YgEH.js": `${root}/recovered-delivery/lazy-six/assets/AgentPanel-Dn16YgEH.js`,
  "/assets/BrainViews-DoMdPJUS.js": `${root}/recovered-delivery/lazy-six/assets/BrainViews-DoMdPJUS.js`,
  "/assets/SettingsSection-f2wwgrYJ.js": `${root}/recovered-delivery/lazy-six/assets/SettingsSection-f2wwgrYJ.js`,
  "/assets/SharedView-CEqhSdzS.js": `${root}/recovered-delivery/lazy-six/assets/SharedView-CEqhSdzS.js`,
  "/assets/Thread-eq9OCIoK.js": `${root}/recovered-delivery/lazy-six/assets/Thread-eq9OCIoK.js`,
  "/assets/index-DZRyvnzT.js": `${root}/recovered-delivery/final-code/assets/index-DZRyvnzT.js`,
};

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

export function fixtureResponse(url) {
  const path = url.pathname;
  if (path === "/favicon.ico") {
    return {
      status: 200,
      type: "image/svg+xml",
      body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="4" fill="#1e2636"/></svg>`,
    };
  }
  if (path.startsWith("/brand/") || /\.(?:woff2?|png|svg)$/i.test(path)) {
    return {
      status: 404,
      type: "text/plain; charset=utf-8",
      body: `missing non-code asset\n${path}\nnot fetched\n`,
    };
  }
  const file = CAPTURED[path];
  if (!file) {
    return { status: 404, type: "text/plain; charset=utf-8", body: `not in the captured fixture\n${path}\n` };
  }
  return {
    status: 200,
    type: TYPES[extname(file)] ?? "application/octet-stream",
    body: readFileSync(file),
  };
}

const sessions = new Map();
const PRESETS = { person_a: "consultant", person_b: "ceo" };

function sessionOf(cookie) {
  const match = /(?:^|; )fixture=([^;]+)/.exec(cookie ?? "");
  const id = match ? decodeURIComponent(match[1]) : "";
  if (!sessions.has(id)) {
    const created = crypto.randomUUID();
    sessions.set(created, { preset: "person_a", scope: "personal", boundary: new ViewBoundary() });
    return { id: created, fresh: true, ...sessions.get(created) };
  }
  return { id, fresh: false, ...sessions.get(id) };
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function form(body) {
  return new URLSearchParams(body);
}

function agentRows(result) {
  const body = jsonBody(result.text);
  const hosts = Array.isArray(body.hosts) ? body.hosts : [];
  if (result.status !== "200") return `<p class="error">Unavailable (${esc(result.status)}).</p>`;
  if (hosts.length === 0) return "<p>No host records were returned.</p>";
  return hosts
    .map(
      (host) => `<div class="host"><div><strong>${esc(host.label ?? host.id ?? "unknown")}</strong><span>Last call ${esc(
        host.lastCallAt ?? "unknown",
      )}</span></div><span class="chip unknown">${host.connected === true ? "Connected" : "Not connected"}</span></div>`,
    )
    .join("");
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function jsonBody(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function observabilityModel(persona, prefMessage) {
  const routes = [
    ["/v1/health", "Liveness from the recovered worker. Not uptime."],
    ["/v1/ready", "Durable Object and R2 reachability only."],
    ["/v1/ai/status", "Processor gate. Not a live model bill."],
    ["/v1/ux/prefs", "Recovered language preference."],
    ["/v1/admin/audit?principal=u_consultant", "Audit viewer. Permission is the recovered rule."],
    ["/v1/agents", "Agent connections for this session."],
    ["/v1/brains/overview", "Synthetic org seed health, not live freshness."],
  ];
  const results = [];
  for (const [path, meaning] of routes) {
    const res = await callApi(path, { persona });
    results.push({ path, status: String(res.status), meaning, text: res.text });
  }
  const byPath = Object.fromEntries(results.map((row) => [row.path, row]));
  const readyJson = jsonBody(byPath["/v1/ready"].text);
  const healthJson = jsonBody(byPath["/v1/health"].text);
  const aiJson = jsonBody(byPath["/v1/ai/status"].text);
  const prefsJson = jsonBody(byPath["/v1/ux/prefs"].text);
  const me = jsonBody((await callApi("/v1/me", { persona })).text);
  const role = me.principal?.roleIds?.[0] ?? me.persona ?? "";
  const roleLabel = {
    consultant: "Consultant",
    ceo: "CEO",
    head_bid: "Head of bid",
    acme_lead: "Account lead",
    reviewer: "Reviewer",
    platform_admin: "Platform admin",
    auditor: "Auditor",
  }[role] ?? "Local session";
  const auditBody = jsonBody(byPath["/v1/admin/audit?principal=u_consultant"].text);
  return {
    roleLabel,
    principalId: me.principal?.id ?? "unknown",
    tenantId: me.tenantId ?? "unknown",
    persona: me.persona ?? "none",
    ready: {
      kind: readyJson.ready === true ? "ok" : "bad",
      label: readyJson.ready === true ? "Reachable" : "Not ready",
      detail: readyJson.ready === true ? "The local Durable Object and storage answered." : "The local worker is not ready.",
      technical: `do=${readyJson.checks?.do ?? "unknown"} r2=${readyJson.checks?.r2 ?? "unknown"}`,
    },
    health: {
      kind: healthJson.ok === true ? "ok" : "unknown",
      label: healthJson.ok === true ? "Dev" : "Unavailable",
      detail: "The worker answered. This is not an uptime percentage.",
    },
    ai: {
      kind: aiJson.state === "ready" ? "ok" : "unknown",
      label: aiJson.state === "disabled" ? "Disabled" : aiJson.state === "not_configured" ? "Not configured" : aiJson.state === "ready" ? "Ready" : "Unavailable",
      detail: aiJson.reason ?? "No model is configured in this local worker.",
    },
    agentRows: agentRows(byPath["/v1/agents"]),
    audit: {
      kind: byPath["/v1/admin/audit?principal=u_consultant"].status === "200" ? "ok" : "bad",
      label: byPath["/v1/admin/audit?principal=u_consultant"].status === "403" ? "Not permitted" : byPath["/v1/admin/audit?principal=u_consultant"].status,
      detail: auditBody.reason ?? "The recovered audit route did not return a log.",
      raw: byPath["/v1/admin/audit?principal=u_consultant"].text.slice(0, 400),
    },
    lang: prefsJson.lang ?? "",
    prefMessage,
    routes: results.map(({ path, status, meaning }) => ({ path, status, meaning })),
  };
}

async function genuiState(session) {
  const persona = PRESETS[session.preset];
  const me = jsonBody((await callApi("/v1/me", { persona })).text);
  const nav = jsonBody((await callApi("/v1/brains/nav", { persona })).text);
  const personal = (nav.items ?? []).find((item) => item.type === "personal");
  const nodeId = `pb:${me.principal.id}`;
  const planCall =
    session.scope === "company"
      ? await callApi("/v1/genui/plan", { method: "POST", persona, body: JSON.stringify({ prompt: "accounts" }) })
      : await callApi("/v1/genui/plan", { method: "POST", persona, body: JSON.stringify({ nodeId }) });
  let planHtml = `<p class="error">Recovered /v1/genui/plan returned ${planCall.status}.</p>`;
  if (planCall.status === 200) {
    const plan = jsonBody(planCall.text);
    const ids = [];
    for (const component of plan.components ?? []) {
      for (const key of ["nodeId", "accountId", "governanceId", "focusId"]) {
        if (typeof component.props?.[key] === "string") ids.push(component.props[key]);
      }
    }
    const shown = session.boundary.show(
      {
        environment: "dev",
        tenantId: me.tenantId,
        principalId: me.principal.id,
        sessionTenantId: me.tenantId,
        scope: session.scope,
        persona: me.persona,
        admittedNodeIds: ids,
      },
      plan,
    );
    planHtml = `<iframe sandbox title="Validated plan" style="width:100%;min-height:280px;border:0;background:#fff" srcdoc="${esc(shown.html)}"></iframe>`;
  } else {
    session.boundary.show(
      {
        environment: "dev",
        tenantId: me.tenantId,
        principalId: me.principal.id,
        sessionTenantId: me.tenantId,
        scope: session.scope,
        persona: me.persona,
        admittedNodeIds: [],
      },
      { components: [] },
    );
  }
  return {
    who: `${me.principal.id} · ${me.tenantId} · ${me.persona}`,
    personal: personal ? `${personal.name} (${personal.id})` : "none returned",
    planHtml,
  };
}

function withSettingsLink(html) {
  const script = `<script>
(function () {
  var href = "/settings/observability";
  function mount() {
    var list = document.querySelector("nav.setnav ul");
    if (!list || list.querySelector("[data-reconstruction='observability']")) return;
    var item = document.createElement("li");
    var link = document.createElement("a");
    link.href = href;
    link.textContent = "Observability";
    link.setAttribute("data-reconstruction", "observability");
    item.appendChild(link);
    list.appendChild(item);
  }
  if (!document.body) return;
  new MutationObserver(mount).observe(document.body, { childList: true, subtree: true });
  mount();
})();
</script>`;
  return html.replace("</body>", `${script}</body>`);
}

function send(res, status, type, body, cookie) {
  const headers = {
    "content-type": type,
    "cache-control": "no-store",
    "x-secondary-fixture": "reconstruction",
  };
  if (cookie) headers["set-cookie"] = cookie;
  res.writeHead(status, headers);
  res.end(body);
}

export function listen(port = 0) {
  const server = createServer(async (req, res) => {
    const host = req.headers.host ?? "";
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
      send(res, 403, "text/plain; charset=utf-8", "local fixture only\n");
      return;
    }
    try {
    await startRecoveredApi();
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const session = sessionOf(req.headers.cookie);
    const cookie = session.fresh ? `fixture=${encodeURIComponent(session.id)}; HttpOnly; Path=/; SameSite=Lax` : undefined;
    const persona = PRESETS[session.preset];
    if (req.method === "POST" && url.pathname === "/reconstruction/session") {
      const fields = form(await readBody(req));
      const preset = fields.get("preset");
      const scope = fields.get("scope");
      const current = sessions.get(session.id);
      if (preset === "person_a" || preset === "person_b") current.preset = preset;
      if (scope === "personal" || scope === "company") current.scope = scope;
      res.writeHead(303, { location: "/reconstruction/genui", "set-cookie": `fixture=${encodeURIComponent(session.id)}; HttpOnly; Path=/; SameSite=Lax` });
      res.end();
      return;
    }
    if (req.method === "POST" && url.pathname === "/reconstruction/genui/reject") {
      const fields = form(await readBody(req));
      const me = jsonBody((await callApi("/v1/me", { persona })).text);
      const result = session.boundary.show(
        {
          environment: "dev",
          tenantId: me.tenantId,
          principalId: me.principal.id,
          sessionTenantId: me.tenantId,
          scope: session.scope,
          persona: me.persona,
          admittedNodeIds: [],
        },
        {
          version: 1,
          title: fields.get("title") ?? "",
          components: [{ type: "NodeCard", props: { nodeId: "a_acme", html: "<script>alert(1)</script>" } }],
        },
      );
      send(res, 403, "text/html; charset=utf-8", result.html, cookie);
      return;
    }
    if (req.method === "POST" && (url.pathname === "/reconstruction/observability/prefs" || url.pathname === "/settings/observability/prefs")) {
      const fields = form(await readBody(req));
      const lang = fields.get("lang");
      const saved = await callApi("/v1/ux/prefs", {
        method: "PUT",
        persona,
        body: JSON.stringify({ lang: lang === "" ? null : lang }),
      });
      const savedBody = jsonBody(saved.text);
      const message = saved.status === 200
        ? "Saved through /v1/ux/prefs."
        : `Save failed (${saved.status}${savedBody.error ? `, ${savedBody.error}` : ""}). Nothing else was changed.`;
      const html = renderObservability(await observabilityModel(persona, message));
      send(res, 200, "text/html; charset=utf-8", html, cookie);
      return;
    }
    if (url.pathname === "/reconstruction/genui") {
      send(res, 200, "text/html; charset=utf-8", renderGenui(await genuiState(session)), cookie);
      return;
    }
    if (url.pathname === "/reconstruction/observability" || url.pathname === "/settings/observability") {
      send(res, 200, "text/html; charset=utf-8", renderObservability(await observabilityModel(persona, "")), cookie);
      return;
    }
    if (url.pathname === "/settings" || (url.pathname.startsWith("/settings/") && !url.pathname.startsWith("/settings/observability"))) {
      const shell = fixtureResponse(new URL("http://127.0.0.1/"));
      send(res, shell.status, shell.type, withSettingsLink(shell.body.toString("utf8")), cookie);
      return;
    }
    if (url.pathname.startsWith("/v1/")) {
      const api = await callApi(`${url.pathname}${url.search}`, {
        method: req.method,
        persona,
        body: req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req),
      });
      send(res, api.status, api.type, api.text, cookie);
      return;
    }
    const out = fixtureResponse(url);
    let body = out.body;
    if ((url.pathname === "/" || url.pathname === "/index.html") && out.status === 200) {
      body = withSettingsLink(body.toString("utf8"));
    }
    send(res, out.status, out.type, body, cookie);
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed";
      send(res, 500, "text/plain; charset=utf-8", `reconstruction error\n${message}\n`);
    }
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, port: typeof address === "object" && address ? address.port : port });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const started = await listen(43131);
  console.log(`http://127.0.0.1:${started.port}`);
}
