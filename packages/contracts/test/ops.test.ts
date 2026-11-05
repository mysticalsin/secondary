import { describe, expect, it, vi } from "vitest";
import { buildLogLine, logEvent, principalHash, redact } from "../src/log.ts";
import { signOpsRequest, verifyOpsRequest } from "../src/ops-auth.ts";

const SECRET = "test-ops-secret-0123456789abcdef0123456789";
const URL_ = "https://api.internal/v1/internal/ops/export?tenant=t1";

describe("ops-auth", () => {
  it("accepts a fresh signature and binds method, path, query and body", async () => {
    const h = await signOpsRequest({ secret: SECRET, method: "POST", url: URL_, body: "{}" });
    const ok = (url: string, method: string, body: string, headers = h) =>
      verifyOpsRequest(new Request(url, { method, body, headers }), SECRET);
    expect(await ok(URL_, "POST", "{}")).toBe(true);
    expect(await ok(URL_, "POST", "{ }")).toBe(false);
    expect(await ok(`${URL_}x`, "POST", "{}")).toBe(false);
    expect(await ok(URL_, "PUT", "{}")).toBe(false);
  });
  it("rejects stale, wrong-key, short-key and unsigned requests", async () => {
    const now = 1_800_000_000;
    const h = await signOpsRequest({ secret: SECRET, method: "GET", url: URL_, now });
    const req = () => new Request(URL_, { headers: h });
    expect(await verifyOpsRequest(req(), SECRET, { now: now + 30 })).toBe(true);
    expect(await verifyOpsRequest(req(), SECRET, { now: now + 61 })).toBe(false);
    expect(await verifyOpsRequest(req(), `${SECRET}x`, { now })).toBe(false);
    expect(await verifyOpsRequest(req(), "short", { now })).toBe(false);
    expect(await verifyOpsRequest(req(), undefined, { now })).toBe(false);
    expect(await verifyOpsRequest(new Request(URL_), SECRET)).toBe(false);
    await expect(signOpsRequest({ secret: "short", method: "GET", url: URL_ })).rejects.toThrow();
  });
});

describe("structured log redaction", () => {
  const JWT = "eyJhbGciOiJSUzI1NiJ9.eyJlbWFpbCI6ImFAYi5jIn0.c2lnbmF0dXJlLXZhbHVl";
  it("drops non-allowlisted keys, so content cannot ride along", () => {
    const line = buildLogLine({
      event: "request",
      status: 200,
      body: "private note about Acme pricing",
      email: "a@example.invalid",
      authorization: `Bearer ${JWT}`,
    });
    expect(Object.keys(line).sort()).toEqual(["at", "event", "status"]);
  });
  it("redacts emails, JWTs, bearer tokens and long opaque values inside allowed keys", () => {
    for (const v of [
      "failed for alice@example.invalid",
      `bad token ${JWT}`,
      "Bearer abc.def.ghi",
      "secret=hunter2hunter2",
      "x".repeat(60),
    ]) {
      const out = redact(v);
      expect(out).not.toMatch(/@example|eyJ|abc\.def|hunter2|xxxxxxxxxx/);
    }
  });
  it("logEvent prints one JSON line with no leaked value", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    logEvent({ event: "x", reason: `user bob@example.invalid sent ${JWT}`, route: "/v1/me" });
    const printed = String(spy.mock.calls[0]?.[0]);
    spy.mockRestore();
    expect(printed).not.toContain("bob@");
    expect(printed).not.toContain("eyJ");
    expect(JSON.parse(printed).route).toBe("/v1/me");
  });
  it("principalHash is stable, short and not the id", async () => {
    const h = await principalHash("u_ceo");
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(h).toBe(await principalHash("u_ceo"));
    expect(h).not.toBe(await principalHash("u_cfo"));
  });
});
