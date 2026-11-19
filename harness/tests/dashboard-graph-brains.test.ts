import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { runGraphScript } from "./run-graph-script.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));

type Card = { id: string; name: string; pages: number };
type Page = { id: string; label: string };

const PRELUDE = `
class Node {
  constructor() { this.childNodes = []; }
  append(...xs) { this.childNodes.push(...xs); }
}
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
  }
  setAttribute(name, value) { this[name] = value; }
  getAttribute(name) { return this[name]; }
  addEventListener(type, fn) { if (!this.listeners) this.listeners = {}; this.listeners[type] = fn; }
  removeEventListener() {}
  replaceChildren(...xs) { this.childNodes = xs.flat(); }
  append(...xs) { this.childNodes.push(...xs); }
  querySelector() { return new Element("hit"); }
  querySelectorAll() { return []; }
  focus() {}
  click() {}
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
function element(id) {
  if (!elements[id]) elements[id] = new Element(id);
  return elements[id];
}
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
  location: { hash: "", href: "http://127.0.0.1/graph" },
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

function treeFor(cards: Card[], pagesById: Record<string, Page[]>, folder = "Notes"): { roots: unknown[] } {
  const source = cards.length ? cards : Object.keys(pagesById).map((id) => ({ id, name: id, pages: (pagesById[id] || []).length }));
  return {
    roots: source.map((card) => ({
      id: card.id,
      label: card.name,
      access: "full",
      count: card.pages,
      children: (pagesById[card.id] || []).length
        ? [{ id: `${card.id}#${folder}`, label: folder, children: pagesById[card.id] }]
        : [],
    })),
  };
}

type WikiLink = { id: string; title?: string; broken?: boolean };

function wiki(page: Page, links: WikiLink[] = []): Record<string, unknown> {
  return {
    markdown: `# ${page.label}\n\nSynthetic page.\n`,
    summary: page.label,
    links,
    updatedAt: "2026-11-01T00:00:00.000Z",
    type: "note",
    fields: [],
  };
}

