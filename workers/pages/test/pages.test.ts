import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { parseJsonc } from "../../../scripts/assert-eu.mjs";
import configRaw from "../wrangler.jsonc?raw";

const fresh = () =>
  [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
// A new page per test: a counter keeps its numbers for as long as its slug exists.
let SLUG = fresh();
let OTHER = fresh();
const HTML =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><style>body{margin:0}</style></head>' +
  "<body><h1>Hello</h1><script>var a=1;</script></body></html>";
const IP = "203.0.113.77";

const put = (slug: string, expiresAt: number, html = HTML) =>
  env.PAGES.put(`p/${slug}.html`, html, { customMetadata: { expiresAt: String(expiresAt) } });
const get = (path: string, init: RequestInit = {}) =>
  exports.default.fetch(new Request(`https://pages.test${path}`, init));
const event = (slug: string, body: unknown, ip = IP, headers: Record<string, string> = {}) =>
  get(`/p/${slug}/e`, {
    method: "POST",
    headers: { "CF-Connecting-IP": ip, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const counter = (slug: string) => env.COUNTER.get(env.COUNTER.idFromName(slug));
const statsOf = async (slug: string) => {
  await runDurableObjectAlarm(counter(slug));
  const o = await env.PAGES.get(`stats/${slug}.json`);
  return o ? JSON.parse(await o.text()) : null;
};

beforeEach(async () => {
  SLUG = fresh();
  OTHER = fresh();
  for (const prefix of ["p/", "stats/"]) {
    const l = await env.PAGES.list({ prefix });
    await Promise.all(l.objects.map((o) => env.PAGES.delete(o.key)));
  }
});

describe("serving a page", () => {
  it("serves a live page with a strict CSP, noindex and no caching", async () => {
    await put(SLUG, Date.now() + 60_000);
    const res = await get(`/p/${SLUG}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(HTML);
    expect(res.headers.get("X-Robots-Tag")).toContain("noindex");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.has("Set-Cookie")).toBe(false);
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+'/);
    expect(csp).toMatch(/style-src 'sha256-[A-Za-z0-9+/=]+'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/https?:/);
    expect((await get(`/p/${SLUG}`, { method: "HEAD" })).status).toBe(200);
  });

  it("answers 404 for an unknown, malformed, expired or deleted page", async () => {
    expect((await get(`/p/${SLUG}`)).status).toBe(404);
    for (const bad of ["abc", `${SLUG}0`, "..%2Fsecret", SLUG.toUpperCase(), "x".repeat(32)])
      expect((await get(`/p/${bad}`)).status, bad).toBe(404);
    await put(SLUG, Date.now() - 1);
    const old = await get(`/p/${SLUG}`);
    expect(old.status).toBe(404);
    expect(old.headers.get("X-Robots-Tag")).toContain("noindex");
    await put(OTHER, Date.now() + 60_000);
    expect((await get(`/p/${OTHER}`)).status).toBe(200);
    // Unpublishing deletes the object: the very next request is a 404.
    await env.PAGES.delete(`p/${OTHER}.html`);
    expect((await get(`/p/${OTHER}`)).status).toBe(404);
    // An object without an expiry is not a live page.
    await env.PAGES.put(`p/${SLUG}.html`, HTML);
    expect((await get(`/p/${SLUG}`)).status).toBe(404);
  });

  it("serves nothing but pages, and only on GET, HEAD and its event path", async () => {
    await put(SLUG, Date.now() + 60_000);
    await env.PAGES.put(`stats/${SLUG}.json`, "{}");
    for (const path of [`/stats/${SLUG}.json`, `/p/${SLUG}.html`, "/", `/p/${SLUG}/x`, "/p/"])
      expect((await get(path)).status, path).toBe(404);
    expect((await get(`/p/${SLUG}`, { method: "POST", body: "{}" })).status).toBe(405);
    expect((await get(`/p/${SLUG}/e`)).status).toBe(405);
    const robots = await get("/robots.txt");
    expect(await robots.text()).toContain("Disallow: /");
  });
});

describe("images", () => {
  const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const putImage = (slug: string, n: number, expiresAt: number, type = "image/png") =>
    env.PAGES.put(`p/${slug}/i/${n}`, PNG, {
      httpMetadata: { contentType: type },
      customMetadata: { expiresAt: String(expiresAt) },
    });

  it("serves an image copied into the bucket at publish time, with nothing else allowed", async () => {
    await putImage(SLUG, 0, Date.now() + 60_000);
    const res = await get(`/p/${SLUG}/i/0`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    expect(res.headers.get("X-Robots-Tag")).toContain("noindex");
    expect(res.headers.get("Content-Security-Policy")).toBe("default-src 'none'");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect((await get(`/p/${SLUG}/i/1`)).status).toBe(404);
    expect((await get(`/p/${SLUG}/i/9`)).status).toBe(404);
    expect((await get(`/p/${SLUG}/i/0`, { method: "POST", body: "x" })).status).toBe(405);
  });

  it("is gone with its page: expired, deleted, or not an image type", async () => {
    await putImage(SLUG, 0, Date.now() - 1);
    expect((await get(`/p/${SLUG}/i/0`)).status).toBe(404);
    await putImage(SLUG, 1, Date.now() + 60_000, "text/html");
    expect((await get(`/p/${SLUG}/i/1`)).status).toBe(404);
    await putImage(SLUG, 2, Date.now() + 60_000);
    await env.PAGES.delete(`p/${SLUG}/i/2`);
    expect((await get(`/p/${SLUG}/i/2`)).status).toBe(404);
  });

  it("the page's CSP lets it load images only from its own origin and allows its inline script by hash", async () => {
    const html =
      `<!doctype html><html><head><style>a{}</style></head><body><img src="/p/${SLUG}/i/0" alt="">` +
      "<script>var x=1;</script></body></html>";
    await put(SLUG, Date.now() + 60_000, html);
    const csp = (await get(`/p/${SLUG}`)).headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("img-src 'self'");
    expect(csp).not.toMatch(/img-src[^;]*(?:https?:|data:|\*)/);
    expect(csp).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+'(?:;|$)/);
    // A page without script gets no script allowance at all.
    await put(OTHER, Date.now() + 60_000, "<!doctype html><p>x</p>");
    expect((await get(`/p/${OTHER}`)).headers.get("Content-Security-Policy")).toContain(
      "script-src 'none'",
    );
  });
});

describe("events", () => {
  beforeEach(() => put(SLUG, Date.now() + 60_000));

  it("counts an event only with the consent flag, and drops the rest", async () => {
    expect((await event(SLUG, { k: "view", c: true })).status).toBe(204);
    expect((await event(SLUG, { k: "cta", c: true })).status).toBe(204);
    expect((await event(SLUG, { k: "scroll", b: 50, c: true })).status).toBe(204);
    // Dropped: no flag, a false flag, a string that merely looks true.
    for (const dropped of [{ k: "view" }, { k: "view", c: false }, { k: "cta", c: "true" }])
      expect((await event(SLUG, dropped)).status).toBe(204);
    const s = await statsOf(SLUG);
    expect(s).toMatchObject({ views: 1, ctaClicks: 1, loads: 0, scroll: { "50": 1, "25": 0 } });
  });

  it("writes nothing at all for a consentless event", async () => {
    await event(SLUG, { k: "view", c: false });
    await event(SLUG, { k: "scroll", b: 25 });
    expect(await statsOf(SLUG)).toBeNull();
    const rows = await runInDurableObject(counter(SLUG), (_o, state) =>
      state.storage.sql.exec("SELECT COUNT(*) AS n FROM counts").toArray(),
    );
    expect(rows[0]?.n).toBe(0);
  });

  it("rejects malformed events and events for pages that are not live", async () => {
    expect((await event(SLUG, "not json")).status).toBe(400);
    expect((await event(SLUG, { k: "scroll", b: 33, c: true })).status).toBe(400);
    expect((await event(SLUG, { k: "other", c: true })).status).toBe(400);
    expect((await event(SLUG, "x".repeat(400))).status).toBe(413);
    expect((await event(OTHER, { k: "view", c: true })).status).toBe(404);
    await put(OTHER, Date.now() - 5);
    expect((await event(OTHER, { k: "view", c: true })).status).toBe(404);
    expect(
      (await event(SLUG, { k: "view", c: true }, IP, { Origin: "https://evil.example" })).status,
    ).toBe(403);
    expect(
      (await event(SLUG, { k: "view", c: true }, IP, { Origin: "https://pages.test" })).status,
    ).toBe(204);
  });

  it("is rate limited per visitor and per page", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 22; i++)
      codes.push((await event(SLUG, { k: "view", c: true }, "198.51.100.1")).status);
    expect(codes.slice(0, 20).every((c) => c === 204)).toBe(true);
    expect(codes.slice(20)).toEqual([429, 429]);
    // Another visitor is not affected by the first one's limit.
    expect((await event(SLUG, { k: "view", c: true }, "198.51.100.2")).status).toBe(204);
    // The page-wide limit holds for many visitors together (120 a minute).
    let limited = 0;
    for (let i = 0; i < 130; i++)
      if ((await event(SLUG, { k: "view", c: true }, `192.0.2.${i}`)).status === 429) limited++;
    expect(limited).toBeGreaterThan(0);
    const s = await statsOf(SLUG);
    expect(s.views).toBeLessThanOrEqual(120);
  });

  it("stores no address and nothing that identifies a visitor", async () => {
    await get(`/p/${SLUG}`, { headers: { "CF-Connecting-IP": IP, "User-Agent": "UA-MARKER" } });
    await event(SLUG, { k: "view", c: true }, IP, { "User-Agent": "UA-MARKER" });
    const s = await statsOf(SLUG);
    expect(s.loads).toBe(1);
    expect(JSON.stringify(s)).not.toContain(IP);
    const dump = await runInDurableObject(counter(SLUG), (_o, state) => {
      const sql = state.storage.sql;
      const names = sql
        .exec(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_cf%' ESCAPE '\\'",
        )
        .toArray()
        .map((r) => r.name as string);
      return {
        names,
        rows: names.flatMap((n) => sql.exec(`SELECT * FROM "${n}"`).toArray()),
      };
    });
    expect(dump.names.sort()).toEqual(["counts", "meta", "window"]);
    expect(JSON.stringify(dump.rows)).not.toContain(IP);
    expect(JSON.stringify(dump.rows)).not.toContain("UA-MARKER");
    const keys = (await env.PAGES.list()).objects.map((o) => o.key);
    expect(keys.sort()).toEqual([`p/${SLUG}.html`, `stats/${SLUG}.json`]);
  });
});

describe("what this worker can reach", () => {
  // biome-ignore lint/suspicious/noExplicitAny: a parsed config file
  const cfg = parseJsonc(configRaw) as Record<string, any>;
  const inventory = (c: Record<string, unknown>) =>
    Object.keys(c)
      .filter((k) =>
        [
          "services",
          "kv_namespaces",
          "d1_databases",
          "queues",
          "vectorize",
          "ai",
          "hyperdrive",
        ].includes(k),
      )
      .concat(
        (
          (c.durable_objects as { bindings: { name: string; class_name: string }[] }).bindings ?? []
        ).map((b) => `${b.name}:do:${b.class_name}`),
        (
          (c.r2_buckets as { binding: string; bucket_name: string; jurisdiction: string }[]) ?? []
        ).map((b) => `${b.binding}:r2:${b.bucket_name}:${b.jurisdiction}`),
      )
      .sort();

  it("holds exactly the pages bucket and the counter, in every environment", () => {
    expect(inventory(cfg)).toEqual(["COUNTER:do:PageCounter", "PAGES:r2:secondary-pages-dev:eu"]);
    for (const e of ["staging", "prod"])
      expect(inventory(cfg.env[e])).toEqual([
        "COUNTER:do:PageCounter",
        `PAGES:r2:secondary-pages-${e}:eu`,
      ]);
    for (const c of [cfg, cfg.env.staging, cfg.env.prod]) {
      expect(c.vars.DO_JURISDICTION).toBe("eu");
      expect(c.preview_urls).toBe(false);
      for (const k of ["services", "kv_namespaces", "assets", "triggers"])
        expect(c).not.toHaveProperty(k);
    }
    expect(cfg.env.prod.workers_dev).toBe(false);
    expect(cfg.env.prod.name).toBe("secondary-pages-prod");
  });

  it("the running worker sees only those two bindings (and plain vars)", () => {
    const names = Object.keys(env)
      .filter((n) => !n.startsWith("__VITEST"))
      .sort();
    expect(
      names.filter(
        (n) =>
          ![
            "DO_JURISDICTION",
            "LOCAL_DEV",
            "ENVIRONMENT",
            "EVENTS_PER_MIN",
            "EVENTS_PER_VISITOR_MIN",
          ].includes(n),
      ),
    ).toEqual(["COUNTER", "PAGES"]);
    const anyEnv = env as unknown as Record<string, unknown>;
    for (const brain of [
      "WORKSPACE",
      "TENANT_POLICY",
      "BLOBS",
      "AUDIT",
      "CONNECTOR",
      "API",
      "ASSETS",
      "LP",
    ])
      expect(anyEnv[brain], brain).toBeUndefined();
    for (const secret of [
      "INTERNAL_HMAC_KEY",
      "OPS_HMAC_KEY",
      "AUDIT_KEY_API",
      "CONNECTOR_HMAC_KEY",
      "ANTHROPIC_API_KEY",
    ])
      expect(anyEnv[secret], secret).toBeUndefined();
  });
});
