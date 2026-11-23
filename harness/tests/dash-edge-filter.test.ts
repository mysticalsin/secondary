/**
 * SB-DASH-EDGE-FILTER-FOLLOWUP
 * Account links, mention counts, and the Risks card stay inside the open brain.
 * One picker text is shared. A brain change clears the graph selection.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { runGraphScript } from "./run-graph-script.ts";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const dashboardSource = readFileSync(fileURLToPath(new URL("../../deploy/graph/dashboard.js.txt", import.meta.url)), "utf8");
const appSource = readFileSync(fileURLToPath(new URL("../../deploy/graph/app.js.txt", import.meta.url)), "utf8");

function fnBody(source: string, name: string): string {
  const at = source.indexOf(`function ${name}(`);
  if (at < 0) return "";
  const next = source.indexOf("\n  function ", at + 1);
  return source.slice(at, next < 0 ? source.length : next);
}

const PRELUDE = `
class Node { constructor() { this.childNodes = []; } append(...xs) { this.childNodes.push(...xs); } }
class Element extends Node {
  constructor(id) {
    super();
    this.id = id || "";
    this.style = {};
    this.dataset = {};
    this.className = "";
    this.hidden = false;
    this.value = "";
    this.textContent = "";
    this.type = "";
    this.checked = false;
    this.listeners = {};
  }
  setAttribute(name, value) { this[name] = value; }
  getAttribute(name) { return this[name]; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  removeEventListener() {}
  replaceChildren(...xs) { this.childNodes = xs.flat(); }
  append(...xs) { this.childNodes.push(...xs); }
  querySelector() { return new Element("hit"); }
  querySelectorAll() { return []; }
  focus() {}
  click() { const fn = this.listeners.click; if (fn) fn(); }
  getBoundingClientRect() { return { width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600 }; }
  getContext() { return new Proxy({}, { get: () => () => {}, set: () => true }); }
}
class Option extends Element {
  constructor(text, value) {
    super("option");
    this.text = text == null ? "" : String(text);
    this.textContent = this.text;
    this.value = value == null ? "" : String(value);
  }
}
const elements = {};
function element(id) { if (!elements[id]) elements[id] = new Element(id); return elements[id]; }
const document = {
  documentElement: new Element("html"),
  activeElement: null,
  createElement: () => new Element(""),
  createElementNS: () => new Element(""),
  querySelector: (sel) => element(String(sel).replace(/^#/, "")),
  addEventListener() {},
  removeEventListener() {},
};
document.documentElement.dataset = { api: "" };
const window = {
  devicePixelRatio: 1,
  location: { hash: "", href: "http://127.0.0.1/dashboard" },
  addEventListener() {},
  removeEventListener() {},
};
globalThis.Node = Node;
globalThis.Element = Element;
globalThis.Option = Option;
globalThis.document = document;
globalThis.window = window;
globalThis.requestAnimationFrame = () => 0;
globalThis.__elements = elements;
`;

type El = {
  value: string;
  textContent?: string;
  hidden?: boolean;
  childNodes?: unknown[];
  listeners?: Record<string, (event?: unknown) => void>;
};

const BRAINS = {
  brains: [
    { id: "c_delivery", name: "Delivery", pages: 4 },
    { id: "c_eng", name: "Engineering", pages: 1 },
  ],
};

const TREE = {
  roots: [
    {
      id: "c_delivery",
      label: "Delivery",
      access: "full",
      children: [
        { id: "c_delivery#Account", label: "Account", children: [{ id: "c_delivery/acme", label: "Acme" }] },
        { id: "c_delivery#People", label: "People", children: [{ id: "c_delivery/ada", label: "Ada Lovelace" }] },
        { id: "c_delivery#Risk", label: "Risk", children: [{ id: "c_delivery/churn", label: "Churn risk" }] },
        { id: "c_delivery#Notes", label: "Notes", children: [{ id: "c_delivery/note", label: "Weekly note" }] },
      ],
    },
    {
      id: "c_eng",
      label: "Engineering",
      access: "full",
      children: [{ id: "c_eng#Pages", label: "Pages", children: [{ id: "c_eng/rfc", label: "RFC" }] }],
    },
  ],
};

const PAGES: Record<string, { markdown: string; links: { id: string; title: string }[] }> = {
  "c_delivery/acme": {
    markdown: "Acme is in negotiation.\n",
    links: [
      { id: "churn", title: "Churn risk" },
      { id: "ada", title: "Ada Lovelace" },
      { id: "global:rfc", title: "RFC" },
    ],
  },
  "c_delivery/ada": {
    markdown: "Ada Lovelace leads the account.\n",
    links: [],
  },
  "c_delivery/churn": {
    markdown: "Churn risk is high.\n",
    links: [{ id: "global:rfc", title: "RFC" }],
  },
  "c_delivery/note": {
    markdown: "Ada Lovelace did excellent work.\n",
    links: [
      { id: "ada", title: "Ada Lovelace" },
      { id: "global:rfc", title: "RFC" },
    ],
  },
  "c_eng/rfc": {
    markdown: "Ada Lovelace reviewed the RFC in the other brain.\n",
    links: [{ id: "global:ada", title: "Ada Lovelace" }],
  },
};

function textsOf(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node !== "object") return out;
  const item = node as { textContent?: string; childNodes?: unknown[] };
  if (typeof item.textContent === "string" && item.textContent) out.push(item.textContent);
  for (const child of item.childNodes || []) textsOf(child, out);
  return out;
}

function clickLabel(root: unknown, prefix: string): boolean {
  const nodes: El[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const item = node as El;
    nodes.push(item);
    for (const child of item.childNodes || []) walk(child);
  };
  walk(root);
  const hit = nodes.find((item) => (item.textContent || "").startsWith(prefix));
  const click = hit?.listeners?.click;
  if (!click) return false;
  click();
  return true;
}

async function boot(file: string, brains: unknown, tree: unknown, pages: Record<string, { markdown: string; links: { id: string; title: string }[] }>): Promise<Record<string, El>> {
  const urls: string[] = [];
  const sandbox: Record<string, unknown> = {
    console,
    URL,
    Response,
    Headers,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    TextEncoder,
    Math,
    Date,
    JSON,
    Object,
    Array,
    Map,
    Set,
    WeakMap,
    Promise,
    Number,
    String,
    Boolean,
    RegExp,
    Error,
    TypeError,
    Symbol,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    fetch: async (input: string | URL) => {
      const url = new URL(String(input), "http://127.0.0.1");
      urls.push(url.pathname);
      if (url.pathname === "/v1/brains") return Response.json(brains);
      if (url.pathname === "/v1/brain/tree") return Response.json(tree);
      const match = url.pathname.match(/^\/v1\/wiki\/([^/]+)\/pages\/([^/]+)$/);
      if (match) {
        const id = `${decodeURIComponent(match[1])}/${decodeURIComponent(match[2])}`;
        const page = pages[id];
        if (page) {
          return Response.json({
            markdown: page.markdown,
            summary: id,
            links: page.links,
            updatedAt: "2026-06-15T12:00:00.000Z",
            type: "note",
            fields: [],
          });
        }
      }
      return new Response("no", { status: 404, headers: { "content-type": "text/plain" } });
    },
  };
  const context = createContext(sandbox);
  runInContext(PRELUDE, context);
  runGraphScript(repo, file, context);
  const elements = sandbox.__elements as Record<string, El>;
  const selectId = file.endsWith("dashboard.js.txt") ? "brain" : "workspace";
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    const wiki = urls.filter((path) => path.includes("/pages/")).length;
    if ((elements[selectId]?.childNodes || []).length > 0 && wiki >= Object.keys(pages).length) break;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  await new Promise((resolve) => setTimeout(resolve, 40));
  return elements;
}

test("SB-DASH-EDGE-FILTER-FOLLOWUP account links, mentions, and risks stay inside the brain", async () => {
  const view = await boot("deploy/graph/dashboard.js.txt", BRAINS, TREE, PAGES);
  const analyze = fnBody(dashboardSource, "analyze");
  const delivery = fnBody(dashboardSource, "deliverySection");
  assert.match(analyze, /sameBrainEdges\(p, pageSet\)\.out\.includes\(person\)/);
  assert.match(analyze, /mentions: about\.length \+ sameBrainEdges\(person, pageSet\)\.in\.length/);
  assert.match(analyze, /const accountEdges = sameBrainEdges\(p, pageSet\)/);
  assert.match(delivery, /const riskEdges = sameBrainEdges\(r, m\.pages\)/);

  assert.equal(clickLabel(view.main, "Business"), true);
  const business = textsOf(view.main);
  const acme = business.indexOf("Acme");
  assert.equal(business[acme + 1], "Negotiation");
  assert.equal(business[acme + 2], "2", business.slice(acme, acme + 6).join(" | "));
  assert.equal(business.includes("RFC"), false, business.filter((text) => text.includes("RFC")).join(" | "));

  assert.equal(clickLabel(view.main, "Consulting"), true);
  const people = textsOf(view.main);
  const mentioned = people.indexOf("Most mentioned");
  const ada = people.indexOf("Ada Lovelace", mentioned);
  assert.equal(people[ada + 1], "3", people.slice(mentioned, ada + 3).join(" | "));

  assert.equal(clickLabel(view.main, "Projects"), true);
  const risks = textsOf(view.main);
  assert.equal(risks.includes("RFC"), false, risks.filter((text) => text.includes("RFC")).join(" | "));
  assert.equal(risks.includes("Churn risk"), true);
});

test("SB-DASH-EDGE-FILTER-FOLLOWUP one brain picker is shared and a brain change clears the selection", async () => {
  const picker = fnBody(appSource, "fillBrainPicker");
  assert.ok(picker.includes("instanceof Option"));
  assert.equal(picker, fnBody(dashboardSource, "fillBrainPicker"));
  assert.equal(appSource.includes("function fillBrainSelect"), false);
  assert.equal(dashboardSource.includes("function fillBrainSelect"), false);

  const view = await boot(
    "deploy/graph/app.js.txt",
    {
      brains: [
        { id: "me", name: "My Secondary", pages: 1 },
        { id: "c_eng", name: "Engineering", pages: 1 },
      ],
    },
    {
      roots: [
        {
          id: "me",
          label: "My Secondary",
          access: "full",
          children: [{ id: "me#Notes", label: "Notes", children: [{ id: "me/alpha", label: "Alpha" }] }],
        },
        {
          id: "c_eng",
          label: "Engineering",
          access: "full",
          children: [{ id: "c_eng#Pages", label: "Pages", children: [{ id: "c_eng/rfc", label: "RFC" }] }],
        },
      ],
    },
    {
      "me/alpha": { markdown: "Alpha page.\n", links: [] },
      "c_eng/rfc": { markdown: "RFC page.\n", links: [] },
    },
  );
  const press = view.graph?.listeners?.keydown;
  assert.equal(typeof press, "function");
  press?.({ key: "ArrowRight", preventDefault() {}, altKey: false, ctrlKey: false, metaKey: false });
  assert.equal(view.panel?.hidden, false);
  assert.ok(view["panel-title"]?.textContent);
  view.workspace.value = "c_eng";
  view.workspace.listeners?.change?.();
  assert.equal(view.panel?.hidden, true);
});
