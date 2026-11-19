import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";

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
  addEventListener() {}
  removeEventListener() {}
  replaceChildren(...xs) { this.childNodes = xs.flat(); }
  append(...xs) { this.childNodes.push(...xs); }
  querySelector() { return null; }
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

function treeFor(cards: Card[], pagesById: Record<string, Page[]>): { roots: unknown[] } {
  return {
    roots: cards.map((card) => ({
      id: card.id,
      label: card.name,
      access: "full",
      count: card.pages,
      children: (pagesById[card.id] || []).length
        ? [{ id: `${card.id}#Notes`, label: "Notes", children: pagesById[card.id] }]
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

async function load(file: string, cards: Card[], pagesById: Record<string, Page[]>, extra: { links?: Record<string, WikiLink[]>; settle?: boolean } = {}): Promise<{
  urls: URL[];
  value: string;
  options: { value: string; text: string }[];
  texts: string[];
  stats: string;
}> {
  const urls: URL[] = [];
  const tree = treeFor(cards, pagesById);
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
      if (url.pathname === "/v1/brains") return Response.json({ brains: cards });
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
  runInContext(readFileSync(join(root, file), "utf8"), context);
  const elements = sandbox.__elements as Record<string, { value: string; childNodes: { value?: string; textContent?: string; childNodes?: unknown[] }[] }>;
  const selectId = file.endsWith("dashboard.js.txt") ? "brain" : "workspace";
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    const select = elements[selectId];
    if (select && select.childNodes.length > 0) break;
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
  return {
    urls,
    value: select?.value ?? "",
    options: (select?.childNodes || []).map((node) => ({ value: String(node.value ?? ""), text: String(node.textContent ?? "") })),
    texts: collect(file.endsWith("dashboard.js.txt") ? elements.main : elements.status),
    stats: String(elements.stats?.textContent || ""),
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
