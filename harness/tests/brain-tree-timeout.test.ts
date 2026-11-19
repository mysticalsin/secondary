import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";

const root = fileURLToPath(new URL("../..", import.meta.url));

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

type Status = { textContent?: string; dataset?: { kind?: string } };
type OptionNode = { value?: string; textContent?: string };

const HEALTHY = {
  roots: [
    {
      id: "me",
      label: "My Secondary",
      access: "full",
      children: [{ id: "me#Notes", label: "Notes", children: [{ id: "me/alpha", label: "Alpha" }] }],
    },
    { id: "c_delivery", label: "Delivery", access: "degraded" },
  ],
};

function page(file: string): string {
  return readFileSync(join(root, file), "utf8");
}

function boot(
  file: string,
  fetch: (input: string | URL) => Promise<Response> | Response,
  fetchBound?: string,
): { elements: Record<string, Status & { childNodes?: OptionNode[]; value?: string }> } {
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
    fetch,
  };
  const context = createContext(sandbox);
  runInContext(PRELUDE, context);
  if (fetchBound) runInContext(`document.documentElement.dataset.fetchBound = ${JSON.stringify(fetchBound)};`, context);
  runInContext(page(file), context);
  return {
    elements: sandbox.__elements as Record<string, Status & { childNodes?: OptionNode[]; value?: string }>,
  };
}

async function until(read: () => string, want: (text: string) => boolean, ms: number): Promise<string> {
  const deadline = Date.now() + ms;
  let text = read();
  while (Date.now() < deadline && !want(text)) {
    await new Promise((resolve) => setTimeout(resolve, 15));
    text = read();
  }
  return text;
}

function wiki(input: string | URL): Response {
  const url = new URL(String(input), "http://127.0.0.1");
  if (url.pathname === "/v1/brains") return Response.json({ brains: [{ id: "me", name: "My Secondary", pages: 1 }] });
  if (url.pathname === "/v1/wiki/me/pages/alpha") {
    return Response.json({
      markdown: "# Alpha\n\nSynthetic page.\n",
      summary: "Alpha",
      links: [],
      updatedAt: "2026-11-01T00:00:00.000Z",
      type: "note",
      fields: [],
    });
  }
  return new Response("no", { status: 404, headers: { "content-type": "text/plain" } });
}

test("a hung tree fetch leaves the graph and the dashboard degraded", async () => {
  const hang = () => new Promise<Response>(() => {});
  const graph = boot("deploy/graph/app.js.txt", (input) => {
    const url = new URL(String(input), "http://127.0.0.1");
    if (url.pathname === "/v1/brain/tree") return hang();
    return wiki(input);
  }, "40");
  const dashboard = boot("deploy/graph/dashboard.js.txt", (input) => {
    const url = new URL(String(input), "http://127.0.0.1");
    if (url.pathname === "/v1/brain/tree") return hang();
    return wiki(input);
  }, "40");
  const graphText = await until(() => String(graph.elements.status?.textContent || ""), (text) => text === "Degraded", 400);
  const dashboardText = await until(() => String(dashboard.elements.status?.textContent || ""), (text) => text === "Degraded", 400);
  assert.equal(graphText, "Degraded");
  assert.equal(graph.elements.status?.dataset?.kind, "degraded");
  assert.equal(dashboardText, "Degraded");
  assert.equal(dashboard.elements.status?.dataset?.kind, "degraded");
  assert.doesNotMatch(graphText, /Loading your second brain/);
  assert.doesNotMatch(dashboardText, /Reading your second brain/);
});

test("a degraded brain is visible and the loading line is gone", async () => {
  const fetch = (input: string | URL) => {
    const url = new URL(String(input), "http://127.0.0.1");
    if (url.pathname === "/v1/brain/tree") return Response.json(HEALTHY);
    return wiki(input);
  };
  const graph = boot("deploy/graph/app.js.txt", fetch);
  const dashboard = boot("deploy/graph/dashboard.js.txt", fetch);
  const graphText = await until(
    () => String(graph.elements.status?.textContent || ""),
    (text) => text === "Degraded" || (!text.startsWith("Loading") && !text.startsWith("Reading")),
    1500,
  );
  const dashboardText = await until(
    () => String(dashboard.elements.status?.textContent || ""),
    (text) => text === "Degraded" || (!text.startsWith("Reading") && !text.startsWith("Loading")),
    1500,
  );
  assert.equal(graphText, "Degraded");
  assert.equal(dashboardText, "Degraded");
  const graphNames = (graph.elements.workspace?.childNodes || []).map((node) => node.textContent);
  const dashboardNames = (dashboard.elements.brain?.childNodes || []).map((node) => node.textContent);
  assert.equal(graphNames.includes("Delivery"), true);
  assert.equal(dashboardNames.includes("Delivery"), true);
  assert.equal(graphNames.includes("My Secondary"), true);
  assert.equal(dashboardNames.includes("My Secondary"), true);
});

test("the graph and the dashboard import one fetch bound", () => {
  const graph = page("deploy/graph/app.js.txt");
  const dashboard = page("deploy/graph/dashboard.js.txt");
  const shared = page("deploy/graph/fetch-bound.js.txt");
  assert.match(graph, /import \{ boundFetch \} from "\/graph\/fetch-bound\.js"/);
  assert.match(dashboard, /import \{ boundFetch \} from "\/graph\/fetch-bound\.js"/);
  assert.match(shared, /export async function boundFetch/);
  assert.match(shared, /clearTimeout\(timer\)/);
  assert.equal(graph.includes('new Error("degraded")'), false);
  assert.equal(dashboard.includes('new Error("degraded")'), false);
});

test("the shared fetch bound clears its timer on success and on timeout", async () => {
  const source = page("deploy/graph/fetch-bound.js.txt").replace(
    "export async function boundFetch",
    "globalThis.boundFetch = async function boundFetch",
  );
  const pending = new Set<number>();
  let now = 0;
  let next = 1;
  const queue: { id: number; at: number; fn: () => void }[] = [];
  const sandbox: Record<string, unknown> = {
    console, Promise, Error, TypeError, AbortController,
    setTimeout: (fn: () => void, ms?: number) => {
      const id = next++;
      pending.add(id);
      queue.push({ id, at: now + Number(ms ?? 0), fn });
      return id;
    },
    clearTimeout: (id: number) => {
      pending.delete(id);
    },
    fetch: (_url: string, init?: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }),
  };
  const context = createContext(sandbox);
  runInContext(source, context);
  const boundFetch = sandbox.boundFetch as (url: string, init: Record<string, string>, ms: number) => Promise<Response>;
  const tick = (ms: number) => {
    now += ms;
    const due = queue.filter((item) => pending.has(item.id) && item.at <= now).sort((a, b) => a.at - b.at);
    for (const item of due) {
      if (!pending.delete(item.id)) continue;
      item.fn();
    }
  };

  sandbox.fetch = async () => Response.json({ ok: true });
  const success = boundFetch("/v1/brain/tree", {}, 8000);
  await success;
  assert.equal(pending.size, 0);

  sandbox.fetch = (_url: string, init?: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
  });
  const timed = boundFetch("/v1/brain/tree", {}, 8000);
  const settled = timed.then(
    () => "resolved",
    (err: Error) => err.message,
  );
  tick(8000);
  await Promise.resolve();
  assert.equal(await settled, "degraded");
  assert.equal(pending.size, 0);
});
