import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { runGraphScript } from "./run-graph-script.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));
const SERVER_BOUND_MS = 2500;

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
  addEventListener(type, fn) { if (!this.listeners) this.listeners = {}; (this.listeners[type] ||= []).push(fn); }
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

const TREE = {
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

const BRAINS = {
  brains: [
    { id: "me", name: "My Secondary", pages: 1 },
    { id: "c_delivery", name: "Delivery", pages: 0, unavailable: true },
  ],
};

type OptionNode = { value?: string; textContent?: string };
type El = {
  value?: string;
  hidden?: boolean;
  textContent?: string;
  childNodes?: El[];
  listeners?: Record<string, (() => void)[]>;
  dataset?: { kind?: string };
};

function collect(node: El | undefined, out: string[] = []): string[] {
  if (!node || typeof node !== "object") return out;
  if (typeof node.textContent === "string" && node.textContent) out.push(node.textContent);
  for (const child of node.childNodes || []) collect(child, out);
  return out;
}

type Clock = ReturnType<typeof makeClock>;

function boot(file: string, fetchImpl: (input: string | URL) => Promise<Response> | Response, timers: Clock): Record<string, El> {
  const sandbox: Record<string, unknown> = {
    console, URL, Response, Headers, queueMicrotask, TextEncoder, Math, Date, JSON,
    Object, Array, Map, Set, WeakMap, Promise, Number, String, Boolean, RegExp, Error, TypeError, Symbol,
    parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    fetch: fetchImpl,
  };
  const context = createContext(sandbox);
  runInContext(PRELUDE, context);
  runGraphScript(root, file, context);
  return sandbox.__elements as Record<string, El>;
}

function liveFetch(input: string | URL): Response {
  const url = new URL(String(input), "http://127.0.0.1");
  if (url.pathname === "/v1/brains") return Response.json(BRAINS);
  if (url.pathname === "/v1/brain/tree") return Response.json(TREE);
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

function makeClock() {
  let now = 0;
  let nextId = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimeout(fn: () => void, ms?: number) {
      const id = nextId++;
      pending.set(id, { at: now + Number(ms ?? 0), fn });
      return id;
    },
    clearTimeout(id: number) {
      pending.delete(id);
    },
    async advance(): Promise<boolean> {
      let nextAt = Infinity;
      for (const timer of pending.values()) if (timer.at < nextAt) nextAt = timer.at;
      if (nextAt === Infinity) return false;
      now = nextAt;
      const due = [...pending.entries()].filter(([, timer]) => timer.at <= now);
      for (const [id] of due) {
        const timer = pending.get(id);
        if (!timer) continue;
        pending.delete(id);
        timer.fn();
      }
      for (let i = 0; i < 50; i += 1) await Promise.resolve();
      return true;
    },
  };
}

const TIMING_TREE = {
  roots: [
    { id: "me", label: "My Secondary", access: "full", children: [] },
    { id: "c_delivery", label: "Delivery", access: "degraded" },
  ],
};

async function untilDegraded(file: string): Promise<number> {
  const clock = makeClock();
  const elements = boot(file, (input) => {
    const url = new URL(String(input), "http://127.0.0.1");
    if (url.pathname === "/v1/brain/tree" || url.pathname === "/v1/brains") {
      const body = url.pathname === "/v1/brains" ? BRAINS : TIMING_TREE;
      return new Promise((resolve) => {
        clock.setTimeout(() => resolve(Response.json(body)), SERVER_BOUND_MS);
      });
    }
    return Promise.resolve(liveFetch(input));
  }, clock);
  const status = () => String(elements.status?.textContent || "");
  for (let step = 0; step < 8 && status() !== "Degraded"; step += 1) {
    const moved = await clock.advance();
    if (!moved) break;
  }
  assert.equal(status(), "Degraded");
  return clock.now();
}

test("a degraded brain is listed exactly once when the directory already has it", async () => {
  const real = { setTimeout, clearTimeout } as unknown as Clock;
  const graph = boot("deploy/graph/app.js.txt", liveFetch, real);
  const dashboard = boot("deploy/graph/dashboard.js.txt", liveFetch, real);
  const ready = (elements: Record<string, El>, id: string) => (elements[id]?.childNodes || []).length >= 2;
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline && (!ready(graph, "workspace") || !ready(dashboard, "brain"))) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const ids = (nodes: El[] | undefined) => (nodes || []).map((node) => String(node.value));
  const graphValues = ids(graph.workspace?.childNodes);
  const dashboardValues = ids(dashboard.brain?.childNodes);
  assert.equal(graphValues.join(","), "me,c_delivery");
  assert.equal(dashboardValues.join(","), "me,c_delivery");
});

test("tree and brains overlap so Degraded lands on one server bound", async () => {
  const dashboard: number[] = [];
  const graph: number[] = [];
  for (let i = 0; i < 50; i += 1) {
    dashboard.push(await untilDegraded("deploy/graph/dashboard.js.txt"));
    graph.push(await untilDegraded("deploy/graph/app.js.txt"));
  }
  assert.equal(dashboard.every((ms) => ms === SERVER_BOUND_MS), true, `dashboard ${dashboard[0]}`);
  assert.equal(graph.every((ms) => ms === SERVER_BOUND_MS), true, `graph ${graph[0]}`);
});

test("a degraded brain shows no empty-state copy", async () => {
  const dashboard = boot("deploy/graph/dashboard.js.txt", liveFetch, { setTimeout, clearTimeout } as unknown as Clock);
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline && String(dashboard.status?.textContent || "") !== "Degraded") {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(dashboard.status?.textContent, "Degraded");
  const brain = dashboard.brain;
  assert.equal(typeof brain?.listeners?.change?.[0], "function");
  if (brain) brain.value = "c_delivery";
  brain?.listeners?.change?.[0]?.();
  const text = collect(dashboard.main).join("\n");
  assert.equal(text.includes("Your second brain has no pages yet"), false);
  assert.equal(text.includes("Add or import notes"), false);
  assert.equal(text.includes("Open your Personal Brain"), false);
  assert.equal(dashboard.status?.textContent, "Degraded");

  const listedSecond = {
    brains: [
      { id: "c_delivery", name: "Delivery", pages: 0, unavailable: true },
      { id: "me", name: "My Secondary", pages: 0 },
    ],
  };
  const graph = boot("deploy/graph/app.js.txt", (input) => {
    const url = new URL(String(input), "http://127.0.0.1");
    if (url.pathname === "/v1/brains") return Response.json(listedSecond);
    return liveFetch(input);
  }, { setTimeout, clearTimeout } as unknown as Clock);
  const graphDeadline = Date.now() + 1500;
  while (Date.now() < graphDeadline && String(graph.status?.textContent || "") !== "Degraded") {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(graph.workspace?.value, "c_delivery");
  assert.equal(graph.empty?.hidden, true);
  assert.equal(graph.status?.textContent, "Degraded");
});
