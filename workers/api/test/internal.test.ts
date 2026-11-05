import { beforeAll, describe, expect, it } from "vitest";
import { type InternalPrincipal, signInternalRequest } from "../src/internal-auth.ts";
import { call, json, rawEnv, seed, sign } from "./helpers.ts";

beforeAll(async () => {
  await seed();
});

const KEY = (rawEnv as unknown as Env).INTERNAL_HMAC_KEY as string;
const principal = (over: Partial<InternalPrincipal> = {}): InternalPrincipal => ({
  v: 1,
  iss: "secondary-mcp",
  aud: "secondary-api",
  sub: "sub-1",
  email: "ceo@example.invalid",
  client_id: "claude.ai",
  scope: ["secondary.read", "secondary.personal.write", "secondary.contribute"],
  tool: "search",
  ...over,
});

interface Opts {
  method?: string;
  body?: unknown;
  p?: Partial<InternalPrincipal>;
  key?: string;
  at?: number;
  env?: Record<string, unknown>;
  headers?: Record<string, string>;
}
/** Sign a request the way workers/mcp does, then send it to the API. */
async function internal(path: string, o: Opts = {}) {
  const url = `https://secondary.example.test${path}`;
  const rawBody = o.body === undefined ? undefined : JSON.stringify(o.body);
  const method = o.method ?? (rawBody === undefined ? "GET" : "POST");
  const sec = Math.floor((o.at ?? Date.now()) / 1000);
  const headers = await signInternalRequest({
    secret: o.key ?? KEY,
    method,
    url,
    ...(rawBody === undefined ? {} : { body: rawBody }),
    principal: principal(o.p),
    now: sec,
  });
  return call(path, {
    method,
    token: null,
    ...(rawBody === undefined ? {} : { rawBody }),
    headers: { ...headers, ...o.headers },
    ...(o.env ? { env: o.env } : {}),
  });
}

