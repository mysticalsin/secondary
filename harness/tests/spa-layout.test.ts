import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, get as httpGet, type Server } from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";

const root = fileURLToPath(new URL("../../deploy/graph/", import.meta.url));
const repo = fileURLToPath(new URL("../..", import.meta.url));
const LONG = "A".repeat(300);

const files: Record<string, readonly [string, string]> = {
  "/graph": ["page.html", "text/html; charset=utf-8"],
  "/dashboard": ["dashboard.html", "text/html; charset=utf-8"],
  "/graph/app.css": ["app.css", "text/css; charset=utf-8"],
  "/graph/dashboard.css": ["dashboard.css", "text/css; charset=utf-8"],
  "/graph/app.js": ["app.js.txt", "text/javascript; charset=utf-8"],
  "/graph/dashboard.js": ["dashboard.js.txt", "text/javascript; charset=utf-8"],
};

function serve(live: boolean): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    const path = new URL(req.url || "/", "http://127.0.0.1").pathname;
    if (path === "/v1/brains") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ brains: [{ id: "me", name: "My Secondary", pages: 1 }] }));
      return;
    }
    if (path === "/v1/brain/tree") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        roots: [{
          id: "me",
          label: "My Secondary",
          access: "full",
          children: [{ id: "me#Project", label: "Project", children: [{ id: "me/long", label: LONG }] }],
        }],
      }));
      return;
    }
    if (path.startsWith("/v1/wiki/")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ markdown: "On track.", summary: LONG, links: [], updatedAt: "2026-11-01T00:00:00.000Z", type: "note", fields: [] }));
      return;
    }
    const item = files[path];
    if (!item) {
      res.writeHead(404);
      res.end();
      return;
    }
    let body = readFileSync(join(root, item[0]), "utf8");
    if (!live && item[0].endsWith(".html")) body = body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
    res.writeHead(200, { "content-type": item[1], "cache-control": "no-store" });
    res.end(body);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("no port");
      resolve({ server, port: address.port });
    });
  });
}

function getJson(url: string): Promise<{ webSocketDebuggerUrl: string; id?: string }[]> {
  return new Promise((resolve, reject) => {
    httpGet(url, (res) => {
      let body = "";
      res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      res.on("end", () => {
        const parsed: unknown = JSON.parse(body);
        resolve(Array.isArray(parsed) ? parsed as { webSocketDebuggerUrl: string; id?: string }[] : [parsed as { webSocketDebuggerUrl: string }]);
      });
    }).on("error", reject);
  });
}

