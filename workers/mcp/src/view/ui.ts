// The MCP App resource `ui://secondary/view`: one self-contained HTML document, no external
// script, style, font or network. It renders the 8 catalog components from the resolved data that
// render_view returns in structuredContent.view. All strings reach the DOM through textContent,
// never innerHTML. Carlito is used when the host machine has it, then Calibri and system fonts
// (embedding a font would add ~700 KB and the sandbox CSP blocks remote fonts).

export const VIEW_URI = "ui://secondary/view";
/** MCP Apps protocol version the inline handshake speaks (ext-apps LATEST_PROTOCOL_VERSION). */
export const MCP_APPS_PROTOCOL_VERSION = "2026-01-26";

export const VIEW_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";

const CSS = `
:root{color-scheme:light dark;--purple:#6600AE;--yellow:#F8F060;--bg:#ffffff;--card:#faf8fd;--ink:#1b1230;--muted:#5d5470;--line:#e4dcef;--warn:#fff7d6;--ok:#e6f6ea;--info:#f0e8fa}
@media (prefers-color-scheme:dark){:root{--bg:#14091f;--card:#1e1230;--ink:#f3edfa;--muted:#b9acd0;--line:#3a2a55;--warn:#3b3410;--ok:#10301a;--info:#2a1b42;--purple:#c58cf5}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:Carlito,Calibri,"Segoe UI",Helvetica,Arial,sans-serif;font-size:15px;line-height:1.4}
.bar{display:flex;align-items:center;gap:12px;background:#6600AE;color:#fff;padding:10px 16px}
.wm{font-size:22px;font-weight:700;letter-spacing:-.02em;text-transform:lowercase}
.wm i{display:inline-block;width:.34em;height:.34em;border-radius:50%;background:var(--yellow);margin-left:.08em}
.bar h1{font-size:17px;margin:0;font-weight:700;overflow-wrap:anywhere}
main{padding:14px 16px;display:grid;gap:12px}
.c{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px;min-width:0}
.c h2{font-size:15px;margin:0 0 8px;color:var(--purple)}
.muted{color:var(--muted)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:8px}
.kpi{background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:8px 10px}
.kpi b{display:block;font-size:24px;line-height:1.1}
.kpi span{font-size:13px;color:var(--muted)}
ul.l{margin:0;padding:0;list-style:none}
ul.l li{padding:7px 0;border-top:1px solid var(--line)}
ul.l li:first-child{border-top:0}
.tag{display:inline-block;font-size:12px;border:1px solid var(--line);border-radius:999px;padding:0 8px;margin-right:4px;color:var(--muted)}
.tag.y{background:var(--yellow);color:#3b2a00;border-color:var(--yellow)}
.co{border-radius:10px;padding:10px 12px;border-left:5px solid var(--purple)}
.co.warning{background:var(--warn);border-left-color:var(--yellow)}
.co.success{background:var(--ok)}
.co.info{background:var(--info)}
table{border-collapse:collapse;width:100%;font-size:14px}
th,td{text-align:left;padding:5px 8px;border-top:1px solid var(--line);overflow-wrap:anywhere}
th{color:var(--muted);font-weight:700;border-top:0}
td.n,th.n{text-align:right}
.stage{display:flex;gap:6px;flex-wrap:wrap;margin-top:4px}
.stage span{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:2px 8px;font-size:13px}
svg{width:100%;max-width:420px;height:auto;display:block;margin:0 auto}
svg text{fill:var(--ink);font:12px Carlito,Calibri,sans-serif}
svg .hub{fill:var(--card);stroke:var(--purple);stroke-width:1.5}
svg .hub.locked{stroke-dasharray:4 3;stroke:var(--muted)}
svg .core{fill:#6600AE}
svg .core+text{fill:#fff}
svg line{stroke:var(--line);stroke-width:1.2}
.empty{padding:28px 16px;text-align:center}
`;

