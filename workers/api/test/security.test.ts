import { beforeAll, describe, expect, it } from "vitest";
import auditConfigRaw from "../../audit/wrangler.jsonc?raw";
import mcpConfigRaw from "../../mcp/wrangler.jsonc?raw";
import apiConfigRaw from "../wrangler.jsonc?raw";
import { as, call, json, type Loose, seed } from "./helpers.ts";

beforeAll(async () => {
  await seed();
});

/** Comments out of JSONC without touching strings. */
function parseJsonc(src: string): Record<string, Loose> {
  let out = "";
  let inStr = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i] as string;
    if (inStr) {
      out += c;
      if (c === "\\") out += src[++i];
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
      out += c;
    } else if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      out += "\n";
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

describe("security headers", () => {
  const required = (res: Response) => {
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("https://fonts.googleapis.com");
    expect(csp).toContain("https://fonts.gstatic.com");
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(csp).not.toMatch(/script-src[^;]*https?:/);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("Strict-Transport-Security")).toMatch(/max-age=\d{8,}/);
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  };

  it("are on every API response: ok, 401, 404, 400, 403, 413, 415", async () => {
    const responses = [
      await call("/v1/health"),
      await call("/v1/me"),
      await as("ceo", "/v1/nope"),
      await as("ceo", "/v1/map?lens=x"),
      await as("consultant", "/v1/actions", {
        body: { nodeId: "c_bid", action: "edit", revision: 1, payload: { title: "x" } },
      }),
      await as("ceo", "/v1/actions", { rawBody: "x".repeat(40_000) }),
      await as("ceo", "/v1/actions", { rawBody: "{}", headers: { "Content-Type": "text/plain" } }),
    ];
    expect(responses.map((r) => r.status)).toEqual([200, 401, 404, 400, 403, 413, 415]);
    for (const r of responses) {
      required(r);
      expect(r.headers.get("Cache-Control")).toBe("no-store");
      expect(r.headers.get("Content-Type")).toContain("application/json");
    }
  });

  it("are on static assets and on non-API errors too", async () => {
    const index = await call("/");
    expect(index.status).toBe(200);
    required(index);
    expect(index.headers.get("Cache-Control")).not.toBe("no-store");
    required(await call("/some/spa/route"));
    const post = await call("/", { method: "POST", body: {} });
    expect(post.status).toBe(405);
    required(post);
  });

  it("there is no CORS: a preflight or cross-origin read gets no allow headers", async () => {
    const pre = await call("/v1/me", {
      method: "OPTIONS",
      headers: { Origin: "https://evil.test", "Access-Control-Request-Method": "GET" },
    });
    expect(pre.status).toBeGreaterThanOrEqual(400);
    for (const [k] of pre.headers)
      expect(k.toLowerCase().startsWith("access-control-")).toBe(false);
    const get = await as("ceo", "/v1/me", { headers: { Origin: "https://evil.test" } });
    for (const [k] of get.headers)
      expect(k.toLowerCase().startsWith("access-control-")).toBe(false);
  });
});

describe("request guards", () => {
  it("mutations need a JSON content type and a same-site fetch", async () => {
    const form = await as("ceo", "/v1/actions", {
      rawBody: "nodeId=core",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    expect(form.status).toBe(415);
    const cross = await as("ceo", "/v1/actions", {
      body: { nodeId: "core", action: "comment", payload: { text: "x" } },
      headers: { "Sec-Fetch-Site": "cross-site" },
    });
    expect(cross.status).toBe(403);
    const same = await as("ceo", "/v1/actions", {
      body: { nodeId: "core", action: "comment", payload: { text: "ok" } },
      headers: { "Sec-Fetch-Site": "same-origin" },
    });
    expect(same.status).toBe(200);
  });

  it("limits request size", async () => {
    const big = await as("ceo", "/v1/genui/plan", { body: { prompt: "a".repeat(40_000) } });
    expect(big.status).toBe(413);
    expect((await as("ceo", "/v1/genui/plan", { body: { prompt: "a".repeat(501) } })).status).toBe(
      400,
    );
  });

  it("search treats the query as plain words, never as FTS syntax", async () => {
    for (const q of ['"', "* OR *", "a AND NOT b", "NEAR(a b)", "(((", "col:value", "\\", "%00"]) {
      const res = await as("ceo", `/v1/search?q=${encodeURIComponent(q)}`);
      expect([200, 400], q).toContain(res.status);
    }
    expect((await as("ceo", "/v1/search?q=")).status).toBe(400);
    expect((await as("ceo", `/v1/search?q=${"a".repeat(300)}`)).status).toBe(400);
  });

  it("errors never leak stack traces or messages", async () => {
    const boom = {
      TENANT_POLICY: {
        jurisdiction: () => {
          throw new Error("boom: internal detail /src/secret.ts:42");
        },
      },
    };
    const res = await as("ceo", "/v1/me", { env: boom });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "internal_error", requestId: expect.any(String) });
    expect(text).not.toMatch(/boom|secret|\.ts|at /);
  });
});

