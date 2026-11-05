import { beforeAll, describe, expect, it } from "vitest";
import { signOpsRequest } from "../../../packages/contracts/src/ops-auth.ts";
import {
  type BackupDeps,
  listBackups,
  pruneBackups,
  restoreBackup,
  runBackup,
} from "../../ops/src/backup.ts";
import { createApp } from "../src/index.ts";
import { ALPHA, as, json, type Loose, rawEnv, seed, tenantDo, testEnv, wsOf } from "./helpers.ts";

const HMAC = (rawEnv as unknown as Env).OPS_HMAC_KEY as string;
const BACKUP_KEY = "test-backup-key-0123456789abcdef0123456";

const deps = (
  over: Partial<BackupDeps> = {},
  apiEnv: Record<string, unknown> = {},
): BackupDeps => ({
  // Any R2 bucket works as the backup bucket in a test.
  BACKUPS: rawEnv.BLOBS,
  API: {
    fetch: (url: string, init: RequestInit) =>
      createApp().fetch(new Request(url, init), testEnv(apiEnv)),
  } as unknown as Fetcher,
  ENVIRONMENT: "staging",
  OPS_HMAC_KEY: HMAC,
  BACKUP_KEY,
  RESTORE_ENABLED: "yes",
  ...over,
});

beforeAll(async () => {
  await seed();
  await as("ceo", "/v1/personal/items", {
    body: { title: "Backup canary note", body: "canary-body-text" },
  });
});

describe("snapshot, encrypt, restore round trip", () => {
  it("writes one encrypted object per Durable Object and nothing readable", async () => {
    const r = await runBackup(deps());
    expect(r.objects).toBeGreaterThan(5);
    const list = await listBackups(deps());
    const keys = list.map((x) => x.key);
    expect(keys.some((k) => k.endsWith(`/${ALPHA}/tenant.jsonl.enc`))).toBe(true);
    expect(keys.some((k) => k.endsWith("/ws-personal:u_ceo.jsonl.enc"))).toBe(true);
    for (const k of keys) {
      const bytes = new Uint8Array(
        (await (await rawEnv.BLOBS.get(k))?.arrayBuffer()) as ArrayBuffer,
      );
      const text = new TextDecoder("latin1").decode(bytes);
      expect(text.startsWith("SBK1")).toBe(true);
      expect(text).not.toContain("canary");
      expect(text).not.toContain("example.invalid");
    }
  });

  it("restores a workspace and the tenant directory exactly", async () => {
    const date = new Date().toISOString().slice(0, 10);
    const wsKey = `${date}/${ALPHA}/ws-personal:u_ceo.jsonl.enc`;
    const tKey = `${date}/${ALPHA}/tenant.jsonl.enc`;
    const wsBefore = JSON.stringify(await wsOf(ALPHA, "personal:u_ceo").exportAll());
    const tBefore = JSON.stringify(await tenantDo(ALPHA).exportAll());
    // Damage both.
    await wsOf(ALPHA, "personal:u_ceo").wipe();
    await tenantDo(ALPHA).erasePrincipal("u_consultant");
    expect(JSON.stringify(await wsOf(ALPHA, "personal:u_ceo").exportAll())).not.toBe(wsBefore);

    const a = await restoreBackup(deps(), wsKey);
    const b = await restoreBackup(deps(), tKey);
    expect(a).toMatchObject({ ok: true, kind: "workspace", scope: "personal:u_ceo" });
    expect(b).toMatchObject({ ok: true, kind: "tenant" });
    expect(JSON.stringify(await wsOf(ALPHA, "personal:u_ceo").exportAll())).toBe(wsBefore);
    // Directory rows are back; the restore bumped the epoch so sessions are re-checked.
    const t = (await tenantDo(ALPHA).exportAll()) as Loose;
    const prev = JSON.parse(tBefore) as Loose;
    expect(t.principals).toEqual(prev.principals);
    expect(t.role_assignments).toEqual(prev.role_assignments);
    expect(t.revocation[0].epoch).toBeGreaterThan(prev.revocation[0].epoch);
    const notes = await json(await as("ceo", "/v1/personal/items"));
    expect(notes.some((n: Loose) => n.title === "Backup canary note")).toBe(true);
  });

  it("dry run decrypts without touching anything", async () => {
    const date = new Date().toISOString().slice(0, 10);
    const key = `${date}/${ALPHA}/ws-personal:u_ceo.jsonl.enc`;
    const before = JSON.stringify(await wsOf(ALPHA, "personal:u_ceo").exportAll());
    const r = await restoreBackup(deps(), key, true);
    expect(r).toMatchObject({ ok: true, dryRun: true });
    expect(JSON.stringify(await wsOf(ALPHA, "personal:u_ceo").exportAll())).toBe(before);
  });

  it("restore is off unless RESTORE_ENABLED is yes (prod default), on both sides", async () => {
    const key = `${new Date().toISOString().slice(0, 10)}/${ALPHA}/tenant.jsonl.enc`;
    expect(await restoreBackup(deps({ RESTORE_ENABLED: "no" }), key)).toEqual({
      ok: false,
      error: "restore_disabled",
    });
    // Even with the ops side on, the API refuses when its own flag is off.
    const r = await restoreBackup(deps({}, { RESTORE_ENABLED: "no" }), key);
    expect(r).toEqual({ ok: false, error: "api_refused" });
  });

  it("a wrong key, a renamed object or a flipped byte does not decrypt; the previous key does", async () => {
    const date = new Date().toISOString().slice(0, 10);
    const key = `${date}/${ALPHA}/ws-personal:u_ceo.jsonl.enc`;
    expect(
      await restoreBackup(deps({ BACKUP_KEY: "another-backup-key-0123456789abcdef0123" }), key),
    ).toEqual({ ok: false, error: "cannot_decrypt" });
    // Rotation: the new key is current, the old one is kept as BACKUP_KEY_PREVIOUS.
    const rotated = deps({
      BACKUP_KEY: "another-backup-key-0123456789abcdef0123",
      BACKUP_KEY_PREVIOUS: BACKUP_KEY,
    });
    expect(await restoreBackup(rotated, key, true)).toMatchObject({ ok: true });
    // Renamed: the object key is authenticated data.
    const obj = await rawEnv.BLOBS.get(key);
    const bytes = new Uint8Array(await (obj as R2ObjectBody).arrayBuffer());
    const other = `${date}/${ALPHA}/ws-renamed.jsonl.enc`;
    await rawEnv.BLOBS.put(other, bytes);
    expect(await restoreBackup(deps(), other, true)).toEqual({
      ok: false,
      error: "cannot_decrypt",
    });
    const flipped = bytes.slice();
    flipped[flipped.length - 3] = (flipped[flipped.length - 3] ?? 0) ^ 1;
    await rawEnv.BLOBS.put(key, flipped);
    expect(await restoreBackup(deps(), key, true)).toEqual({ ok: false, error: "cannot_decrypt" });
    await rawEnv.BLOBS.put(key, bytes);
    expect(await restoreBackup(deps(), `${date}/none.jsonl.enc`)).toEqual({
      ok: false,
      error: "not_found",
    });
    await rawEnv.BLOBS.delete(other);
  });

  it("refuses to run without a backup key", async () => {
    await expect(runBackup(deps({ BACKUP_KEY: undefined }))).rejects.toThrow();
  });
});

