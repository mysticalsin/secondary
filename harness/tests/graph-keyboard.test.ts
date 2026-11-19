import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const page = readFileSync(join(repo, "deploy/graph/page.html"), "utf8");

test("the graph page has a main landmark and an h1", () => {
  assert.match(page, /<main[\s>]/);
  assert.match(page, /<h1[^>]*>\s*Graph\s*<\/h1>/);
  assert.match(page, /<canvas[^>]*\stabindex="0"/);
});

test("the canvas is an application and does not point at Find a page", () => {
  const canvas = page.match(/<canvas\b[^>]*>/)?.[0] || "";
  assert.match(canvas, /role="application"/);
  assert.doesNotMatch(canvas, /role="img"/);
  assert.doesNotMatch(canvas, /aria-label="[^"]*Arrow/);
  assert.doesNotMatch(canvas, /aria-label="[^"]*Enter/);
  assert.doesNotMatch(canvas, /Find a page/);
});

test("the script does not set the canvas tabindex again", () => {
  const source = readFileSync(join(repo, "deploy/graph/app.js.txt"), "utf8");
  assert.equal(/canvas\.tabIndex\s*=/.test(source), false);
});

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
    this.tabIndex = -1;
    this.listeners = {};
  }
  setAttribute(name, value) { this[name] = value; }
  getAttribute(name) { return this[name]; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
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
  constructor(text, value) { super("option"); this.text = text == null ? "" : String(text); this.textContent = this.text; this.value = value == null ? "" : String(value); }
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
const window = { devicePixelRatio: 1, location: { hash: "", href: "http://127.0.0.1/graph" }, addEventListener() {}, removeEventListener() {} };
globalThis.Node = Node; globalThis.Element = Element; globalThis.Option = Option;
globalThis.document = document; globalThis.window = window; globalThis.requestAnimationFrame = () => 0; globalThis.__elements = elements;
`;

test("arrow keys move between graph nodes and Enter selects the current one", async () => {
  const sandbox: Record<string, unknown> = {
    console, URL, Response, Headers, setTimeout, clearTimeout, queueMicrotask, TextEncoder, Math, Date, JSON,
    Object, Array, Map, Set, WeakMap, Promise, Number, String, Boolean, RegExp, Error, TypeError, Symbol,
    parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
    fetch: async (input: string | URL) => {
      const url = new URL(String(input), "http://127.0.0.1");
      if (url.pathname === "/v1/brains") return Response.json({ brains: [{ id: "me", name: "My Secondary", pages: 2 }] });
      if (url.pathname === "/v1/brain/tree") {
        return Response.json({
          roots: [{
            id: "me",
            label: "My Secondary",
            access: "full",
            children: [{ id: "me#Notes", label: "Notes", children: [{ id: "me/alpha", label: "Alpha" }, { id: "me/beta", label: "Beta" }] }],
          }],
        });
      }
      return new Response("no", { status: 404, headers: { "content-type": "text/plain" } });
    },
  };
  const context = createContext(sandbox);
  runInContext(PRELUDE, context);
  runInContext(readFileSync(join(repo, "deploy/graph/app.js.txt"), "utf8"), context);
  const elements = sandbox.__elements as Record<string, { textContent?: string; tabIndex?: number; hidden?: boolean; listeners?: Record<string, (event: { key: string; preventDefault: () => void }) => void> }>;
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline && !/note/.test(elements.stats?.textContent || "")) {
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  const handler = elements.graph.listeners?.keydown;
  assert.equal(typeof handler, "function");
  const press = (key: string) => handler?.({ key, preventDefault() {} });
  press("ArrowRight");
  assert.equal(elements["panel-title"].textContent, "My Secondary");
  press("ArrowRight");
  assert.equal(elements["panel-title"].textContent, "Notes");
  press("ArrowDown");
  assert.equal(elements["panel-title"].textContent, "Alpha");
  press("ArrowLeft");
  assert.equal(elements["panel-title"].textContent, "Notes");
  press("ArrowUp");
  assert.equal(elements["panel-title"].textContent, "My Secondary");
  press("Enter");
  assert.equal(elements.panel.hidden, false);
  assert.equal(elements["panel-title"].textContent, "My Secondary");
});

test("modified arrow keys do not move the graph", async () => {
  const sandbox: Record<string, unknown> = {
    console, URL, Response, Headers, setTimeout, clearTimeout, queueMicrotask, TextEncoder, Math, Date, JSON,
    Object, Array, Map, Set, WeakMap, Promise, Number, String, Boolean, RegExp, Error, TypeError, Symbol,
    parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
    fetch: async (input: string | URL) => {
      const url = new URL(String(input), "http://127.0.0.1");
      if (url.pathname === "/v1/brains") return Response.json({ brains: [{ id: "me", name: "My Secondary", pages: 2 }] });
      if (url.pathname === "/v1/brain/tree") {
        return Response.json({
          roots: [{
            id: "me",
            label: "My Secondary",
            access: "full",
            children: [{ id: "me#Notes", label: "Notes", children: [{ id: "me/alpha", label: "Alpha" }] }],
          }],
        });
      }
      return new Response("no", { status: 404, headers: { "content-type": "text/plain" } });
    },
  };
  const context = createContext(sandbox);
  runInContext(PRELUDE, context);
  runInContext(readFileSync(join(repo, "deploy/graph/app.js.txt"), "utf8"), context);
  const elements = sandbox.__elements as Record<string, { textContent?: string; hidden?: boolean; listeners?: Record<string, (event: { key: string; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; preventDefault: () => void }) => void> }>;
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline && !/note/.test(elements.stats?.textContent || "")) {
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  const handler = elements.graph.listeners?.keydown;
  assert.equal(typeof handler, "function");
  const prevented: string[] = [];
  const press = (event: { key: string; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => {
    let stopped = false;
    handler?.({ ...event, preventDefault() { stopped = true; } });
    if (stopped) prevented.push(event.key);
  };
  const before = elements["panel-title"]?.textContent;
  press({ key: "ArrowRight", altKey: true });
  press({ key: "ArrowRight", ctrlKey: true });
  press({ key: "ArrowRight", metaKey: true });
  assert.equal(elements["panel-title"]?.textContent, before);
  assert.deepEqual(prevented, []);
  press({ key: "ArrowRight" });
  assert.equal(elements["panel-title"].textContent, "My Secondary");
  assert.deepEqual(prevented, ["ArrowRight"]);
});

test("the graph name has no key tutorial and announces the selected page", async () => {
  const canvas = page.match(/<canvas\b[^>]*>/)?.[0] || "";
  const label = canvas.match(/aria-label="([^"]*)"/)?.[1] || "";
  assert.equal(/\b(arrow|enter|key|keyboard)\b/i.test(label), false, label);
  const sandbox: Record<string, unknown> = {
    console, URL, Response, Headers, setTimeout, clearTimeout, queueMicrotask, TextEncoder, Math, Date, JSON,
    Object, Array, Map, Set, WeakMap, Promise, Number, String, Boolean, RegExp, Error, TypeError, Symbol,
    parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
    fetch: async (input: string | URL) => {
      const url = new URL(String(input), "http://127.0.0.1");
      if (url.pathname === "/v1/brains") return Response.json({ brains: [{ id: "me", name: "My Secondary", pages: 2 }] });
      if (url.pathname === "/v1/brain/tree") {
        return Response.json({
          roots: [{
            id: "me",
            label: "My Secondary",
            access: "full",
            children: [{ id: "me#Notes", label: "Notes", children: [{ id: "me/alpha", label: "Alpha" }] }],
          }],
        });
      }
      return new Response("no", { status: 404, headers: { "content-type": "text/plain" } });
    },
  };
  const context = createContext(sandbox);
  runInContext(PRELUDE, context);
  runInContext(readFileSync(join(repo, "deploy/graph/app.js.txt"), "utf8"), context);
  const elements = sandbox.__elements as Record<string, { textContent?: string; listeners?: Record<string, (event: { key: string; preventDefault: () => void }) => void> }>;
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline && !/note/.test(elements.stats?.textContent || "")) {
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  const handler = elements.graph.listeners?.keydown;
  assert.equal(typeof handler, "function");
  const press = (key: string) => handler?.({ key, preventDefault() {} });
  press("ArrowRight");
  assert.equal(elements["graph-selection"]?.textContent, "My Secondary");
  press("ArrowRight");
  assert.equal(elements["graph-selection"]?.textContent, "Notes");
  press("ArrowDown");
  assert.equal(elements["graph-selection"]?.textContent, "Alpha");
});
