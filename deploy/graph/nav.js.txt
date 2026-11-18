(() => {
  "use strict";
  const ID = "sb-graph-link";
  const SVG_NS = "http://www.w3.org/2000/svg";

  function svg(shapes) {
    const root = document.createElementNS(SVG_NS, "svg");
    root.setAttribute("viewBox", "0 0 16 16");
    root.setAttribute("aria-hidden", "true");
    for (const [tag, attrs] of shapes) {
      const el = document.createElementNS(SVG_NS, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
      root.append(el);
    }
    return root;
  }

  const GRAPH = [
    ["line", { x1: 4, y1: 4, x2: 12, y2: 6, stroke: "#db64ff", "stroke-width": 1.3 }],
    ["line", { x1: 4, y1: 4, x2: 6, y2: 12, stroke: "#db64ff", "stroke-width": 1.3 }],
    ["line", { x1: 12, y1: 6, x2: 6, y2: 12, stroke: "#db64ff", "stroke-width": 1.3 }],
    ["circle", { cx: 4, cy: 4, r: 2.2, fill: "#f8f6f9" }],
    ["circle", { cx: 12, cy: 6, r: 2.6, fill: "#f8f6f9" }],
    ["circle", { cx: 6, cy: 12, r: 1.9, fill: "#f8f6f9" }],
  ];
  const DASH = [
    ["rect", { x: 2, y: 2, width: 5, height: 7, rx: 1.2, fill: "#f8f6f9" }],
    ["rect", { x: 9, y: 2, width: 5, height: 4, rx: 1.2, fill: "#db64ff" }],
    ["rect", { x: 9, y: 8, width: 5, height: 6, rx: 1.2, fill: "#f8f6f9" }],
    ["rect", { x: 2, y: 11, width: 5, height: 3, rx: 1.2, fill: "#db64ff" }],
  ];

  function link(href, label, title, shapes) {
    const a = document.createElement("a");
    a.className = "sb-graph-link";
    a.href = href;
    a.title = title;
    a.append(svg(shapes), document.createTextNode(label));
    return a;
  }

  function mount() {
    if (document.getElementById(ID)) return;
    const box = document.createElement("nav");
    box.id = ID;
    box.className = "sb-graph-dock";
    box.setAttribute("aria-label", "Second Brain views");
    box.append(
      link("/dashboard", "Dashboard", "A dashboard shaped by what your second brain is about", DASH),
      link("/graph", "Graph view", "See your second brain as a graph of linked pages", GRAPH),
    );
    document.body.append(box);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
