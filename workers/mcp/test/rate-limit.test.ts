// B1 L4: /register, /token and /authorize are rate limited per client address, and open client
// registration cannot grow OAUTH_KV without bound (a per-address and a global daily cap).

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { BASE, envWith, REDIRECT, send } from "./helpers.ts";

const reg = (e: Env, ip: string | null, n = 0) =>
  send(
    new Request(`${BASE}/register`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(ip ? { "cf-connecting-ip": ip } : {}),
      },
      body: JSON.stringify({
        client_name: `Host ${n}`,
        redirect_uris: [REDIRECT],
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    }),
    e,
  );

const statuses = async (n: number, f: (i: number) => Promise<Response>) =>
  Promise.all(Array.from({ length: n }, (_, i) => i)).then(async () => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push((await f(i)).status);
    return out;
  });

describe("L4: rate limits on the OAuth endpoints", () => {
  it("/register: past the per-minute cap an address gets 429 with Retry-After; others are not affected", async () => {
    const e = envWith({ OAUTH_REGISTER_PER_MIN: "3" });
    const a = await statuses(5, (i) => reg(e, "198.51.100.10", i));
    expect(a).toEqual([201, 201, 201, 429, 429]);
    const limited = await reg(e, "198.51.100.10", 9);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await limited.json()) as unknown).toEqual({ error: "rate_limited" });
    expect((await reg(e, "198.51.100.11", 1)).status).toBe(201);
  });

  it("/register: a per-address and a global daily cap bound the registrations that stay in KV", async () => {
    const perIp = envWith({ OAUTH_REGISTER_PER_MIN: "100", OAUTH_REGISTER_PER_DAY: "2" });
    expect(await statuses(3, (i) => reg(perIp, "198.51.100.20", i))).toEqual([201, 201, 429]);
    const global = envWith({
      OAUTH_REGISTER_PER_MIN: "100",
      OAUTH_REGISTER_PER_DAY: "100",
      OAUTH_REGISTER_GLOBAL_PER_DAY: "2",
    });
    const out = await statuses(3, (i) => reg(global, `198.51.100.${30 + i}`, i));
    expect(out.filter((s) => s === 201).length).toBeLessThanOrEqual(2);
    expect(out).toContain(429);
  });

  it("/token and /authorize are limited per address too", async () => {
    const e = envWith({ OAUTH_TOKEN_PER_MIN: "2", OAUTH_AUTHORIZE_PER_MIN: "2" });
    const token = (ip: string) =>
      send(
        new Request(`${BASE}/token`, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "cf-connecting-ip": ip,
          },
          body: new URLSearchParams({ grant_type: "authorization_code", code: "x" }),
        }),
        e,
      );
    const t = await statuses(4, () => token("198.51.100.40"));
    expect(t.slice(2)).toEqual([429, 429]);
    expect(t.slice(0, 2).every((s) => s !== 429)).toBe(true);
    const authorize = (ip: string) =>
      send(
        new Request(`${BASE}/authorize?client_id=x`, { headers: { "cf-connecting-ip": ip } }),
        e,
      );
    const a = await statuses(4, () => authorize("198.51.100.41"));
    expect(a.slice(2)).toEqual([429, 429]);
  });

  it("traffic without a Cloudflare address (service bindings, local runs) is not counted, and other paths are untouched", async () => {
    const e = envWith({ OAUTH_REGISTER_PER_MIN: "1" });
    expect(await statuses(3, (i) => reg(e, null, i))).toEqual([201, 201, 201]);
    for (let i = 0; i < 5; i++)
      expect(
        (
          await send(
            new Request(`${BASE}/health`, { headers: { "cf-connecting-ip": "198.51.100.50" } }),
            e,
          )
        ).status,
      ).toBe(200);
  });

  it("keeps no raw address in KV", async () => {
    const e = envWith({ OAUTH_REGISTER_PER_MIN: "5" });
    await reg(e, "198.51.100.60", 1);
    const keys = (
      await (env as unknown as { OAUTH_KV: KVNamespace }).OAUTH_KV.list({ prefix: "rl:" })
    ).keys;
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(k.name).not.toContain("198.51.100.60");
  });
});
