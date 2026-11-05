import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { verifyOpsRequest } from "../../../packages/contracts/src/ops-auth.ts";
import { fromJsonl, restoreBackup, runBackup, toJsonl } from "../src/backup.ts";
import { decryptBackup, encryptBackup } from "../src/crypto.ts";
import { createOpsApp } from "../src/index.ts";

const KEY = "test-backup-key-0123456789abcdef0123456";
const call = (
  path: string,
  init: RequestInit = {},
  key: string | null = env.OPS_ADMIN_KEY ?? null,
) =>
  exports.default.fetch(
    new Request(`https://ops.test${path}`, {
      ...init,
      headers: { ...(key ? { "X-Ops-Key": key } : {}), "Content-Type": "application/json" },
    }),
  );

describe("backup crypto", () => {
  const plain = new TextEncoder().encode("hello snapshot") as Uint8Array<ArrayBuffer>;
  it("round-trips, binds the object key, and never repeats an IV", async () => {
    const a = await encryptBackup(KEY, "k1", plain);
    const b = await encryptBackup(KEY, "k1", plain);
    expect(a).not.toEqual(b);
    expect(new TextDecoder().decode((await decryptBackup([KEY], "k1", a)) as Uint8Array)).toBe(
      "hello snapshot",
    );
    expect(await decryptBackup([KEY], "k2", a)).toBeNull();
    expect(await decryptBackup(["x".repeat(40)], "k1", a)).toBeNull();
    expect(await decryptBackup(["x".repeat(40), KEY], "k1", a)).not.toBeNull();
    await expect(encryptBackup("short", "k", plain)).rejects.toThrow();
  });
  it("JSONL keeps every row", () => {
    const text = toJsonl({ v: 1 }, { items: [{ id: "a" }, { id: "b" }], comments: [] });
    expect(fromJsonl(text)).toEqual({
      meta: { v: 1 },
      tables: { items: [{ id: "a" }, { id: "b" }] },
    });
    expect(() => fromJsonl('{"x":1}\n')).toThrow();
  });
});

describe("ops worker", () => {
  it("health is public; everything else needs the admin key", async () => {
    expect((await call("/health", {}, null)).status).toBe(200);
    for (const p of ["/snapshots", "/backup", "/restore"]) {
      expect((await call(p, { method: p === "/snapshots" ? "GET" : "POST" }, null)).status, p).toBe(
        401,
      );
      expect(
        (await call(p, { method: p === "/snapshots" ? "GET" : "POST" }, "wrong")).status,
        p,
      ).toBe(401);
    }
    expect((await call("/snapshots")).status).toBe(200);
  });
  it("restore validates the key shape", async () => {
    expect(
      (await call("/restore", { method: "POST", body: JSON.stringify({ key: "../x" }) })).status,
    ).toBe(400);
    expect(
      (
        await call("/restore", {
          method: "POST",
          body: JSON.stringify({ key: "2026-01-01/t/tenant.jsonl.enc" }),
        })
      ).status,
    ).toBe(404);
  });
  it("a backup fails closed when the API cannot be reached", async () => {
    const api = { fetch: async () => new Response("no", { status: 401 }) } as unknown as Fetcher;
    await expect(
      runBackup({
        BACKUPS: env.BACKUPS,
        API: api,
        ENVIRONMENT: "dev",
        OPS_HMAC_KEY: env.OPS_HMAC_KEY,
        BACKUP_KEY: KEY,
      }),
    ).rejects.toThrow();
  });
  it("signs its calls to the API", async () => {
    let seen: Request | null = null;
    const api = {
      fetch: async (u: string, i: RequestInit) => {
        seen = new Request(u, i);
        return Response.json({ tenants: [] });
      },
    } as unknown as Fetcher;
    await runBackup({
      BACKUPS: env.BACKUPS,
      API: api,
      ENVIRONMENT: "dev",
      OPS_HMAC_KEY: env.OPS_HMAC_KEY,
      BACKUP_KEY: KEY,
    });
    expect(await verifyOpsRequest(seen as unknown as Request, env.OPS_HMAC_KEY)).toBe(true);
  });
});

// ---- M-02: the admin surface sits behind Cloudflare Access outside dev ----