async function load(file: string, cards: Card[], pagesById: Record<string, Page[]>, extra: { links?: Record<string, WikiLink[]>; settle?: boolean; folder?: string; brainsStatus?: number } = {}): Promise<{
  urls: URL[];
  value: string;
  options: { value: string; text: string }[];
  texts: string[];
  stats: string;
  main?: { textContent?: string; childNodes?: unknown[]; listeners?: Record<string, () => void> };
  drawer?: { textContent?: string; childNodes?: unknown[] };
}> {
  const urls: URL[] = [];
  const tree = treeFor(cards, pagesById, extra.folder);
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
      urls.push(url);
      if (url.pathname === "/v1/brains") {
        if (extra.brainsStatus) return new Response("no", { status: extra.brainsStatus, headers: { "content-type": "text/plain" } });
        return Response.json({ brains: cards });
      }
      if (url.pathname === "/v1/brain/tree") return Response.json(tree);
      const match = url.pathname.match(/^\/v1\/wiki\/([^/]+)\/pages\/([^/]+)$/);
      if (match) {
        const id = `${decodeURIComponent(match[1])}/${decodeURIComponent(match[2])}`;
        const page = Object.values(pagesById).flat().find((item) => item.id === id);
        if (page) return Response.json(wiki(page, extra.links?.[page.id] || []));
      }
      return new Response("no", { status: 404, headers: { "content-type": "text/plain" } });
    },
  };
  const context = createContext(sandbox);
  runInContext(PRELUDE, context);
  runGraphScript(root, file, context);
  const elements = sandbox.__elements as Record<string, { value: string; textContent?: string; childNodes: { value?: string; textContent?: string; childNodes?: unknown[] }[] }>;
  const selectId = file.endsWith("dashboard.js.txt") ? "brain" : "workspace";
  const deadline = Date.now() + (cards.length === 0 ? 50 : 1000);
  while (Date.now() < deadline) {
    const select = elements[selectId];
    if (cards.length === 0 || (select && select.childNodes.length > 0)) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await new Promise((resolve) => setTimeout(resolve, 20));
  if (extra.settle) {
    const end = Date.now() + 500;
    let last = -1;
    while (Date.now() < end) {
      const wikiCount = urls.filter((url) => url.pathname.includes("/pages/")).length;
      if (wikiCount > 0 && urls.length === last) break;
      last = urls.length;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  const select = elements[selectId];
  const view = file.endsWith("dashboard.js.txt") ? elements.main : elements.status;
  return {
    urls,
    value: select?.value ?? "",
    options: (select?.childNodes || []).map((node) => ({ value: String(node.value ?? ""), text: String(node.textContent ?? "") })),
    texts: collect(view),
    stats: String(elements.stats?.textContent || ""),
    main: elements.main,
    drawer: elements.drawer,
  };
}

function collect(node: { textContent?: string; childNodes?: unknown[] } | undefined, out: string[] = []): string[] {
  if (!node || typeof node !== "object") return out;
  if (typeof node.textContent === "string" && node.textContent) out.push(node.textContent);
  for (const child of node.childNodes || []) collect(child as { textContent?: string; childNodes?: unknown[] }, out);
  return out;
}

function expectBrains(result: Awaited<ReturnType<typeof load>>, cards: Card[], selected: string, empty: boolean): string[] {
  const problems: string[] = [];
  const tree = result.urls.filter((url) => url.pathname === "/v1/brain/tree");
  const brains = result.urls.filter((url) => url.pathname === "/v1/brains");
  if (brains.length === 0) problems.push("did not call GET /v1/brains");
  if (tree.length === 0) problems.push("did not call GET /v1/brain/tree");
  if (tree.some((url) => url.search !== "")) problems.push(`tree query was ${tree.map((url) => url.search).join(",")}`);
  const expected = cards.map((card) => ({ value: card.id, text: card.name }));
  if (JSON.stringify(result.options) !== JSON.stringify(expected)) {
    problems.push(`options ${JSON.stringify(result.options)} != ${JSON.stringify(expected)}`);
  }
  if (!result.options.some((option) => option.value === "me" && option.text === "My Secondary")) {
    problems.push("My Secondary is missing");
  }
  if (result.value !== selected) problems.push(`selected ${JSON.stringify(result.value)} != ${JSON.stringify(selected)}`);
  const showsEmpty = result.texts.some((text) => text.includes("Your second brain has no pages yet") || text.includes("No pages yet"));
  if (showsEmpty !== empty) problems.push(`empty state ${showsEmpty} != ${empty} (${result.texts.slice(0, 4).join(" | ")})`);
  return problems;
}

const deliveryPages: Record<string, Page[]> = {
  c_delivery: [
    { id: "c_delivery/kickoff", label: "Kickoff" },
    { id: "c_delivery/retro", label: "Retro" },
  ],
  c_eng: [{ id: "c_eng/rfc", label: "RFC" }],
};

test("dashboard and graph default to the first admitted brain with pages", async () => {
  const cards: Card[] = [
    { id: "me", name: "My Secondary", pages: 0 },
    { id: "c_delivery", name: "Delivery", pages: 2 },
    { id: "c_eng", name: "Engineering", pages: 1 },
  ];
  const dashboard = await load("deploy/graph/dashboard.js.txt", cards, deliveryPages);
  const graph = await load("deploy/graph/app.js.txt", cards, deliveryPages);
  assert.deepEqual([
    ...expectBrains(dashboard, cards, "c_delivery", false).map((problem) => `dashboard: ${problem}`),
    ...expectBrains(graph, cards, "c_delivery", false).map((problem) => `graph: ${problem}`),
  ], []);
});

test("an empty admitted list keeps the honest empty state on My Secondary", async () => {
  const cards: Card[] = [
    { id: "me", name: "My Secondary", pages: 0 },
    { id: "c_delivery", name: "Delivery", pages: 0 },
  ];
  const dashboard = await load("deploy/graph/dashboard.js.txt", cards, {});
  const graph = await load("deploy/graph/app.js.txt", cards, {});
  assert.deepEqual([
    ...expectBrains(dashboard, cards, "me", true).map((problem) => `dashboard: ${problem}`),
    ...expectBrains(graph, cards, "me", true).map((problem) => `graph: ${problem}`),
  ], []);
});

test("My Secondary stays the default when it is the first brain with pages", async () => {
  const cards: Card[] = [
    { id: "me", name: "My Secondary", pages: 1 },
    { id: "c_delivery", name: "Delivery", pages: 0 },
  ];
  const pages = { me: [{ id: "me/note", label: "Personal note" }] };
  const dashboard = await load("deploy/graph/dashboard.js.txt", cards, pages);
  const graph = await load("deploy/graph/app.js.txt", cards, pages);
  assert.deepEqual([
    ...expectBrains(dashboard, cards, "me", false).map((problem) => `dashboard: ${problem}`),
    ...expectBrains(graph, cards, "me", false).map((problem) => `graph: ${problem}`),
  ], []);
});

test("counters stay on the chosen brain", async () => {
  const cards: Card[] = [
    { id: "me", name: "My Secondary", pages: 0 },
    { id: "c_delivery", name: "Delivery", pages: 2 },
    { id: "c_eng", name: "Engineering", pages: 1 },
  ];
  const pages = {
    c_delivery: [
      { id: "c_delivery/kickoff", label: "Kickoff" },
      { id: "c_delivery/retro", label: "Retro" },
    ],
    c_eng: [{ id: "c_eng/rfc", label: "RFC" }],
  };
  const links = {
    "c_delivery/kickoff": [{ id: "global:rfc", title: "RFC" }],
    "c_eng/rfc": [{ id: "missing", title: "Gone", broken: true }],
  };
  const dashboard = await load("deploy/graph/dashboard.js.txt", cards, pages, { links, settle: true });
  const graph = await load("deploy/graph/app.js.txt", cards, pages, { links, settle: true });
  const linkAt = dashboard.texts.indexOf("Links");
  const problems: string[] = [];
  if (dashboard.value !== "c_delivery") problems.push(`dashboard selected ${dashboard.value}`);
  if (dashboard.texts[linkAt + 1] !== "0") problems.push(`dashboard Links ${dashboard.texts[linkAt + 1]}`);
  if (graph.value !== "c_delivery") problems.push(`graph selected ${graph.value}`);
  if (!/^2 notes/.test(graph.stats)) problems.push(`graph stats ${graph.stats}`);
  if (graph.stats.includes("unresolved")) problems.push(`graph unresolved ${graph.stats}`);
  assert.deepEqual(problems, []);
});

function stringsOf(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") {
    out.push(node);
    return out;
  }
  if (!node || typeof node !== "object") return out;
  const item = node as { textContent?: string; childNodes?: unknown[] };
  if (typeof item.textContent === "string" && item.textContent) out.push(item.textContent);
  for (const child of item.childNodes || []) stringsOf(child, out);
  return out;
}

function clickLabeled(root: { childNodes?: unknown[]; listeners?: Record<string, () => void>; textContent?: string } | undefined, label: string): boolean {
  const nodes: { childNodes?: unknown[]; listeners?: Record<string, () => void>; textContent?: string }[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const item = node as { childNodes?: unknown[]; listeners?: Record<string, () => void>; textContent?: string };
    nodes.push(item);
    for (const child of item.childNodes || []) walk(child);
  };
  walk(root);
  const hit = nodes.find((item) => item.textContent === label || (item.childNodes || []).includes(label));
  if (!hit?.listeners?.click) return false;
  hit.listeners.click();
  return true;
}

test("a same-brain link still counts and a cross-brain link does not", async () => {
  const cards: Card[] = [
    { id: "me", name: "My Secondary", pages: 0 },
    { id: "c_delivery", name: "Delivery", pages: 2 },
    { id: "c_eng", name: "Engineering", pages: 1 },
  ];
  const pages = {
    c_delivery: [
      { id: "c_delivery/kickoff", label: "Kickoff" },
      { id: "c_delivery/retro", label: "Retro" },
    ],
    c_eng: [{ id: "c_eng/rfc", label: "RFC" }],
  };
  const links = {
    "c_delivery/kickoff": [{ id: "retro", title: "Retro" }, { id: "global:rfc", title: "RFC" }],
  };
  const dashboard = await load("deploy/graph/dashboard.js.txt", cards, pages, { links, settle: true, folder: "Project" });
  const linkAt = dashboard.texts.indexOf("Links");
  const opened = clickLabeled(dashboard.main, "Kickoff");
  const drawer = stringsOf(dashboard.drawer);
  const problems: string[] = [];
  if (dashboard.texts[linkAt + 1] !== "1") problems.push(`dashboard Links ${dashboard.texts[linkAt + 1]}`);
  if (!dashboard.texts.includes("1 link")) problems.push("missing same-brain tile count");
  if (dashboard.texts.includes("2 links")) problems.push("tile counted the cross-brain edge");
  if (!opened) problems.push("Kickoff drawer did not open");
  if (!drawer.includes("Links to 1")) problems.push(`drawer ${drawer.filter((text) => text.startsWith("Links to")).join(",")}`);
  if (drawer.includes("RFC")) problems.push("drawer listed the other brain");
  if (!drawer.includes("Retro")) problems.push("drawer missed the same-brain page");
  assert.deepEqual(problems, []);
});

test("an empty brain list shows the empty state instead of every page", async () => {
  const pages = {
    me: [{ id: "me/note", label: "Personal note" }],
    c_eng: [{ id: "c_eng/rfc", label: "RFC" }],
  };
  const dashboard = await load("deploy/graph/dashboard.js.txt", [], pages, { settle: true });
  const graph = await load("deploy/graph/app.js.txt", [], pages, { settle: true });
  const problems: string[] = [];
  if (dashboard.options.length !== 0) problems.push(`dashboard options ${JSON.stringify(dashboard.options)}`);
  if (!dashboard.texts.some((text) => text.includes("Your second brain has no pages yet"))) problems.push(`dashboard empty ${dashboard.texts.slice(0, 6).join(" | ")}`);
  if (dashboard.texts.includes("All brains")) problems.push("dashboard labeled All brains");
  if (dashboard.texts.includes("Personal note") || dashboard.texts.includes("RFC")) problems.push("dashboard showed tree pages");
  if (graph.options.some((option) => option.text === "All brains" || option.value === "")) problems.push(`graph options ${JSON.stringify(graph.options)}`);
  if (!/^0 notes/.test(graph.stats)) problems.push(`graph stats ${graph.stats}`);
  if (!graph.texts.includes("No pages yet.")) problems.push(`graph status ${graph.texts.join(" | ")}`);
  assert.deepEqual(problems, []);
});

test("a failed brain list still renders the tree", async () => {
  const cards: Card[] = [
    { id: "c_delivery", name: "Delivery", pages: 2 },
    { id: "c_eng", name: "Engineering", pages: 1 },
  ];
  const pages = {
    c_delivery: [
      { id: "c_delivery/kickoff", label: "Kickoff" },
      { id: "c_delivery/retro", label: "Retro" },
    ],
    c_eng: [{ id: "c_eng/rfc", label: "RFC" }],
  };
  const dashboard = await load("deploy/graph/dashboard.js.txt", cards, pages, { settle: true, brainsStatus: 500 });
  const graph = await load("deploy/graph/app.js.txt", cards, pages, { settle: true, brainsStatus: 500 });
  const shown = stringsOf(dashboard.main);
  const problems: string[] = [];
  if (!shown.includes("Kickoff")) problems.push(`dashboard missed the tree ${shown.slice(0, 8).join(" | ")}`);
  if (dashboard.texts.some((text) => /could not be loaded|sign-in/i.test(text))) problems.push("dashboard treated the brain list as fatal");
  if (dashboard.texts.includes("All brains")) problems.push("dashboard labeled All brains");
  if (graph.value !== "c_delivery") problems.push(`graph selected ${graph.value}`);
  if (!/^2 notes/.test(graph.stats)) problems.push(`graph stats ${graph.stats}`);
  if (graph.texts.some((text) => /could not be loaded|sign-in/i.test(text))) problems.push(`graph status ${graph.texts.join(" | ")}`);
  assert.deepEqual(problems, []);
});
