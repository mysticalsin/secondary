/**
 * Local Miniflare proof of cross-request I/O on workerd.
 * dispatchFetch only. No listening port, no tunnel, no deploy.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Miniflare } from "miniflare";

const script = (mode: "none" | "wait") => `
let shared;
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/start") {
      shared = (async () => {
        await scheduler.wait(20);
        const cache = await caches.open("probe");
        await cache.match("https://probe.invalid/item");
        return "read";
      })();
      if (${mode === "wait" ? "true" : "false"}) ctx.waitUntil(shared);
      return new Response("started");
    }
    if (url.pathname === "/join") {
      if (!shared) return new Response("missing");
      try {
        const value = await shared;
        return new Response("joined:" + value);
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        return new Response("error:" + message, { status: 500 });
      }
    }
    return new Response("no");
  }
}
`;

function boot(mode: "none" | "wait", name: string) {
  return new Miniflare({
    workers: [
      {
        config: {
          name,
          compatibilityDate: "2026-10-01",
          manifest: {
            mainModule: "index.js",
            modules: { "index.js": { type: "esm", contents: script(mode) } },
          },
        },
      },
    ],
  });
}

async function join(mf: Miniflare): Promise<string> {
  return Promise.race([
    mf.dispatchFetch("http://127.0.0.1/join").then(async (res) => `${res.status} ${await res.text()}`),
    new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 1500)),
  ]);
}

test("a joiner sees the raw read after the originator returns only when waitUntil holds it", async () => {
  const dropped = boot("none", "probe-none");
  const held = boot("wait", "probe-wait");
  const other = boot("wait", "probe-other");
  try {
    const started = await dropped.dispatchFetch("http://127.0.0.1/start");
    assert.equal(started.status, 200);
    assert.equal(await started.text(), "started");
    assert.equal(await join(dropped), "timeout");

    const heldStart = await held.dispatchFetch("http://127.0.0.1/start");
    assert.equal(heldStart.status, 200);
    assert.equal(await heldStart.text(), "started");
    assert.equal(await join(held), "200 joined:read");

    const isolated = await other.dispatchFetch("http://127.0.0.1/join");
    assert.equal(await isolated.text(), "missing");
  } finally {
    await dropped.dispose();
    await held.dispose();
    await other.dispose();
  }
});

test("the waitUntil read times out once and a rejection is logged", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (error: unknown) => {
    unhandled.push(error);
  };
  process.on("unhandledRejection", onUnhandled);
  const mf = new Miniflare({
    workers: [
      {
        config: {
          name: "probe-bound",
          compatibilityDate: "2026-10-01",
          manifest: {
            mainModule: "index.js",
            modules: {
              "index.js": {
                type: "esm",
                contents: `
let timeouts = 0;
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/reject") {
      const job = (async () => {
        await scheduler.wait(10);
        throw new Error("synthetic inflight rejection");
      })().catch(() => {
        console.log(JSON.stringify({ event: "tree_inflight", outcome: "rejected" }));
        return "logged";
      });
      ctx.waitUntil(job);
      const logged = await job;
      return new Response(logged);
    }
    if (url.pathname === "/timeout") {
      const job = new Promise((resolve) => {
        setTimeout(() => {
          timeouts += 1;
          resolve("timed-out");
        }, 30);
      });
      ctx.waitUntil(job);
      const value = await job;
      return new Response(value + ":" + timeouts);
    }
    return new Response("no");
  }
}
`,
              },
            },
          },
        },
      },
    ],
  });
  try {
    const rejected = await mf.dispatchFetch("http://127.0.0.1/reject");
    assert.equal(rejected.status, 200);
    assert.equal(await rejected.text(), "logged");
    const timed = await mf.dispatchFetch("http://127.0.0.1/timeout");
    assert.equal(timed.status, 200);
    assert.equal(await timed.text(), "timed-out:1");
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
    await mf.dispose();
  }
});