describe("rate limit", () => {
  const env = { RATE_LIMIT_PER_MIN: "3" };

  it("is per principal, answers 429 with Retry-After, and resets with the window", async () => {
    const t0 = Date.UTC(2026, 10, 4, 12, 0, 5);
    const hit = (email: string, now = t0) => call("/v1/me", { email, env, now });
    for (let i = 0; i < 3; i++) expect((await hit("rl-a@example.invalid")).status).toBe(200);
    const limited = await hit("rl-a@example.invalid");
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await json(limited)).toEqual({ error: "rate_limited" });
    // Another person is unaffected.
    expect((await hit("rl-b@example.invalid")).status).toBe(200);
    // The next minute starts a new window.
    expect((await hit("rl-a@example.invalid", t0 + 61_000)).status).toBe(200);
  });

  it("counts the person, not the persona they switch to", async () => {
    const t0 = Date.UTC(2026, 10, 4, 13, 0, 5);
    for (const persona of ["ceo", "auditor", "reviewer"])
      expect(
        (await call("/v1/me", { email: "rl-c@example.invalid", persona, env, now: t0 })).status,
      ).toBe(200);
    expect(
      (await call("/v1/me", { email: "rl-c@example.invalid", persona: "ceo", env, now: t0 }))
        .status,
    ).toBe(429);
  });
});

describe("binding inventory", () => {
  const api = parseJsonc(apiConfigRaw);
  const audit = parseJsonc(auditConfigRaw);

  const BINDING_SECTIONS = [
    "kv_namespaces",
    "d1_databases",
    "queues",
    "ai",
    "vectorize",
    "hyperdrive",
    "analytics_engine_datasets",
    "browser",
    "workflows",
    "send_email",
    "mtls_certificates",
    "dispatch_namespaces",
    "tail_consumers",
    "pipelines",
    "secrets_store_secrets",
    "images",
    "vpc_services",
    "unsafe",
    "containers",
    "routes",
    "route",
    "triggers",
    "env",
  ];

  it("api worker holds exactly the allowlisted bindings", () => {
    const bindings = [
      ...(api.assets ? [`${api.assets.binding}:assets`] : []),
      ...api.durable_objects.bindings.map((b: Loose) => `${b.name}:durable_object:${b.class_name}`),
      ...api.r2_buckets.map((b: Loose) => `${b.binding}:r2:${b.jurisdiction}`),
      ...api.services.map((b: Loose) => `${b.binding}:service:${b.service}`),
    ].sort();
    expect(bindings).toEqual([
      "ASSETS:assets",
      "AUDIT:service:secondary-audit-dev",
      "BLOBS:r2:eu",
      "CONNECTOR:service:secondary-connector-dev",
      "TENANT_POLICY:durable_object:TenantPolicy",
      "WORKSPACE:durable_object:Workspace",
    ]);
    for (const k of BINDING_SECTIONS) expect(api[k], `unexpected section ${k}`).toBeUndefined();
    expect(api.migrations[0].new_sqlite_classes.sort()).toEqual(["TenantPolicy", "Workspace"]);
  });

  it("api worker vars are the documented ones, with no secret values committed", () => {
    expect(Object.keys(api.vars).sort()).toEqual([
      "ACCESS_AUD",
      "ACCESS_TEAM_DOMAIN",
      "DEFAULT_TENANT_ID",
      "DO_JURISDICTION",
      "ENVIRONMENT",
      "RATE_LIMIT_PER_MIN",
      "TENANT_DOMAINS",
    ]);
    expect(api.vars.DO_JURISDICTION).toBe("eu");
    expect(api.vars.ACCESS_AUD).toBe("");
    expect(api.vars.ACCESS_TEAM_DOMAIN).toBe("");
    expect(api.vars).not.toHaveProperty("SEED_TOKEN");
    expect(api.vars).not.toHaveProperty("DEV_AUTH_BYPASS_EMAIL");
    expect(api.assets.run_worker_first).toBe(true);
  });

  it("audit worker: one EU bucket, no inbound public surface, no outbound bindings", () => {
    expect(audit.r2_buckets).toEqual([
      { binding: "AUDIT_LOG", bucket_name: "secondary-audit-dev", jurisdiction: "eu" },
    ]);
    expect(audit.workers_dev).toBe(false);
    expect(audit.preview_urls).toBe(false);
    for (const k of [...BINDING_SECTIONS, "services", "durable_objects", "assets"])
      expect(audit[k], k).toBeUndefined();
  });
});

describe("M1: public surface of each worker (config)", () => {
  it("api: workers_dev on behind Access, preview URLs off, no routes, no secrets as vars", () => {
    const api = parseJsonc(apiConfigRaw);
    expect(api.workers_dev).toBe(true);
    expect(api.preview_urls).toBe(false);
    expect(api.routes).toBeUndefined();
    for (const k of [
      "SEED_TOKEN",
      "INTERNAL_HMAC_KEY",
      "CONNECTOR_HMAC_KEY",
      "AUDIT_KEY_API",
      "AUDIT_KEY_READ",
    ])
      expect(api.vars, k).not.toHaveProperty(k);
  });

  it("mcp: workers_dev on (hosts need discovery, /token, /register, /mcp), preview URLs off, no routes", () => {
    const mcp = parseJsonc(mcpConfigRaw);
    expect(mcp.workers_dev).toBe(true);
    expect(mcp.preview_urls).toBe(false);
    expect(mcp.routes).toBeUndefined();
    for (const k of ["INTERNAL_HMAC_KEY", "AUDIT_KEY_MCP"])
      expect(mcp.vars, k).not.toHaveProperty(k);
  });
});
