import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetReadinessCache } from "../src/observe.ts";
import { onError } from "../src/security.ts";
import { as, call, json, type Loose, seed, sign } from "./helpers.ts";

beforeAll(async () => {
  await seed();
});
beforeEach(() => resetReadinessCache());

/** Every JSON line the app printed while `run` executed. */
async function captureLogs(run: () => Promise<unknown>): Promise<Loose[]> {
  const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    await run();
    return [...spy.mock.calls, ...err.mock.calls].flatMap(([l]) => {
      try {
        return [JSON.parse(String(l))];
      } catch {
        return [];
      }
    });
  } finally {
    spy.mockRestore();
    err.mockRestore();
  }
}

describe("structured request log", () => {
  it("logs request id, principal hash, route pattern, status and latency", async () => {
    const lines = await captureLogs(() => as("ceo", "/v1/me"));
    const l = lines.find((x) => x.event === "request");
    expect(l).toMatchObject({ worker: "api", route: "/v1/me", method: "GET", status: 200 });
    expect(l?.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(l?.principal).toMatch(/^[0-9a-f]{16}$/);
    expect(typeof l?.latencyMs).toBe("number");
  });

  it("logs a null principal for an unauthenticated request", async () => {
    const lines = await captureLogs(() => call("/v1/me"));
    expect(lines.find((x) => x.event === "request")).toMatchObject({
      status: 401,
      principal: null,
    });
  });

  it("never logs emails, tokens, query strings, ids from the path or bodies", async () => {
    const email = "very.secret.person@example.invalid";
    const token = await sign(email);
    const lines = await captureLogs(async () => {
      await as("ceo", `/v1/nodes/${email}?q=hunter2-private-search`);
      await as("consultant", "/v1/personal/items", {
        email,
        body: { title: "Confidential pricing for Acme", body: "Call +33 6 12 34 56 78" },
      });
      await call("/v1/me", { token, headers: { Authorization: `Bearer ${token}` } });
      await call("/v1/me", { token: "eyJhbGciOiJSUzI1NiJ9.eyJmb28iOiJiYXIifQ.sig-sig-sig" });
    });
    expect(lines.length).toBeGreaterThanOrEqual(4);
    const all = JSON.stringify(lines);
    for (const secret of [
      email,
      "very.secret",
      token,
      "eyJ",
      "hunter2",
      "Confidential",
      "Acme",
      "+33",
      "Bearer",
    ])
      expect(all, secret).not.toContain(secret);
    // Only the allowlisted keys ever appear.
    const keys = new Set(lines.flatMap((l) => Object.keys(l)));
    for (const k of keys)
      expect([
        "at",
        "event",
        "worker",
        "env",
        "requestId",
        "principal",
        "tenant",
        "route",
        "method",
        "status",
        "latencyMs",
      ]).toContain(k);
    // The route is a pattern, so the path parameter is not in it.
    expect(lines.some((l) => l.route === "/v1/nodes/:id")).toBe(true);
  });

  it("onError logs the error class and a redacted message, and answers with a request id only", async () => {
    const lines = await captureLogs(async () => {
      const res = onError(
        new TypeError("failed for bob@example.invalid with Bearer abc123def456"),
        {
          get: () => "11111111-1111-4111-8111-111111111111",
          json: (b: unknown, s: number) => Response.json(b, { status: s }),
        } as never,
      );
      expect(res.status).toBe(500);
      expect(await res.text()).not.toContain("bob@");
    });
    const l = lines.find((x) => x.event === "error");
    expect(l?.errorName).toBe("TypeError");
    expect(JSON.stringify(l)).not.toMatch(/bob@|abc123def456/);
    expect(l).not.toHaveProperty("stack");
  });
});

describe("GET /v1/ready", () => {
  it("is public, answers 200 with both checks ok and carries no data", async () => {
    const res = await call("/v1/ready");
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ready: true, checks: { do: "ok", r2: "ok" } });
  });

  it("answers 503 when R2 is unreachable and names the failing check", async () => {
    const broken = {
      head: async () => {
        throw new Error("r2 down");
      },
    };
    const res = await call("/v1/ready", { env: { BLOBS: broken } });
    expect(res.status).toBe(503);
    expect(await json(res)).toEqual({ ready: false, checks: { do: "ok", r2: "fail" } });
  });

  it("answers 503 when the Durable Object is unreachable", async () => {
    const stub = { epoch: () => Promise.reject(new Error("do down")) };
    const ns = { idFromName: () => "x", get: () => stub, jurisdiction: () => ns };
    const res = await call("/v1/ready", { env: { TENANT_POLICY: ns } });
    expect(res.status).toBe(503);
    expect((await json(res)).checks).toEqual({ do: "fail", r2: "ok" });
  });
});
