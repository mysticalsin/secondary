(() => {
  "use strict";
  const ID = "sb-graph-link";
  const SVG_NS = "http://www.w3.org/2000/svg";

  function icon() {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    const lines = [[4, 4, 12, 6], [4, 4, 6, 12], [12, 6, 6, 12]];
    for (const [x1, y1, x2, y2] of lines) {
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", String(x1));
      line.setAttribute("y1", String(y1));
      line.setAttribute("x2", String(x2));
      line.setAttribute("y2", String(y2));
      line.setAttribute("stroke", "#db64ff");
      line.setAttribute("stroke-width", "1.3");
      svg.append(line);
    }
    for (const [cx, cy, r] of [[4, 4, 2.2], [12, 6, 2.6], [6, 12, 1.9]]) {
      const c = document.createElementNS(SVG_NS, "circle");
      c.setAttribute("cx", String(cx));
      c.setAttribute("cy", String(cy));
      c.setAttribute("r", String(r));
      c.setAttribute("fill", "#f8f6f9");
      svg.append(c);
    }
    return svg;
  }

  function mount() {
    if (document.getElementById(ID)) return;
    const a = document.createElement("a");
    a.id = ID;
    a.className = "sb-graph-link";
    a.href = "/graph";
    a.title = "See your second brain as a graph of linked pages";
    a.append(icon(), document.createTextNode("Graph view"));
    document.body.append(a);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