describe("prune: 35 day retention", () => {
  it("deletes snapshots dated before the cutoff and keeps the rest", async () => {
    const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    for (const n of [60, 36, 34, 1]) await rawEnv.BLOBS.put(`${day(n)}/t/x.jsonl.enc`, "x");
    const deleted = await pruneBackups(deps({ BACKUP_RETENTION_DAYS: "35" }));
    expect(deleted).toBeGreaterThanOrEqual(2);
    const keys = (await listBackups(deps())).map((k) => k.key);
    expect(keys).not.toContain(`${day(60)}/t/x.jsonl.enc`);
    expect(keys).not.toContain(`${day(36)}/t/x.jsonl.enc`);
    expect(keys).toContain(`${day(34)}/t/x.jsonl.enc`);
    expect(keys).toContain(`${day(1)}/t/x.jsonl.enc`);
  });
});

describe("internal ops routes", () => {
  const url = (p: string) => `https://secondary.example.test${p}`;
  async function send(
    p: string,
    o: {
      method?: string;
      body?: string;
      key?: string;
      at?: number;
      headers?: Record<string, string>;
      now?: number;
    } = {},
  ) {
    const method = o.method ?? "GET";
    const h =
      o.key === "none"
        ? {}
        : await signOpsRequest({
            secret: o.key ?? HMAC,
            method,
            url: url(p),
            ...(o.body ? { body: o.body } : {}),
            ...(o.at ? { now: o.at } : {}),
          });
    const app = createApp({ now: () => o.now ?? Date.now() });
    return app.fetch(
      new Request(url(p), {
        method,
        headers: { ...h, ...(o.body ? { "Content-Type": "application/json" } : {}), ...o.headers },
        ...(o.body ? { body: o.body } : {}),
      }),
      testEnv(),
    );
  }

  it("needs a fresh valid signature and refuses public traffic", async () => {
    expect((await send("/v1/internal/ops/targets")).status).toBe(200);
    expect((await send("/v1/internal/ops/targets", { key: "none" })).status).toBe(401);
    expect(
      (await send("/v1/internal/ops/targets", { key: "wrong-key-0123456789abcdef0123456789" }))
        .status,
    ).toBe(401);
    expect(
      (await send("/v1/internal/ops/targets", { at: Math.floor(Date.now() / 1000) - 600 })).status,
    ).toBe(401);
    expect(
      (await send("/v1/internal/ops/targets", { headers: { "CF-Connecting-IP": "203.0.113.9" } }))
        .status,
    ).toBe(401);
    expect((await send("/v1/internal/ops/export?tenant=x&kind=tenant")).status).toBe(400);
  });

  it("an invalid snapshot is refused and leaves the object unchanged", async () => {
    const before = JSON.stringify(await wsOf(ALPHA, "personal:u_ceo").exportAll());
    for (const tables of [
      { items: [{ nope: 1 }] },
      { sqlite_master: [] },
      { items: [{ id: { a: 1 } }] },
      "x",
    ]) {
      const q = `/v1/internal/ops/restore?tenant=${ALPHA}&kind=workspace&scope=personal:u_ceo`;
      const res = await send(q, { method: "POST", body: JSON.stringify({ tables }) });
      expect(res.status, JSON.stringify(tables)).toBe(422);
    }
    expect(JSON.stringify(await wsOf(ALPHA, "personal:u_ceo").exportAll())).toBe(before);
  });
});

