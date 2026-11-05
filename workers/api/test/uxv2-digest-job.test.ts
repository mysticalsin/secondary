// The weekly digest job: drafts only, one per person and week, composed with that person's own rights.

import { beforeAll, describe, expect, it } from "vitest";
import { signOpsRequest } from "../../../packages/contracts/src/ops-auth.ts";
import { type BackupDeps, runDigests } from "../../ops/src/backup.ts";
import { createApp } from "../src/index.ts";
import { DIGEST_KIND, mondayOf, renderDigest } from "../src/uxv2/digest.ts";
import { runWeeklyDigests, weeklyDraftId } from "../src/uxv2/digest-job.ts";
import { ALPHA, as, json, type Loose, rawEnv, seed, testEnv, wsOf } from "./helpers.ts";

const HMAC = (rawEnv as unknown as Env).OPS_HMAC_KEY as string;
const allow = {
  CONNECTOR: {
    fetch: async (_u: string, init: RequestInit) =>
      Response.json({
        results: Object.fromEntries(
          (JSON.parse(String(init.body)).itemIds as string[]).map((i) => [i, { allowed: true }]),
        ),
      }),
  },
};
const opsDeps = (): BackupDeps => ({
  BACKUPS: rawEnv.BLOBS,
  API: {
    fetch: (url: string, init: RequestInit) =>
      createApp().fetch(new Request(url, init), testEnv(allow)),
  } as unknown as Fetcher,
  ENVIRONMENT: "staging",
  OPS_HMAC_KEY: HMAC,
  BACKUP_KEY: "test-backup-key-0123456789abcdef0123456",
});

const drafts = async (principalId: string) =>
  (await wsOf(ALPHA, `personal:${principalId}`).listByKind(DIGEST_KIND, 50)) as Loose[];
const PEOPLE = ["u_ceo", "u_acme_lead", "u_head_bid", "u_consultant", "u_reviewer", "u_auditor"];
const draftCount = async () =>
  (await Promise.all(PEOPLE.map(async (p) => (await drafts(p)).length))).reduce((a, b) => a + b, 0);

beforeAll(async () => {
  await seed();
  const story = await as("acme_lead", "/v1/ux/accounts/a_acme/records", {
    body: { section: "out", title: "Retail rollout story", status: "ready" },
  });
  expect(story.status, await story.clone().text()).toBe(201);
});

describe("weekly digest job", () => {
  it("makes one draft per person with something to report, composed under that person's rights, and sends nothing", async () => {
    const before = await draftCount();
    const out = await runWeeklyDigests(testEnv(allow), Date.now());
    expect(out.weekOf).toBe(mondayOf(Date.now()));
    expect(out.drafted).toBeGreaterThan(0);
    expect(await draftCount()).toBe(before + out.drafted);

    const mine = await drafts("u_acme_lead");
    expect(mine).toHaveLength(1);
    const body = JSON.parse(mine[0]?.body as string);
    expect(body).toMatchObject({
      state: "draft",
      weekOf: out.weekOf,
      to: "acme_lead@example.invalid",
    });
    // The same text the person's own preview renders.
    const preview = await json(await as("acme_lead", "/v1/digest/preview", { env: allow }));
    expect(body.markdown).toBe(renderDigest(preview as never));
    expect(mine[0]?.id).toBe(await weeklyDraftId("u_acme_lead", out.weekOf));
    expect(mine[0]?.status).toBe("draft");
    // The draft is readable through the person's own route, and says draft.
    const read = await json(
      await as("acme_lead", `/v1/digest/drafts/${encodeURIComponent(mine[0]?.id as string)}`),
    );
    expect(read.state).toBe("draft");

    // A person who may not read the account does not get its items.
    for (const p of PEOPLE) {
      const text = (await drafts(p)).map((d) => JSON.parse(d.body as string).markdown).join("");
      if (p === "u_consultant" || p === "u_auditor")
        expect(text, p).not.toContain("Retail rollout story");
    }
  });

  it("is idempotent for the week: a second run, or a cron that fires twice, adds nothing", async () => {
    const first = await draftCount();
    const again = await runWeeklyDigests(testEnv(allow), Date.now());
    expect(again.drafted).toBe(0);
    expect(again.existing).toBeGreaterThan(0);
    expect(await draftCount()).toBe(first);
    // Later the same week, still the same draft.
    const sunday = Date.parse(mondayOf(Date.now())) + 6 * 86_400_000;
    expect((await runWeeklyDigests(testEnv(allow), sunday)).drafted).toBe(0);
    // The next week is a new draft for each person who has something to report.
    const next = await runWeeklyDigests(testEnv(allow), Date.now() + 7 * 86_400_000);
    expect(next.weekOf).not.toBe(again.weekOf);
    expect((await drafts("u_acme_lead")).length).toBeGreaterThan(1);
  });

  it("a person who asked for a draft by hand still gets the weekly one, and a manual draft does not block it", async () => {
    const manual = await as("acme_lead", "/v1/digest/draft", { method: "POST", env: allow });
    expect(manual.status).toBe(201);
    const manualId = (await json(manual)).draftId as string;
    const nextWeek = Date.now() + 14 * 86_400_000;
    await runWeeklyDigests(testEnv(allow), nextWeek);
    const ids = (await drafts("u_acme_lead")).map((d) => d.id);
    expect(ids).toContain(manualId);
    expect(ids).toContain(await weeklyDraftId("u_acme_lead", mondayOf(nextWeek)));
  });

  it("runs only for the ops worker's signed call, and the ops worker's job reaches it", async () => {
    const path = "/v1/internal/ops/digest";
    const unsigned = await createApp().fetch(
      new Request(`https://secondary.example.test${path}`, { method: "POST", body: "{}" }),
      testEnv(allow),
    );
    expect(unsigned.status).toBe(401);
    const wrong = await signOpsRequest({
      secret: "x".repeat(40),
      method: "POST",
      url: `https://secondary.example.test${path}`,
      body: "{}",
    });
    const refused = await createApp().fetch(
      new Request(`https://secondary.example.test${path}`, {
        method: "POST",
        headers: { ...wrong, "Content-Type": "application/json" },
        body: "{}",
      }),
      testEnv(allow),
    );
    expect(refused.status).toBe(401);
    const before = await draftCount();
    const out = await runDigests(opsDeps());
    expect(out.drafted).toBe(0);
    expect(await draftCount()).toBe(before);
  });
});