const TEAM = "acme-test.cloudflareaccess.com";
const AUD = "ops-aud-123";
const pair = (await crypto.subtle.generateKey(
  {
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  },
  true,
  ["sign", "verify"],
)) as CryptoKeyPair;
const stranger = (await crypto.subtle.generateKey(
  {
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  },
  true,
  ["sign", "verify"],
)) as CryptoKeyPair;
const jwk = {
  ...((await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey),
  kid: "a1",
  alg: "RS256",
};
const b64 = (b: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof b === "string" ? new TextEncoder().encode(b) : new Uint8Array(b);
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};
async function accessJwt(
  over: { aud?: string; iss?: string; exp?: number; key?: CryptoKeyPair } = {},
) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64(JSON.stringify({ alg: "RS256", kid: "a1", typ: "JWT" }));
  const p = b64(
    JSON.stringify({
      aud: [over.aud ?? AUD],
      iss: over.iss ?? `https://${TEAM}`,
      iat: now,
      exp: over.exp ?? now + 600,
      common_name: "ops-service-token",
    }),
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    (over.key ?? pair).privateKey,
    new TextEncoder().encode(`${h}.${p}`),
  );
  return `${h}.${p}.${b64(sig)}`;
}

describe("M-02: ops behind Cloudflare Access (staging, prod)", () => {
  const app = createOpsApp({ certs: async () => ({ keys: [jwk] }) });
  const staging = { ...env, ENVIRONMENT: "staging", ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
  const go = (e: Record<string, unknown>, headers: Record<string, string>) =>
    app.fetch(
      new Request("https://ops.test/snapshots", {
        headers: { "X-Ops-Key": env.OPS_ADMIN_KEY as string, ...headers },
      }),
      e as unknown as Env,
    );

  it("the admin key alone is not enough in staging", async () => {
    expect((await go(staging, {})).status).toBe(401);
  });

  it("a valid Access JWT plus the key is accepted; the key is still required", async () => {
    const jwt = await accessJwt();
    expect((await go(staging, { "Cf-Access-Jwt-Assertion": jwt })).status).toBe(200);
    const noKey = await app.fetch(
      new Request("https://ops.test/snapshots", { headers: { "Cf-Access-Jwt-Assertion": jwt } }),
      staging as unknown as Env,
    );
    expect(noKey.status).toBe(401);
  });

  it("wrong audience, wrong issuer, expired and foreign-key tokens are refused", async () => {
    const bad = [
      await accessJwt({ aud: "other" }),
      await accessJwt({ iss: "https://evil.cloudflareaccess.com" }),
      await accessJwt({ exp: Math.floor(Date.now() / 1000) - 600 }),
      await accessJwt({ key: stranger }),
      "not.a.jwt",
    ];
    for (const t of bad)
      expect((await go(staging, { "Cf-Access-Jwt-Assertion": t })).status).toBe(401);
  });

  it("while Access is not configured the admin routes do not exist outside dev", async () => {
    const jwt = await accessJwt();
    const unconfigured = { ...env, ENVIRONMENT: "staging", ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "" };
    expect((await go(unconfigured, { "Cf-Access-Jwt-Assertion": jwt })).status).toBe(404);
    expect((await go({ ...unconfigured, ENVIRONMENT: "prod" }, {})).status).toBe(404);
    // Health stays public.
    const h = await app.fetch(
      new Request("https://ops.test/health"),
      unconfigured as unknown as Env,
    );
    expect(h.status).toBe(200);
  });

  it("dev stays key-only", async () => {
    expect((await go({ ...env, ENVIRONMENT: "dev" }, {})).status).toBe(200);
  });
});

describe("restore guards", () => {
  it("L-05: a snapshot restores only into the environment that wrote it", async () => {
    const meta = { v: 1, env: "prod", tenant: "tenant_x", kind: "tenant", scope: "" };
    const key = "2026-11-05/tenant_x/tenant.jsonl.enc";
    const plain = new TextEncoder().encode(
      toJsonl(meta, { config: [] }),
    ) as Uint8Array<ArrayBuffer>;
    await env.BACKUPS.put(key, await encryptBackup(KEY, key, plain));
    const api = { fetch: async () => Response.json({ ok: true }) } as unknown as Fetcher;
    const d = {
      BACKUPS: env.BACKUPS,
      API: api,
      ENVIRONMENT: "staging",
      OPS_HMAC_KEY: env.OPS_HMAC_KEY,
      BACKUP_KEY: KEY,
      RESTORE_ENABLED: "yes",
    };
    expect(await restoreBackup(d, key, true)).toEqual({ ok: false, error: "wrong_environment" });
    expect((await restoreBackup({ ...d, ENVIRONMENT: "prod" }, key, true)).ok).toBe(true);
  });

  it("M-02: restore is off unless RESTORE_ENABLED is exactly yes", async () => {
    const d = {
      BACKUPS: env.BACKUPS,
      API: {} as Fetcher,
      ENVIRONMENT: "staging",
      OPS_HMAC_KEY: "x",
      BACKUP_KEY: KEY,
    };
    for (const v of [undefined, "no", "true", ""])
      expect(
        await restoreBackup({ ...d, RESTORE_ENABLED: v }, "2026-01-01/t/tenant.jsonl.enc"),
      ).toEqual({
        ok: false,
        error: "restore_disabled",
      });
  });
});