describe("retention job", () => {
  it("deletes briefs after 30 days and drafts after 90, keeps notes and fresh items", async () => {
    const make = (kind: string, title: string) =>
      as("consultant", "/v1/personal/items", { body: { title, kind } });
    await make("brief", "old brief");
    await make("draft", "old draft");
    await make("note", "old note");
    const labels = async () =>
      ((await wsOf(ALPHA, "personal:u_consultant").listByKind("personalitem", 200)) as Loose[]).map(
        (i) => i.label,
      );
    const run = async (days: number) =>
      (await json(
        await (async () => {
          const body = "{}";
          const p = "/v1/internal/ops/retention";
          const now = Date.now() + days * 86_400_000;
          const h = await signOpsRequest({
            secret: HMAC,
            method: "POST",
            url: `https://secondary.example.test${p}`,
            body,
            now: Math.floor(now / 1000),
          });
          return createApp({ now: () => now }).fetch(
            new Request(`https://secondary.example.test${p}`, {
              method: "POST",
              headers: { ...h, "Content-Type": "application/json" },
              body,
            }),
            testEnv(),
          );
        })(),
      )) as Loose;
    expect(await labels()).toEqual(expect.arrayContaining(["old brief", "old draft", "old note"]));
    await run(10);
    expect(await labels()).toEqual(expect.arrayContaining(["old brief", "old draft", "old note"]));
    await run(40);
    let l = await labels();
    expect(l).not.toContain("old brief");
    expect(l).toContain("old draft");
    await run(100);
    l = await labels();
    expect(l).not.toContain("old draft");
    expect(l).toContain("old note");
  });
});

describe("M-02: every restore is on the audit record", () => {
  const date = () => new Date().toISOString().slice(0, 10);

  it("leaves a receipt before and after, naming who asked, and refuses when the audit worker is down", async () => {
    await runBackup(deps());
    const key = `${date()}/${ALPHA}/ws-personal:u_ceo.jsonl.enc`;
    const before = JSON.stringify(await wsOf(ALPHA, "personal:u_ceo").exportAll());

    // Audit down: the API refuses, and the workspace is not touched.
    await wsOf(ALPHA, "personal:u_ceo").wipe();
    const down = { AUDIT: { fetch: async () => new Response("down", { status: 503 }) } };
    expect(await restoreBackup(deps({}, down), key, false, "0123456789abcdef")).toEqual({
      ok: false,
      error: "api_refused",
    });
    expect(JSON.stringify(await wsOf(ALPHA, "personal:u_ceo").exportAll())).not.toBe(before);

    // Audit up: restored, with two receipts under the actor's handle.
    const r = await restoreBackup(deps(), key, false, "0123456789abcdef");
    expect(r).toMatchObject({ ok: true, kind: "workspace" });
    expect(JSON.stringify(await wsOf(ALPHA, "personal:u_ceo").exportAll())).toBe(before);
    const rec = (
      (await json(
        await as("auditor", "/v1/audit/receipts?principal=ops:0123456789abcdef"),
      )) as Loose
    ).receipts as Loose[];
    expect(rec.map((x) => x.action).sort()).toEqual(["ops_restore", "ops_restore_done"]);
    expect(rec.every((x) => x.scopeId === "personal:u_ceo" && x.decision === "allow")).toBe(true);
    // Ids and counts only.
    expect(JSON.stringify(rec)).not.toContain("canary");
  });

  it("an actor handle that is not a handle is recorded as unknown", async () => {
    const key = `${date()}/${ALPHA}/ws-personal:u_ceo.jsonl.enc`;
    expect(await restoreBackup(deps(), key, false, "<script>")).toMatchObject({ ok: true });
    const rec = (
      (await json(await as("auditor", "/v1/audit/receipts?principal=ops:unknown"))) as Loose
    ).receipts as Loose[];
    expect(rec.length).toBeGreaterThanOrEqual(2);
  });
});
