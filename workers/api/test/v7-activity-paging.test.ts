// Activity log paging: the audit worker is read page by page back to the start of the window (it used to
// stop at the newest 200 receipts), and the events table continues from a cursor, 200 events a page.

import { beforeAll, describe, expect, it } from "vitest";
import { ALPHA, as, json, type Loose, rawEnv, seed, wsOf } from "./helpers.ts";

const HEAD = "v7p.headbid@example.invalid"; // manages c_bid
const KEY_API = "test-audit-key-api-0123456789abcdef0123";
/** A clock of its own (2034), so receipts other files wrote at real time stay out of the window. */
const T = Date.UTC(2034, 2, 1, 12, 0, 0);
const N = 1100;
const headbid = (path: string) => as("head_bid", path, { email: HEAD, now: T });

beforeAll(async () => {
  await seed();
  await wsOf(ALPHA, "c_bid").wikiTouch(ALPHA, "c_bid", Date.now());
  for (let i = 0; i < N; i++) {
    const res = await rawEnv.AUDIT.fetch("https://audit.internal/append", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Audit-Key": KEY_API },
      body: JSON.stringify({
        receiptId: `rcpt_${crypto.randomUUID()}`,
        at: new Date(T - 60_000 - i * 10_000).toISOString(),
        tenantId: ALPHA,
        principalId: "u_planted",
        action: "wiki.edit",
        nodeId: "c_bid",
        scopeId: "c_bid",
        decision: "allow",
        reason: "owner",
        revision: null,
        requestId: null,
        clientId: null,
        tool: null,
      }),
    });
    if (res.status !== 202) throw new Error(`plant failed ${res.status}`);
  }
}, 120_000);

describe("activity paging", () => {
  it("reads every receipt of the window and pages the events 200 at a time", async () => {
    const url = (cursor?: string) =>
      `/v1/brains/c_bid/activity?window=24h${cursor ? `&cursor=${cursor}` : ""}`;
    const first = await json<Loose>(await headbid(url()));
    expect(first.totals.matching).toBeGreaterThanOrEqual(N);
    expect(first.partial).toBe(false);
    expect(first.events).toHaveLength(200);
    expect(typeof first.nextCursor).toBe("string");

    const ids: string[] = first.events.map((e: Loose) => e.id);
    let at: string[] = first.events.map((e: Loose) => e.at);
    let cursor: string | null = first.nextCursor;
    let pages = 1;
    while (cursor && pages < 20) {
      const page = await json<Loose>(await headbid(url(cursor)));
      expect(page.events.length).toBeLessThanOrEqual(200);
      ids.push(...page.events.map((e: Loose) => e.id));
      at = at.concat(page.events.map((e: Loose) => e.at));
      cursor = page.nextCursor;
      pages++;
    }
    expect(cursor).toBeNull();
    expect(ids).toHaveLength(first.totals.matching);
    expect(new Set(ids).size).toBe(ids.length);
    // Newest first all the way down.
    expect([...at].sort().reverse()).toEqual(at);
  });

  it("refuses a cursor that is not one", async () => {
    expect((await headbid("/v1/brains/c_bid/activity?window=24h&cursor=%25%25")).status).toBe(400);
    expect((await headbid("/v1/brains/c_bid/activity?window=24h&cursor=YWJj")).status).toBe(400);
  });
});
