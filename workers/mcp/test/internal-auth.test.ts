import { describe, expect, it } from "vitest";
import {
  base64urlEncode,
  HEADER_PRINCIPAL,
  HEADER_SIGNATURE,
  HEADER_TIMESTAMP,
  type InternalPrincipal,
  signInternalRequest,
  verifyInternalRequest,
} from "../src/internal-auth.ts";

const SECRET = "unit-test-secret-0123456789abcdef-0123456789";
const NOW = 1_800_000_000;
const URL_ = "https://api.internal/v1/nodes/c_bid%3Apricing?x=1";
const principal: InternalPrincipal = {
  v: 1,
  iss: "secondary-mcp",
  aud: "secondary-api",
  sub: "user-1",
  email: "alice@example.invalid",
  client_id: "client-1",
  scope: ["secondary.read"],
  tool: "get_node",
};

async function signed(
  over: { method?: string; url?: string; body?: string; p?: InternalPrincipal; now?: number } = {},
) {
  const method = over.method ?? "GET";
  const url = over.url ?? URL_;
  const headers = await signInternalRequest({
    secret: SECRET,
    method,
    url,
    body: over.body,
    principal: over.p ?? principal,
    now: over.now ?? NOW,
  });
  return { method, url, headers, body: over.body };
}
const req = (s: { method: string; url: string; headers: Record<string, string>; body?: string }) =>
  new Request(s.url, {
    method: s.method,
    headers: s.headers,
    ...(s.body === undefined ? {} : { body: s.body }),
  });
// secret: omitted = the right key, null = no key configured.
const verify = (r: Request, secret?: string | null, now = NOW) =>
  verifyInternalRequest(r, secret === null ? undefined : (secret ?? SECRET), { now });

describe("internal service auth", () => {
  it("round-trips the principal", async () => {
    const r = await verify(req(await signed()));
    expect(r).toEqual({ ok: true, principal });
  });

  it("round-trips a POST body and leaves it readable", async () => {
    const s = await signed({ method: "POST", body: '{"a":1}' });
    const request = req(s);
    expect((await verify(request)).ok).toBe(true);
    expect(await request.text()).toBe('{"a":1}');
  });

  it("fails closed without a usable secret", async () => {
    const request = req(await signed());
    expect(await verify(request, null)).toEqual({ ok: false, reason: "no_secret" });
    expect(await verify(request, "")).toEqual({ ok: false, reason: "no_secret" });
    expect(await verify(request, "short")).toEqual({ ok: false, reason: "no_secret" });
    await expect(
      signInternalRequest({ secret: "short", method: "GET", url: URL_, principal }),
    ).rejects.toThrow();
  });

  it("rejects missing headers", async () => {
    for (const h of [HEADER_PRINCIPAL, HEADER_TIMESTAMP, HEADER_SIGNATURE]) {
      const s = await signed();
      delete s.headers[h];
      expect(await verify(req(s))).toEqual({ ok: false, reason: "missing_headers" });
    }
    expect(await verify(new Request(URL_))).toEqual({ ok: false, reason: "missing_headers" });
  });

  it("rejects an unknown signature version and a malformed timestamp", async () => {
    const s = await signed();
    s.headers[HEADER_SIGNATURE] = (s.headers[HEADER_SIGNATURE] as string).replace("v1=", "v2=");
    expect(await verify(req(s))).toEqual({ ok: false, reason: "bad_version" });
    const t = await signed();
    t.headers[HEADER_TIMESTAMP] = "12abc";
    expect(await verify(req(t))).toEqual({ ok: false, reason: "bad_timestamp" });
  });

  it("enforces the 60 second skew in both directions", async () => {
    const s = await signed({ now: NOW });
    expect((await verify(req(s), SECRET, NOW + 60)).ok).toBe(true);
    expect((await verify(req(s), SECRET, NOW - 60)).ok).toBe(true);
    expect(await verify(req(s), SECRET, NOW + 61)).toEqual({
      ok: false,
      reason: "stale_timestamp",
    });
    expect(await verify(req(s), SECRET, NOW - 61)).toEqual({
      ok: false,
      reason: "stale_timestamp",
    });
  });

  it("rejects a wrong key and a garbled signature", async () => {
    const request = req(await signed());
    expect(await verify(request, "another-secret-0123456789abcdef-0123456789")).toEqual({
      ok: false,
      reason: "bad_signature",
    });
    const s = await signed();
    s.headers[HEADER_SIGNATURE] = "v1=zz";
    expect(await verify(req(s))).toEqual({ ok: false, reason: "bad_signature" });
    s.headers[HEADER_SIGNATURE] = "v1=";
    expect(await verify(req(s))).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("binds method, path, query and body", async () => {
    const s = await signed({ method: "POST", body: '{"a":1}' });
    expect(await verify(req({ ...s, body: '{"a":2}' }))).toEqual({
      ok: false,
      reason: "bad_signature",
    });
    expect(await verify(req({ ...s, method: "PUT" }))).toEqual({
      ok: false,
      reason: "bad_signature",
    });
    expect(await verify(req({ ...s, url: s.url.replace("c_bid", "c_hr") }))).toEqual({
      ok: false,
      reason: "bad_signature",
    });
    expect(await verify(req({ ...s, url: `${s.url}&y=2` }))).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects a tampered or substituted principal", async () => {
    const a = await signed();
    const b = await signed({ p: { ...principal, email: "mallory@example.invalid" } });
    a.headers[HEADER_PRINCIPAL] = b.headers[HEADER_PRINCIPAL] as string;
    expect(await verify(req(a))).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a validly signed principal with the wrong shape", async () => {
    const bad: unknown[] = [
      { ...principal, iss: "someone-else" },
      { ...principal, aud: "other-service" },
      { ...principal, v: 2 },
      { ...principal, sub: "" },
      { ...principal, email: undefined },
      { ...principal, scope: "secondary.read" },
    ];
    for (const p of bad) {
      const s = await signed({ p: p as InternalPrincipal });
      expect(await verify(req(s))).toEqual({ ok: false, reason: "bad_principal" });
    }
  });

  it("rejects a signed non-JSON principal", async () => {
    const secretKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const principalHeader = base64urlEncode(new TextEncoder().encode("not json"));
    const empty = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array())),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    const data = ["v1", String(NOW), "GET", "/v1/me", empty, principalHeader].join("\n");
    const sig = Array.from(
      new Uint8Array(await crypto.subtle.sign("HMAC", secretKey, new TextEncoder().encode(data))),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    const r = new Request("https://api.internal/v1/me", {
      headers: {
        [HEADER_PRINCIPAL]: principalHeader,
        [HEADER_TIMESTAMP]: String(NOW),
        [HEADER_SIGNATURE]: `v1=${sig}`,
      },
    });
    expect(await verify(r)).toEqual({ ok: false, reason: "bad_principal" });
  });
});
