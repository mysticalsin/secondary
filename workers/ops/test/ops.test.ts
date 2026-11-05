import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { verifyOpsRequest } from "../../../packages/contracts/src/ops-auth.ts";
import { fromJsonl, runBackup, toJsonl } from "../src/backup.ts";
import { decryptBackup, encryptBackup } from "../src/crypto.ts";

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
        INTERNAL_HMAC_KEY: env.INTERNAL_HMAC_KEY,
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
      INTERNAL_HMAC_KEY: env.INTERNAL_HMAC_KEY,
      BACKUP_KEY: KEY,
    });
    expect(await verifyOpsRequest(seen as unknown as Request, env.INTERNAL_HMAC_KEY)).toBe(true);
  });
});