describe("internal service auth (workers/mcp to workers/api)", () => {
  it("a valid signature signs the person in by email, like an Access JWT", async () => {
    const res = await internal("/v1/me");
    expect(res.status).toBe(200);
    const me = await json(res);
    expect(me.principal).toMatchObject({ email: "ceo@example.invalid", roleIds: ["ceo"] });
    expect((await internal("/v1/map?lens=departments")).status).toBe(200);
    expect((await internal("/v1/search?q=pricing")).status).toBe(200);
  });

  it("a bad signature is 401 and never falls through to Access or the persona header", async () => {
    const jwt = await sign("ceo@example.invalid");
    const cases: [string, Promise<Response>][] = [
      ["wrong key", internal("/v1/me", { key: "x".repeat(40) })],
      ["stale", internal("/v1/me", { at: Date.now() - 120_000 })],
      ["future", internal("/v1/me", { at: Date.now() + 120_000 })],
      [
        "valid JWT beside a bad signature",
        internal("/v1/me", { key: "y".repeat(40), headers: { "Cf-Access-Jwt-Assertion": jwt } }),
      ],
      [
        "persona header beside a bad signature",
        internal("/v1/me", { key: "y".repeat(40), headers: { "X-Demo-Persona": "ceo" } }),
      ],
    ];
    for (const [name, p] of cases) expect((await p).status, name).toBe(401);
  });

  it("detects tampering with path, query, body, principal and method", async () => {
    const url = "https://secondary.example.test/v1/search?q=a";
    const h = await signInternalRequest({
      secret: KEY,
      method: "GET",
      url,
      principal: principal(),
    });
    const send = (path: string, headers: Record<string, string>, method = "GET") =>
      call(path, { method, token: null, headers });
    expect((await send("/v1/search?q=a", h)).status).toBe(200);
    expect((await send("/v1/search?q=b", h)).status).toBe(401);
    expect((await send("/v1/map", h)).status).toBe(401);
    const other = await signInternalRequest({
      secret: KEY,
      method: "GET",
      url,
      principal: principal({ email: "auditor@example.invalid" }),
    });
    expect(
      (
        await send("/v1/search?q=a", {
          ...h,
          "x-secondary-principal": other["x-secondary-principal"] as string,
        })
      ).status,
    ).toBe(401);
    // Body swapped after signing.
    const body = JSON.stringify({ title: "a", kind: "note" });
    const hp = await signInternalRequest({
      secret: KEY,
      method: "POST",
      url: "https://secondary.example.test/v1/personal/items",
      body,
      principal: principal(),
    });
    const res = await call("/v1/personal/items", {
      token: null,
      rawBody: JSON.stringify({ title: "b", kind: "note" }),
      headers: hp,
    });
    expect(res.status).toBe(401);
  });

  it("internal headers are refused on public requests, and partial headers are refused", async () => {
    expect(
      (await internal("/v1/me", { headers: { "CF-Connecting-IP": "203.0.113.5" } })).status,
    ).toBe(401);
    expect(
      (await call("/v1/me", { token: null, headers: { "X-Secondary-Principal": "e30" } })).status,
    ).toBe(401);
    expect(
      (
        await call("/v1/me", {
          email: "ceo@example.invalid",
          headers: { "X-Secondary-Timestamp": "1" },
        })
      ).status,
    ).toBe(401);
  });

  it("is off without a configured key", async () => {
    expect((await internal("/v1/me", { env: { INTERNAL_HMAC_KEY: undefined } })).status).toBe(401);
    expect((await internal("/v1/me", { env: { INTERNAL_HMAC_KEY: "short" } })).status).toBe(401);
  });

  it("honours the persona only in dev, and ignores the X-Demo-Persona header", async () => {
    const dev = await json(
      await internal("/v1/me", {
        p: { email: "x@example.invalid", persona: "auditor" },
        headers: { "X-Demo-Persona": "ceo" },
      }),
    );
    expect(dev.persona).toBe("auditor");
    const prod = await json(
      await internal("/v1/me", {
        p: { email: "x@example.invalid", persona: "auditor" },
        env: { ENVIRONMENT: "prod" },
      }),
    );
    expect(prod.persona).toBeNull();
    expect(prod.principal.roleIds).toEqual([]);
  });

  it("allows only the MCP routes, with the right scope", async () => {
    const ok = [
      ["/v1/me"],
      ["/v1/map?lens=accounts"],
      ["/v1/nodes/core"],
      ["/v1/search?q=a"],
      ["/v1/accounts/a_acme"],
      ["/v1/governances"],
      ["/v1/review"],
    ];
    for (const [path] of ok)
      expect((await internal(path as string)).status, path).toBeLessThan(400);
    for (const path of [
      "/v1/accounts",
      "/v1/governances/g_lbc",
      "/v1/activity",
      "/v1/admin/roles",
      "/v1/admin/audit",
      "/v1/audit/receipts?principal=x",
      "/v1/personal/items",
      "/v1/personal/targets",
    ])
      expect(
        (await internal(path, { p: { email: "platform_admin@example.invalid" } })).status,
        path,
      ).toBe(403);
    // Never reachable: actions (so no approve, delete or membership change), seed.
    const act = await internal("/v1/actions", {
      body: { nodeId: "core", action: "comment", payload: { text: "x" } },
    });
    expect(act.status).toBe(403);
    // Seeding needs an Access identity plus its own token: internal headers do not open it.
    expect((await internal("/v1/admin/seed", { body: {} })).status).toBe(403);
    // Scopes.
    expect((await internal("/v1/map", { p: { scope: ["secondary.personal.write"] } })).status).toBe(
      403,
    );
    expect(
      (
        await internal("/v1/personal/items", {
          body: { kind: "note", title: "n" },
          p: { scope: ["secondary.read"] },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await internal("/v1/personal/items", {
          body: { kind: "note", title: "n" },
          p: { scope: ["secondary.personal.write"] },
        })
      ).status,
    ).toBe(201);
  });

  it("contribute works with its scope and the receipt records the MCP client and tool", async () => {
    const made = await json(
      await internal("/v1/personal/items", {
        body: { kind: "note", title: "From a host", body: "clean" },
        p: { tool: "personal_note_create" },
      }),
    );
    const res = await internal(`/v1/personal/items/${made.id}/contribute`, {
      body: {
        targetScopeId: "c_bid",
        user_validated: { by: "u_ceo", at: new Date().toISOString(), revision: made.revision },
      },
      p: { tool: "contribute", client_id: "chatgpt.com" },
    });
    expect(res.status).toBe(201);
    const receipts = await json(
      await call("/v1/audit/receipts?principal=u_ceo", {
        email: "auditor@example.invalid",
        persona: "auditor",
      }),
    );
    expect(receipts.receipts.find((r: { tool: string }) => r.tool === "contribute")).toMatchObject({
      clientId: "chatgpt.com",
      tool: "contribute",
      action: "contribute",
    });
  });

  it("rate limiting still counts the person", async () => {
    const hit = () =>
      internal("/v1/me", {
        p: { email: "rl-int@example.invalid" },
        env: { RATE_LIMIT_PER_MIN: "2" },
      });
    expect((await hit()).status).toBe(200);
    expect((await hit()).status).toBe(200);
    expect((await hit()).status).toBe(429);
  });
});
