// B2 security review M-03: the audit pass runs first, a restore cannot bring an erased person back,
// the connector forgets the person's cached read decisions, and the tombstone list is bounded.

import { runInDurableObject } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { BackupDeps } from "../../ops/src/backup.ts";
import { restoreBackup, runBackup } from "../../ops/src/backup.ts";
import { createApp } from "../src/index.ts";
import { pseudonymFor } from "../src/ops-rights.ts";
import { ALPHA, as, json, type Loose, rawEnv, seed, tenantDo, testEnv, wsOf } from "./helpers.ts";

const SUBJECT = "u_head_bid";
const ADMIN_A = { email: "erase-a@example.invalid" };
const ADMIN_B = { email: "erase-b@example.invalid" };
const HMAC = (rawEnv as unknown as Env).OPS_HMAC_KEY as string;
const BACKUP_KEY = "test-backup-key-0123456789abcdef0123456";

const erase = (principal: string, who = ADMIN_A, env?: Loose) =>
  as("platform_admin", "/v1/admin/rights/erase", {
    ...who,
    body: { principal },
    ...(env ? { env } : {}),
  });

const deps = (): BackupDeps => ({
  BACKUPS: rawEnv.BLOBS,
  API: {
    fetch: (url: string, init: RequestInit) =>
      createApp().fetch(new Request(url, init), testEnv({})),
  } as unknown as Fetcher,
  ENVIRONMENT: "staging",
  OPS_HMAC_KEY: HMAC,
  BACKUP_KEY,
  RESTORE_ENABLED: "yes",
});

let candidateId = "";

beforeAll(async () => {
  await seed();
  const note = await json(
    await as("head_bid", "/v1/personal/items", {
      body: { title: "Erasure canary note", body: "Nothing sensitive." },
    }),
  );
  const made = await as("head_bid", `/v1/personal/items/${note.id}/contribute`, {
    body: {
      targetScopeId: "c_bid",
      user_validated: { by: SUBJECT, at: new Date().toISOString(), revision: note.revision },
    },
  });
  expect(made.status).toBe(201);
  candidateId = (await json(made)).candidateId;
});

describe("M-03: the audit pass runs first", () => {
  it("when the audit worker is down nothing else was changed, so the erase can be asked for again", async () => {
    const failing = { AUDIT: { fetch: async () => new Response("down", { status: 503 }) } };
    await erase(SUBJECT, ADMIN_A, failing);
    const res = await erase(SUBJECT, ADMIN_B, failing);
    expect(res.status).toBe(502);
    // Company items still carry the real id, the Personal Brain is intact, the directory entry stays.
    const item = (await wsOf(ALPHA, "c_bid").get(candidateId)) as Loose;
    expect(item.authorId).toBe(SUBJECT);
    expect(
      (await wsOf(ALPHA, `personal:${SUBJECT}`).listByKind("personalitem", 100)).length,
    ).toBeGreaterThan(0);
    const dir = (await tenantDo(ALPHA).exportAll()) as Loose;
    expect(dir.principals.map((p: Loose) => p.id)).toContain(SUBJECT);
    // No tombstone either: nothing was erased.
    expect(await tenantDo(ALPHA).tombstoneList(Date.now())).toEqual([]);
  });
});

describe("M-03: a restore cannot bring an erased person back", () => {
  it("restoring older snapshots of the directory, a company workspace and the Personal Brain erases them again", async () => {
    const taken = await runBackup(deps());
    expect(taken.objects).toBeGreaterThan(5);
    const date = new Date().toISOString().slice(0, 10);
    const keys = {
      tenant: `${date}/${ALPHA}/tenant.jsonl.enc`,
      bid: `${date}/${ALPHA}/ws-c_bid.jsonl.enc`,
      personal: `${date}/${ALPHA}/ws-personal:${SUBJECT}.jsonl.enc`,
    };
    const pz = (await pseudonymFor(testEnv(), ALPHA, SUBJECT)) as string;

    // Erase with the connector reachable: it is asked to forget the person.
    const forgotten: string[] = [];
    const connector = {
      CONNECTOR: {
        fetch: async (url: string) => {
          forgotten.push(new URL(url).pathname);
          return Response.json({ ok: true, removed: 0 });
        },
      },
    };
    expect((await erase(SUBJECT, ADMIN_A, connector)).status).toBe(202);
    const done = await erase(SUBJECT, ADMIN_B, connector);
    expect(done.status).toBe(200);
    const out = (await json(done)) as Loose;
    expect(out.connectorCacheForgotten).toBe(true);
    expect(forgotten).toEqual(["/internal/acl/forget"]);

    const tombs = await tenantDo(ALPHA).tombstoneList(Date.now());
    expect(tombs).toHaveLength(1);
    expect(tombs[0]).toMatchObject({ principalId: SUBJECT, pseudonym: pz });
    // The list is not part of an export or a backup.
    expect(Object.keys((await tenantDo(ALPHA).exportAll()) as Loose)).not.toContain(
      "erasure_tombstones",
    );

    // Bring the old state back, piece by piece.
    for (const key of [keys.bid, keys.personal, keys.tenant]) {
      const r = await restoreBackup(deps(), key);
      expect(r, key).toMatchObject({ ok: true });
    }

    const dir = (await tenantDo(ALPHA).exportAll()) as Loose;
    expect(dir.principals.map((p: Loose) => p.id)).not.toContain(SUBJECT);
    expect(dir.role_assignments.map((p: Loose) => p.principal_id)).not.toContain(SUBJECT);
    const bid = wsOf(ALPHA, "c_bid");
    expect((await bid.authoredBy(SUBJECT)).items).toEqual([]);
    expect((await bid.authoredBy(pz)).items.map((i: Loose) => i.id)).toContain(candidateId);
    const personal = (await wsOf(ALPHA, `personal:${SUBJECT}`).exportAll()) as Loose;
    for (const rows of Object.values(personal)) expect(rows).toEqual([]);
  });

  it("tombstones lapse after their time and are dropped by the retention job", async () => {
    await runInDurableObject(tenantDo(ALPHA), async (inst) => {
      inst.tombstoneAdd("u_old", "pz_old", [], 1, 2);
      expect(inst.tombstoneList(Date.now()).map((t) => t.principalId)).not.toContain("u_old");
      expect(inst.tombstonePurge(Date.now())).toBeGreaterThanOrEqual(1);
    });
  });
});
