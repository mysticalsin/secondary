// B2 M-02: outside dev a restore needs two people. One asks, a different one confirms the same snapshot,
// and both steps are on the audit record. Restore stays off unless RESTORE_ENABLED is yes.

import { beforeAll, describe, expect, it } from "vitest";
import { type BackupDeps, restoreBackup, runBackup } from "../../ops/src/backup.ts";
import { createApp } from "../src/index.ts";
import { ALPHA, as, json, type Loose, rawEnv, seed, testEnv, wsOf } from "./helpers.ts";

const HMAC = (rawEnv as unknown as Env).OPS_HMAC_KEY as string;
const BACKUP_KEY = "test-backup-key-0123456789abcdef0123456";
const ALICE = "aaaaaaaaaaaaaaaa";
const BOB = "bbbbbbbbbbbbbbbb";

const deps = (apiEnv: Record<string, unknown> = { ENVIRONMENT: "staging" }): BackupDeps => ({
  BACKUPS: rawEnv.BLOBS,
  API: {
    fetch: (url: string, init: RequestInit) =>
      createApp().fetch(new Request(url, init), testEnv(apiEnv)),
  } as unknown as Fetcher,
  ENVIRONMENT: "staging",
  OPS_HMAC_KEY: HMAC,
  BACKUP_KEY,
  RESTORE_ENABLED: "yes",
});

const date = () => new Date().toISOString().slice(0, 10);
const wsKey = `${date()}/${ALPHA}/ws-personal:u_ceo.jsonl.enc`;
const otherKey = `${date()}/${ALPHA}/ws-personal:u_consultant.jsonl.enc`;
const actions = async (handle: string) =>
  (
    ((await json(await as("auditor", `/v1/audit/receipts?principal=ops:${handle}`))) as Loose)
      .receipts as Loose[]
  ).map((r) => r.action);

let before = "";

beforeAll(async () => {
  await seed();
  await as("ceo", "/v1/personal/items", { body: { title: "Restore canary", body: "x" } });
  await as("consultant", "/v1/personal/items", { body: { title: "Other canary", body: "y" } });
  await runBackup(deps());
  before = JSON.stringify(await wsOf(ALPHA, "personal:u_ceo").exportAll());
});

describe("M-02: two people for a staging or prod restore", () => {
  it("the first request only records, the same person cannot confirm, a different one does", async () => {
    await wsOf(ALPHA, "personal:u_ceo").wipe();
    const damaged = JSON.stringify(await wsOf(ALPHA, "personal:u_ceo").exportAll());

    const first = await restoreBackup(deps(), wsKey, false, ALICE);
    expect(first).toMatchObject({ ok: true, pending: true });
    expect(JSON.stringify(await wsOf(ALPHA, "personal:u_ceo").exportAll())).toBe(damaged);
    expect(await actions(ALICE)).toEqual(["ops_restore_request"]);

    expect(await restoreBackup(deps(), wsKey, false, ALICE)).toEqual({
      ok: false,
      error: "same_person",
    });
    expect(JSON.stringify(await wsOf(ALPHA, "personal:u_ceo").exportAll())).toBe(damaged);

    const second = await restoreBackup(deps(), wsKey, false, BOB);
    expect(second).toMatchObject({ ok: true, kind: "workspace" });
    expect((second as Loose).pending).toBeUndefined();
    expect(JSON.stringify(await wsOf(ALPHA, "personal:u_ceo").exportAll())).toBe(before);
    expect((await actions(BOB)).sort()).toEqual(["ops_restore", "ops_restore_done"]);
    const receipts = (
      ((await json(await as("auditor", `/v1/audit/receipts?principal=ops:${BOB}`))) as Loose)
        .receipts as Loose[]
    ).find((r) => r.action === "ops_restore");
    expect(receipts?.reason).toContain(`ops:${ALICE}`);
  });

  it("a confirmation is for the same snapshot only, and a request is used up once", async () => {
    await wsOf(ALPHA, "personal:u_ceo").wipe();
    expect(await restoreBackup(deps(), wsKey, false, ALICE)).toMatchObject({ pending: true });
    // Bob confirms a different snapshot: that is only a new first request.
    expect(await restoreBackup(deps(), otherKey, false, BOB)).toMatchObject({ pending: true });
    expect(JSON.stringify(await wsOf(ALPHA, "personal:u_ceo").exportAll())).not.toBe(before);
    expect(await restoreBackup(deps(), wsKey, false, BOB)).toMatchObject({ ok: true });
    // The approval was consumed: the next restore of it starts again.
    expect(await restoreBackup(deps(), wsKey, false, BOB)).toMatchObject({ pending: true });
  });

  it("outside dev an actor without an Access handle is refused", async () => {
    expect(await restoreBackup(deps(), wsKey, false, "key")).toEqual({
      ok: false,
      error: "actor_required",
    });
  });

  it("stays off by default and a dry run needs nobody", async () => {
    const off = { ...deps(), RESTORE_ENABLED: "no" };
    expect(await restoreBackup(off, wsKey, false, ALICE)).toEqual({
      ok: false,
      error: "restore_disabled",
    });
    expect(await restoreBackup(deps(), wsKey, true, ALICE)).toMatchObject({ dryRun: true });
  });

  it("dev keeps the single-step restore", async () => {
    await wsOf(ALPHA, "personal:u_ceo").wipe();
    const r = await restoreBackup(deps({ ENVIRONMENT: "dev" }), wsKey, false, ALICE);
    expect(r).toMatchObject({ ok: true });
    expect((r as Loose).pending).toBeUndefined();
  });
});