type Session = { call(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>; close(): void };

function connect(wsUrl: string): Promise<Session> {
  const url = new URL(wsUrl);
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(url.port), url.hostname, () => {
      const key = crypto.randomBytes(16).toString("base64");
      socket.write(`GET ${url.pathname}${url.search} HTTP/1.1\r\nHost: ${url.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    });
    let buf = Buffer.alloc(0);
    let open = false;
    const waiters = new Map<number, { res: (value: Record<string, unknown>) => void; rej: (error: Error) => void }>();
    let next = 0;
    function send(obj: unknown) {
      const payload = Buffer.from(JSON.stringify(obj));
      const mask = crypto.randomBytes(4);
      const header = [0x81];
      if (payload.length < 126) header.push(0x80 | payload.length);
      else header.push(0x80 | 126, payload.length >> 8, payload.length & 255);
      const frame = Buffer.concat([Buffer.from(header), mask, payload]);
      for (let i = 0; i < payload.length; i += 1) frame[frame.length - payload.length + i] = payload[i] ^ mask[i % 4];
      socket.write(frame);
    }
    function call(method: string, params: Record<string, unknown> = {}) {
      const id = ++next;
      return new Promise<Record<string, unknown>>((res, rej) => {
        waiters.set(id, { res, rej });
        send({ id, method, params });
      });
    }
    socket.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (!open) {
        const end = buf.indexOf("\r\n\r\n");
        if (end < 0) return;
        buf = buf.subarray(end + 4);
        open = true;
        resolve({ call, close: () => socket.end() });
      }
      while (buf.length >= 2) {
        const opcode = buf[0] & 0x0f;
        let length = buf[1] & 0x7f;
        let offset = 2;
        if (length === 126) {
          if (buf.length < 4) return;
          length = buf.readUInt16BE(2);
          offset = 4;
        }
        if (buf.length < offset + length) return;
        const payload = buf.subarray(offset, offset + length);
        buf = buf.subarray(offset + length);
        if (opcode !== 1) continue;
        const message = JSON.parse(payload.toString()) as { id?: number; result?: Record<string, unknown>; error?: unknown };
        if (message.id === undefined || !waiters.has(message.id)) continue;
        const waiter = waiters.get(message.id);
        waiters.delete(message.id);
        if (!waiter) continue;
        if (message.error) waiter.rej(new Error(JSON.stringify(message.error)));
        else waiter.res(message.result || {});
      }
    });
    socket.on("error", reject);
  });
}

async function launch(): Promise<{ chrome: ChildProcess; session: Session; browser: Session; profile: string }> {
  const profile = mkdtempSync(join(tmpdir(), "spa-layout-"));
  const chrome = spawn("google-chrome", [
    "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
    `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  const debugPort = await new Promise<number>((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error(`chrome did not open a debug port\n${buf}`)), 10000);
    chrome.stderr?.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      const match = buf.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
  });
  const version = await getJson(`http://127.0.0.1:${debugPort}/json/version`);
  const browser = await connect(version[0].webSocketDebuggerUrl);
  const created = await browser.call("Target.createTarget", { url: "about:blank" });
  const targets = await getJson(`http://127.0.0.1:${debugPort}/json/list`);
  const page = targets.find((target) => target.id === created.targetId);
  if (!page) throw new Error("chrome page target missing");
  const session = await connect(page.webSocketDebuggerUrl);
  return { chrome, session, browser, profile };
}

async function stop(chrome: ChildProcess, session: Session | undefined, browser: Session | undefined, profile: string, server: Server) {
  session?.close();
  browser?.close();
  chrome.kill();
  await new Promise<void>((resolve) => {
    if (chrome.exitCode !== null) resolve();
    else {
      chrome.once("exit", () => resolve());
      setTimeout(resolve, 1500);
    }
  });
  server.close();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(profile, { recursive: true, force: true });
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

async function evalJson<T>(session: Session, expression: string): Promise<T | undefined> {
  const result = await session.call("Runtime.evaluate", { expression, returnByValue: true });
  const value = (result.result as { value?: string } | undefined)?.value;
  if (typeof value !== "string") return undefined;
  return JSON.parse(value) as T;
}

async function size(session: Session, width: number, height: number) {
  await session.call("Emulation.setDeviceMetricsOverride", {
    width, height, deviceScaleFactor: 1, mobile: width < 760,
  });
}

test("phone tap targets are at least 44px at 390 and at least 24px on desktop", async () => {
  const { server, port } = await serve(false);
  const launched = await launch();
  try {
    const origin = `http://127.0.0.1:${port}`;
    const short: string[] = [];
    for (const [width, height, floor] of [[390, 844, 44], [1440, 900, 24]] as const) {
      await size(launched.session, width, height);
      await launched.session.call("Page.navigate", { url: `${origin}/graph` });
      let reading: { font: string; brand: number; close: { w: number; h: number }; links: { text: string; h: number }[]; overflow: number } | undefined;
      for (let i = 0; i < 40; i += 1) {
        reading = await evalJson(launched.session, `(() => {
          const panel = document.getElementById("panel");
          if (panel) panel.hidden = false;
          const links = [...document.querySelectorAll(".capsule a")];
          const brand = document.querySelector(".brand");
          const close = document.getElementById("panel-close");
          const de = document.documentElement;
          const box = (el) => el ? el.getBoundingClientRect() : { width: 0, height: 0 };
          const b = box(brand);
          const c = box(close);
          return JSON.stringify({
            font: links[0] ? getComputedStyle(links[0]).fontSize : "",
            brand: Math.round(b.height * 100) / 100,
            close: { w: Math.round(c.width * 100) / 100, h: Math.round(c.height * 100) / 100 },
            links: links.map((a) => ({ text: a.textContent.trim(), h: Math.round(a.getBoundingClientRect().height * 100) / 100 })),
            overflow: de.scrollWidth - de.clientWidth,
          });
        })()`);
        if (reading && reading.links.length === 5 && reading.font === "13px") break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (!reading || reading.font !== "13px") throw new Error(`capsule css was not ready at ${width}`);
      assert.ok(reading.overflow <= 0, `graph overflow ${reading.overflow}px at ${width}`);
      if (reading.brand < floor) short.push(`brand ${reading.brand}px at ${width}`);
      if (reading.close.w < floor || reading.close.h < floor) short.push(`close ${reading.close.w}x${reading.close.h} at ${width}`);
      for (const link of reading.links) {
        if (link.h < floor) short.push(`${link.text} ${link.h}px at ${width}`);
      }
      await launched.session.call("Page.navigate", { url: `${origin}/dashboard` });
      let dash: { font: string; brand: number; links: { text: string; h: number }[] } | undefined;
      for (let i = 0; i < 40; i += 1) {
        dash = await evalJson(launched.session, `(() => {
          const links = [...document.querySelectorAll(".capsule a")];
          const brand = document.querySelector(".brand");
          return JSON.stringify({
            font: links[0] ? getComputedStyle(links[0]).fontSize : "",
            brand: Math.round((brand ? brand.getBoundingClientRect().height : 0) * 100) / 100,
            links: links.map((a) => ({ text: a.textContent.trim(), h: Math.round(a.getBoundingClientRect().height * 100) / 100 })),
          });
        })()`);
        if (dash && dash.links.length === 5 && dash.font === "13px") break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (!dash || dash.font !== "13px") throw new Error(`dashboard capsule css was not ready at ${width}`);
      if (dash.brand < floor) short.push(`dashboard brand ${dash.brand}px at ${width}`);
      for (const link of dash.links) {
        if (link.h < floor) short.push(`dashboard ${link.text} ${link.h}px at ${width}`);
      }
    }
    assert.deepEqual(short, []);
  } finally {
    await stop(launched.chrome, launched.session, launched.browser, launched.profile, server);
  }
});

test("a 300-character title does not widen the dashboard at 1440, 390, or 375", async () => {
  const { server, port } = await serve(true);
  const launched = await launch();
  try {
    const wide: string[] = [];
    for (const [width, height] of [[1440, 900], [390, 844], [375, 812]] as const) {
      await size(launched.session, width, height);
      await launched.session.call("Page.navigate", { url: `http://127.0.0.1:${port}/dashboard` });
      let reading: { seen: boolean; scroll: number; client: number } | undefined;
      for (let i = 0; i < 50; i += 1) {
        reading = await evalJson(launched.session, `(() => {
          const de = document.documentElement;
          return JSON.stringify({ seen: document.body.innerText.includes(${JSON.stringify(LONG)}), scroll: de.scrollWidth, client: de.clientWidth });
        })()`);
        if (reading?.seen) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (!reading?.seen) throw new Error(`the long title did not render at ${width}`);
      if (reading.scroll > reading.client) wide.push(`${width}: scrollWidth ${reading.scroll} > clientWidth ${reading.client}`);
    }
    assert.deepEqual(wide, []);
  } finally {
    await stop(launched.chrome, launched.session, launched.browser, launched.profile, server);
  }
});

test("zoom in and zoom out stay reachable while the graph panel is open", async () => {
  const { server, port } = await serve(false);
  const launched = await launch();
  try {
    await size(launched.session, 1440, 900);
    await launched.session.call("Page.navigate", { url: `http://127.0.0.1:${port}/graph` });
    let hit: { id: string; label: string }[] | undefined;
    for (let i = 0; i < 40; i += 1) {
      hit = await evalJson(launched.session, `(() => {
        const panel = document.getElementById("panel");
        if (panel) panel.hidden = false;
        const buttons = ["zoom-in", "zoom-out"].map((id) => {
          const el = document.getElementById(id);
          const box = el.getBoundingClientRect();
          const node = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          return { id, label: node ? (node.id || node.tagName) : "none" };
        });
        return JSON.stringify(buttons);
      })()`);
      if (hit && hit.every((item) => item.label !== "none") && hit[0].label !== "") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const covered = (hit || []).filter((item) => item.label !== item.id).map((item) => `${item.id} hit ${item.label}`);
    assert.deepEqual(covered, []);
  } finally {
    await stop(launched.chrome, launched.session, launched.browser, launched.profile, server);
  }
});

test("the search field shows a visible focus ring", async () => {
  const { server, port } = await serve(false);
  const launched = await launch();
  try {
    await size(launched.session, 1440, 900);
    await launched.session.call("Page.navigate", { url: `http://127.0.0.1:${port}/graph` });
    let ring: { style: string; width: string } | undefined;
    for (let i = 0; i < 40; i += 1) {
      ring = await evalJson(launched.session, `(() => {
        const input = document.getElementById("search");
        input.focus();
        const style = getComputedStyle(input);
        return JSON.stringify({ style: style.outlineStyle, width: style.outlineWidth });
      })()`);
      if (ring?.style) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(ring?.style, "solid");
    assert.ok(Number.parseFloat(ring?.width || "0") >= 2, `outline width ${ring?.width}`);
  } finally {
    await stop(launched.chrome, launched.session, launched.browser, launched.profile, server);
  }
});

test("prefers-reduced-motion turns off the pulse and the shimmer", async () => {
  const { server, port } = await serve(false);
  const launched = await launch();
  try {
    await launched.session.call("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    await size(launched.session, 1440, 900);
    await launched.session.call("Page.navigate", { url: `http://127.0.0.1:${port}/graph` });
    const pulse = await evalJson<{ name: string }>(launched.session, `(() => {
      const status = document.getElementById("status");
      status.dataset.kind = "loading";
      return JSON.stringify({ name: getComputedStyle(status, "::before").animationName });
    })()`);
    await launched.session.call("Page.navigate", { url: `http://127.0.0.1:${port}/dashboard` });
    const shimmer = await evalJson<{ name: string }>(launched.session, `(() => {
      const box = document.createElement("div");
      box.className = "skeleton";
      const cell = document.createElement("div");
      box.append(cell);
      document.body.append(box);
      return JSON.stringify({ name: getComputedStyle(cell).animationName });
    })()`);
    if (!pulse || !shimmer) throw new Error("motion styles were not ready");
    assert.equal(pulse.name, "none", `pulse ${pulse.name}`);
    assert.equal(shimmer.name, "none", `shimmer ${shimmer.name}`);
  } finally {
    await stop(launched.chrome, launched.session, launched.browser, launched.profile, server);
  }
});

const PRELUDE = `
class Node { constructor() { this.childNodes = []; } append(...xs) { this.childNodes.push(...xs); } }
class Element extends Node {
  constructor(id) { super(); this.id = id || ""; this.style = {}; this.dataset = {}; this.className = ""; this.hidden = false; this.value = ""; this.textContent = ""; this.type = ""; this.checked = false; }
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
  constructor(text, value) { super("option"); this.text = text == null ? "" : String(text); this.textContent = this.text; this.value = value == null ? "" : String(value); }
}
const elements = {};
function element(id) { if (!elements[id]) elements[id] = new Element(id); return elements[id]; }
const document = { documentElement: new Element("html"), activeElement: null, createElement: () => new Element(""), createElementNS: () => new Element(""), querySelector: (sel) => element(String(sel).replace(/^#/, "")), addEventListener() {}, removeEventListener() {} };
document.documentElement.dataset = { api: "" };
const window = { devicePixelRatio: 1, location: { hash: "", href: "http://127.0.0.1/graph" }, addEventListener() {}, removeEventListener() {} };
globalThis.Node = Node; globalThis.Element = Element; globalThis.Option = Option;
globalThis.document = document; globalThis.window = window; globalThis.requestAnimationFrame = () => 0; globalThis.__elements = elements;
`;

async function boot(file: string, fetchImpl: (url: URL) => Promise<Response> | Response): Promise<string> {
  const sandbox: Record<string, unknown> = {
    console, URL, Response, Headers, setTimeout, clearTimeout, queueMicrotask, TextEncoder, Math, Date, JSON,
    Object, Array, Map, Set, WeakMap, Promise, Number, String, Boolean, RegExp, Error, TypeError, Symbol,
    parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
    fetch: async (input: string | URL) => fetchImpl(new URL(String(input), "http://127.0.0.1")),
  };
  const context = createContext(sandbox);
  runInContext(PRELUDE, context);
  runInContext(readFileSync(join(repo, file), "utf8"), context);
  const elements = sandbox.__elements as Record<string, { textContent?: string }>;
  const deadline = Date.now() + 1500;
  let text = "";
  while (Date.now() < deadline) {
    text = elements.status?.textContent || "";
    if (/sign-in|could not be loaded|could not be read|^Ready\./.test(text)) return text;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  return text;
}

test("an offline load does not say the sign-in expired", async () => {
  const reject = () => Promise.reject(new TypeError("Failed to fetch"));
  const graph = await boot("deploy/graph/app.js.txt", reject);
  const dashboard = await boot("deploy/graph/dashboard.js.txt", reject);
  const hits = [graph, dashboard].filter((text) => /sign-in/i.test(text));
  assert.deepEqual(hits, [], `offline said sign-in: ${hits.join(" | ")}`);
  assert.match(graph, /could not be loaded/);
  assert.match(dashboard, /could not be loaded/);
});

test("a page HTTP 500 does not leave the graph status as Ready", async () => {
  const text = await boot("deploy/graph/app.js.txt", (url) => {
    if (url.pathname === "/v1/brains") return Response.json({ brains: [{ id: "me", name: "My Secondary", pages: 1 }] });
    if (url.pathname === "/v1/brain/tree") {
      return Response.json({ roots: [{ id: "me", label: "My Secondary", access: "full", children: [{ id: "me#Notes", label: "Notes", children: [{ id: "me/one", label: "One" }] }] }] });
    }
    return new Response("no", { status: 500, headers: { "content-type": "text/plain" } });
  });
  assert.equal(/^Ready\./.test(text), false, text);
  assert.match(text, /could not be read/);
});
