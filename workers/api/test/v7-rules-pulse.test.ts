// Pulse "rules triggered": the rules gate writes one id-only line to the brain's log whenever a rule
// decided something; the journal turns the lines into `N rules triggered`; the pulse dot reads that count.
// "Gaps closed" has a named hook that does nothing until v8/review is merged.

import { beforeAll, describe, expect, it } from "vitest";
import { recordGapsClosedNotConnected } from "../src/pulse/hooks.ts";
import { parseJournal } from "../src/pulse/parse.ts";
import { ALPHA, as, json, type Loose, seed, wsOf } from "./helpers.ts";

const ADMIN = "v7p.admin@example.invalid";
const ADMIN2 = "v7p.admin2@example.invalid";
const CONS = "v7p.cons@example.invalid";
const MD = (t: string) => `# ${t}\n\n## Summary\n- A plain fact about delivery.\n`;
const today = new Date().toISOString().slice(0, 10);

const rules = (email: string, path: string, o: Loose = {}) =>
  as("platform_admin", `/v1/rules${path}`, { email, ...o });
const propose = (scope: string, title: string, who: [string, string] = ["consultant", CONS]) =>
  as(who[0], `/v1/wiki/${scope}/propose`, {
    email: who[1],
    body: { title, markdown: MD(title) },
  });

beforeAll(async () => {
  await seed();
});

describe("rules triggered in the journal", () => {
  it("counts each action a rule decided, ids and counts only, and nothing for a brain without a rule", async () => {
    const made = await json<Loose>(
      await rules(ADMIN, "", {
        method: "POST",
        body: {
          name: "Pause pages in delivery",
          scope: { kind: "brains", ids: ["c_delivery"] },
          when: [{ field: "action", op: "is_any_of", values: ["propose_page"] }],
          then: { effect: "block", message: "SECRETMESSAGE paused" },
          except: { incident: false },
          status: "enforced",
        },
      }),
    );
    const hash = async (email: string) =>
      (await json<Loose>(await rules(email, `/${made.id}`))).draftHash as string;
    let pub = await rules(ADMIN, `/${made.id}/publish`, {
      method: "POST",
      body: { expectedHash: await hash(ADMIN) },
    });
    if (pub.status === 202)
      pub = await rules(ADMIN2, `/${made.id}/publish`, {
        method: "POST",
        body: { expectedHash: await hash(ADMIN2) },
      });
    expect(pub.status).toBe(200);

    expect((await propose("c_delivery", "First paused page")).status).toBe(403);
    expect((await propose("c_delivery", "Second paused page")).status).toBe(403);
    // No rule names c_bid, so nothing is recorded for it.
    expect(
      (await propose("c_bid", "A page in bid", ["head_bid", "v7p.bid@example.invalid"])).status,
    ).toBe(201);

    const now = Date.now();
    const out = await wsOf(ALPHA, "c_delivery").brainJournalRun(today, now);
    expect(out.pageId).toBe(`journal-${today}`);
    const page = await json<Loose>(
      await as("consultant", `/v1/wiki/c_delivery/pages/journal-${today}`, { email: CONS }),
    );
    expect(page.markdown).toContain("2 rules triggered");
    expect(page.markdown).toContain("0 gaps closed");
    // Counts only: no rule id, no message, no page title.
    expect(page.markdown).not.toContain(made.id);
    expect(page.markdown).not.toContain("SECRETMESSAGE");
    expect(page.markdown).not.toContain("paused page");
    expect(parseJournal(`journal-${today}`, page.markdown)?.counts).toMatchObject({
      rules: 2,
      gaps: 0,
    });
    const log = await wsOf(ALPHA, "c_delivery").wikiLog(100);
    const rows = log.filter((l) => l.kind === "rule.triggered");
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows.map((r) => r.detail))).not.toMatch(/SECRETMESSAGE|paused page/);
    const bid = (await wsOf(ALPHA, "c_bid").wikiLog(100)).filter(
      (l) => l.kind === "rule.triggered",
    );
    expect(bid).toHaveLength(0);
  });

  it("the gaps-closed hook is a named no-op until v8/review is connected", async () => {
    expect(await recordGapsClosedNotConnected(wsOf(ALPHA, "c_delivery"), 3)).toBeUndefined();
    const log = await wsOf(ALPHA, "c_delivery").wikiLog(100);
    expect(log.filter((l) => l.kind === "gap.closed")).toHaveLength(0);
  });
});