const JS = `
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var root = document.getElementById("root");
  var titleEl = document.getElementById("title");
  var nextId = 1, pending = {};

  function post(msg) { window.parent.postMessage(msg, "*"); }
  function request(method, params) {
    return new Promise(function (resolve) {
      var id = nextId++; pending[id] = resolve;
      post({ jsonrpc: "2.0", id: id, method: method, params: params });
    });
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }
  function add(parent) { for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]); return parent; }
  function val(v) { return v === null || v === undefined ? "-" : String(v); }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function card(title) { var c = el("section", "c"); if (title) c.appendChild(el("h2", "", title)); return c; }

  var STATUS = { denied: "Not available to you (no access).", missing: "Not found.", error: "Could not be loaded." };

  var R = {
    Callout: function (d) { var c = el("div", "c co " + (d.tone || "info"), d.message); return c; },
    KpiRow: function (d) {
      var c = card(d.label);
      if (d.locked) return add(c, el("p", "muted", "Locked."));
      var g = el("div", "kpis");
      arr(d.metrics).forEach(function (m) { add(g, add(el("div", "kpi"), el("b", "", val(m.value)), el("span", "", m.label))); });
      return add(c, g);
    },
    NodeCard: function (d) {
      var c = card(d.label);
      var meta = el("p", "muted", [d.kind, d.plane, "access " + val(d.access)].filter(Boolean).join(" / "));
      add(c, meta);
      var badges = el("p");
      arr(d.badges).forEach(function (b) { badges.appendChild(el("span", "tag y", b)); });
      var s = d.signals || {};
      if (s.open) badges.appendChild(el("span", "tag", "open"));
      if (s.gap) badges.appendChild(el("span", "tag", "gap"));
      if (s.star) badges.appendChild(el("span", "tag", "star"));
      add(c, badges);
      if (d.counts) {
        var g = el("div", "kpis");
        ["items", "topics", "open", "gaps", "stars"].forEach(function (k) {
          if (d.counts[k] !== undefined) add(g, add(el("div", "kpi"), el("b", "", val(d.counts[k])), el("span", "", k)));
        });
        add(c, g);
      } else add(c, el("p", "muted", "Locked: structure only."));
      if (d.freshnessDays !== null && d.freshnessDays !== undefined) add(c, el("p", "muted", "Reviewed " + d.freshnessDays + " days ago"));
      return c;
    },
    ItemList: function (d) {
      var c = card(val(d.label) + ": items");
      var items = arr(d.items);
      if (!items.length) return add(c, el("p", "muted", "No items."));
      var ul = el("ul", "l");
      items.forEach(function (i) {
        var li = el("li");
        add(li, el("div", "", i.title));
        var m = el("div", "muted");
        m.textContent = ["rev " + val(i.revision), i.evidence, i.source, i.ownerRole].filter(Boolean).join(" / ");
        add(li, m);
        if (i.reviewedBy2) add(li, el("span", "tag y", "two-person reviewed"));
        ul.appendChild(li);
      });
      return add(c, ul);
    },
    AccountSummary: function (d) {
      var c = card(d.label);
      var secs = arr(d.sections);
      if (!secs.length) return add(c, el("p", "muted", "No sections."));
      var ul = el("ul", "l");
      secs.forEach(function (s) {
        var li = el("li");
        add(li, el("b", "", s.label + (s.count ? " (" + s.count + ")" : "")));
        arr(s.lines).forEach(function (t) { if (t) add(li, el("div", "muted", t)); });
        ul.appendChild(li);
      });
      return add(c, ul);
    },
    StageBoard: function (d) {
      var c = card("Stages");
      var gs = arr(d.governances);
      if (!gs.length) return add(c, el("p", "muted", "No governances."));
      gs.forEach(function (g) {
        var row = add(el("div"), el("b", "", g.label));
        var st = el("div", "stage");
        arr(g.stages).forEach(function (s) { st.appendChild(el("span", "", s.stage + ": " + s.count)); });
        add(row, st); c.appendChild(row);
        row.style.marginBottom = "8px";
      });
      return c;
    },
    MapMini: function (d) {
      var c = card("Map: " + val(d.lens));
      var hubs = arr(d.hubs);
      if (!hubs.length) return add(c, el("p", "muted", "Nothing visible."));
      var W = 360, H = 260, cx = W / 2, cy = H / 2, r = 95;
      var svg = document.createElementNS(NS, "svg");
      svg.setAttribute("viewBox", "0 0 " + W + " " + H);
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", "Map of " + hubs.length + " groups");
      function node(cls, x, y, rad, label) {
        var cir = document.createElementNS(NS, "circle");
        cir.setAttribute("class", cls); cir.setAttribute("cx", x); cir.setAttribute("cy", y); cir.setAttribute("r", rad);
        var t = document.createElementNS(NS, "text");
        t.setAttribute("x", x); t.setAttribute("y", y + 4); t.setAttribute("text-anchor", "middle");
        t.textContent = label.length > 12 ? label.slice(0, 11) + "." : label;
        return [cir, t];
      }
      hubs.forEach(function (h, i) {
        var a = (2 * Math.PI * i) / hubs.length - Math.PI / 2;
        var x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
        var ln = document.createElementNS(NS, "line");
        ln.setAttribute("x1", cx); ln.setAttribute("y1", cy); ln.setAttribute("x2", x); ln.setAttribute("y2", y);
        svg.appendChild(ln);
        node("hub" + (h.access === "locked" ? " locked" : ""), x, y, 26, val(h.label)).forEach(function (n) { svg.appendChild(n); });
      });
      node("core", cx, cy, 30, val(d.core && d.core.label)).forEach(function (n) { svg.appendChild(n); });
      c.appendChild(svg);
      var ul = el("ul", "l");
      hubs.forEach(function (h) {
        var li = el("li", "", h.label);
        li.appendChild(el("span", "tag", h.access));
        ul.appendChild(li);
      });
      return add(c, ul);
    },
    Table: function (d) {
      var c = card();
      var cols = arr(d.columns), rows = arr(d.rows);
      if (!rows.length) return add(c, el("p", "muted", "No rows."));
      var t = el("table"), thead = el("thead"), hr = el("tr");
      cols.forEach(function (k) { hr.appendChild(el("th", k === "label" || k === "kind" ? "" : "n", k)); });
      thead.appendChild(hr); t.appendChild(thead);
      var tb = el("tbody");
      rows.forEach(function (r) {
        var tr = el("tr");
        cols.forEach(function (k) { tr.appendChild(el("td", k === "label" || k === "kind" ? "" : "n", r.locked && k !== "label" && k !== "kind" ? "locked" : val(r[k]))); });
        tb.appendChild(tr);
      });
      t.appendChild(tb);
      return add(c, t);
    }
  };

  function renderComponent(c) {
    if (c.status !== "ok" || !c.data) {
      return add(card(c.type), el("p", "muted", STATUS[c.status] || ""));
    }
    var fn = R[c.type];
    return fn ? fn(c.data) : null;
  }

  function render(result) {
    var view = result && result.structuredContent && result.structuredContent.view;
    root.textContent = "";
    if (!view || !Array.isArray(view.components)) {
      root.appendChild(el("div", "c empty muted", result && result.isError ? "The view could not be built." : "Waiting for data."));
    } else {
      titleEl.textContent = view.title || "Secondary";
      view.components.forEach(function (c) { var n = renderComponent(c); if (n) root.appendChild(n); });
    }
    post({ jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { height: Math.ceil(document.documentElement.scrollHeight) } });
  }

  window.addEventListener("message", function (ev) {
    if (ev.source !== window.parent) return;
    var m = ev.data;
    if (!m || m.jsonrpc !== "2.0") return;
    if (m.id !== undefined && m.method === undefined) {
      var cb = pending[m.id]; if (cb) { delete pending[m.id]; cb(m.result); }
      return;
    }
    if (m.method === "ui/notifications/tool-result") render(m.params);
    else if (m.method === "ui/resource-teardown" && m.id !== undefined) post({ jsonrpc: "2.0", id: m.id, result: {} });
  });

  request("ui/initialize", {
    appInfo: { name: "secondary-view", version: "0.1.0" },
    appCapabilities: {},
    protocolVersion: "__PROTOCOL__"
  }).then(function () { post({ jsonrpc: "2.0", method: "ui/notifications/initialized" }); });
})();
`;

export const VIEW_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${VIEW_CSP}">
<title>Secondary view</title><style>${CSS}</style></head>
<body><div class="bar"><span class="wm">mantu<i></i></span><h1 id="title">Secondary</h1></div>
<main id="root"><div class="c empty muted">Waiting for data.</div></main>
<script>${JS.replace("__PROTOCOL__", MCP_APPS_PROTOCOL_VERSION)}</script></body></html>`;
