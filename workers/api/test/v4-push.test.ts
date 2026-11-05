// v4: pushing into a brain through MCP (propose_page, propose_change, write_session_report) with the
// caller's own rights. Contributor or above, admitted view only, review always in a shared brain,
// and the proposal lands in that brain's waiting list and in no other.

import { beforeAll, describe, expect, it } from "vitest";
import { type InternalPrincipal, signInternalRequest } from "../src/internal-auth.ts";
import { ALPHA, as, call, json, type Loose, rawEnv, seed, seenOf, wsOf } from "./helpers.ts";
import { plantPage } from "./uxv2-helpers.ts";

const KEY = (rawEnv as unknown as Env).INTERNAL_HMAC_KEY as string;
const AGENT = "jane.doe@example.invalid"; // a consultant, through an MCP host
const STEWARD = "v4p.steward@example.invalid"; // a reviewer who decides in c_delivery
const WRITE = ["secondary.read", "secondary.contribute"];

interface Opts {
  persona?: string;
  email?: string;
  scope?: string[];
  env?: Record<string, unknown>;
  tool?: string;
}
/** A call the way workers/mcp makes it: signed, as a person, with a tool name and scopes. */
async function mcp(path: string, body?: Loose, o: Opts = {}) {
  const url = `https://secondary.example.test${path}`;
  const raw = body === undefined ? undefined : JSON.stringify(body);
  const method = raw === undefined ? "GET" : "POST";
  const principal: InternalPrincipal = {
    v: 1,
    iss: "secondary-mcp",
    aud: "secondary-api",
    sub: `sub-${o.email ?? AGENT}`,
    email: o.email ?? AGENT,
    persona: o.persona ?? "consultant",
    client_id: "claude.ai",
    grant_id: "g_v4",
    scope: o.scope ?? WRITE,
    tool: o.tool ?? "propose_page",
  };
  const headers = await signInternalRequest({
    secret: KEY,
    method,
    url,
    ...(raw === undefined ? {} : { body: raw }),
    principal,
    now: Math.floor(Date.now() / 1000),
  });
  return call(path, {
    method,
    token: null,
    ...(raw === undefined ? {} : { rawBody: raw }),
    headers: { ...headers, ...(raw === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(o.env ? { env: o.env } : {}),
  });
}
const page = (id: string, body: Loose, o: Opts = {}) => mcp(`/v1/brains/${id}/push/page`, body, o);
const change = (id: string, body: Loose, o: Opts = {}) =>
  mcp(`/v1/brains/${id}/push/change`, body, { tool: "propose_change", ...o });
const report = (id: string, body: Loose, o: Opts = {}) =>
  mcp(`/v1/brains/${id}/push/session-report`, body, { tool: "write_session_report", ...o });

const waiting = async (persona: string, email: string, q = "") =>
  json<Loose[]>(await as(persona, `/v1/questions${q}`, { email }));
const MD = (t: string) => `# ${t}\n\n## Summary\n- The delivery gate is signed before release.\n`;

beforeAll(async () => {
  await seed();
  await plantPage(
    "c_delivery",
    { id: "v4p-gate", type: "topic", title: "Gate", markdown: MD("Gate") },
    "TEAM_RESTRICTED",
  );
});

describe("list_brains source: GET /v1/brains over MCP", () => {
  it("answers the read scope with the caller's readable brains and their role", async () => {
    const r = await mcp("/v1/brains", undefined, {
      scope: ["secondary.read"],
      tool: "list_brains",
    });
    expect(r.status).toBe(200);
    const brains = (await json<Loose>(r)).brains as Loose[];
    expect(brains.map((b) => b.id)).toEqual(expect.arrayContaining(["me", "c_delivery", "core"]));
    expect(brains.find((b) => b.id === "c_delivery")).toMatchObject({
      type: "team",
      role: "contributor",
      publication: "review",
    });
    expect(brains.find((b) => b.id === "me")?.role).toBe("owner");
    expect(brains.find((b) => b.id === "core")?.role).toBe("reader");
    expect(brains.map((b) => b.id)).not.toContain("c_bid");
  });
});

describe("rights and scopes", () => {
  it("a read-only token cannot push, and nothing else is exposed", async () => {
    const ro = { scope: ["secondary.read"] };
    for (const r of [
      await page("c_delivery", { title: "x", markdown: "y" }, ro),
      await change("c_delivery", { pageId: "v4p-gate", markdown: "y" }, ro),
      await report("c_delivery", { markdown: "y" }, ro),
    ])
      expect(r.status).toBe(403);
  });

  it("a brain the caller cannot read is 404, the same body and status as a brain that does not exist", async () => {
    const real = "c_bid";
    const nope = "c_nonexistent";
    const cases: [string, Loose, (id: string) => Promise<Response>][] = [
      ["page", { title: "x", markdown: "y" }, (id) => page(id, { title: "x", markdown: "y" })],
      [
        "change",
        { pageId: "v4p-gate", markdown: "y" },
        (id) => change(id, { pageId: "v4p-gate", markdown: "y" }),
      ],
      ["report", { markdown: "y" }, (id) => report(id, { markdown: "y" })],
      // A malformed body must not tell the two apart either.
      ["bad body", {}, (id) => page(id, {})],
    ];
    for (const [name, , send] of cases) {
      const a = await send(real);
      const b = await send(nope);
      expect(a.status, name).toBe(404);
      expect(b.status, name).toBe(404);
      expect(await a.text(), name).toBe(await b.text());
    }
    // Nothing was queued in the bid circle by any of them.
    const bid = await waiting("head_bid", "v4p.headbid@example.invalid", "?brain=c_bid");
    expect(bid.filter((x) => /Session report|"?x"?$/.test(x.title))).toEqual([]);
  });

  it("a reader of a brain (Company Global) cannot push into it: 403, not a proposal", async () => {
    const r = await page("core", { title: "Global idea", markdown: "y" });
    expect(r.status).toBe(403);
    expect((await json<Loose>(r)).error).toBe("forbidden");
  });
});

describe("propose_page lands in that brain's waiting list only", () => {
  it("a pending proposal in c_delivery, visible to its steward, never in another brain", async () => {
    const r = await page("c_delivery", { title: "Release gates", markdown: MD("Release gates") });
    expect(r.status, await r.clone().text()).toBe(201);
    const out = await json<Loose>(r);
    expect(out).toMatchObject({ ok: true, brainId: "c_delivery", status: "candidate" });
    // Not published.
    expect(await wsOf(ALPHA, "c_delivery").wikiPage("release-gates")).toBeNull();

    const inDelivery = await waiting("reviewer", STEWARD, "?brain=c_delivery");
    const q = inDelivery.find((x) => x.title.includes("Release gates")) as Loose;
    expect(q).toBeTruthy();
    expect(q.workspaceId).toBe("c_delivery");
    // The steward of the bid circle sees it nowhere: not in c_bid, not in any list.
    expect(
      (await waiting("reviewer", STEWARD, "?brain=c_bid")).some((x) =>
        x.title.includes("Release gates"),
      ),
    ).toBe(false);
    expect(
      (await waiting("head_bid", "v4p.headbid@example.invalid")).some((x) =>
        x.title.includes("Release gates"),
      ),
    ).toBe(false);
    // The author never decides their own proposal, so it is not in their own queue either.
    expect(
      (await waiting("consultant", AGENT)).some((x) => x.title.includes("Release gates")),
    ).toBe(false);
    // The steward approves it after seeing every change, and it goes live.
    const ok = await as("reviewer", `/v1/questions/${q.id}`, {
      email: STEWARD,
      body: { action: "approve", revisionHash: q.detail.revisionHash, seenChanges: seenOf(q) },
    });
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(await wsOf(ALPHA, "c_delivery").wikiPage("release-gates")).toMatchObject({
      title: "Release gates",
    });
  });

  it("an unknown collection type is a 400", async () => {
    const r = await page("c_delivery", { title: "T", markdown: "y", type: "no_such_type" });
    expect(r.status).toBe(400);
  });

  it("stays in review in a direct-publishing brain (M-5): the page is a candidate, not live", async () => {
    // The Personal Brain is the one shared-nothing brain where direct is allowed.
    expect(
      (
        await as("consultant", "/v1/brains/me/access", {
          email: AGENT,
          method: "PUT",
          body: { publication: "direct" },
        })
      ).status,
    ).toBe(200);
    const r = await page("me", { title: "Mine direct", markdown: MD("Mine direct") });
    expect((await json<Loose>(r)).status).toBe("candidate");
    expect(await wsOf(ALPHA, "personal:" + (await meOf())).wikiPage("mine-direct")).toBeNull();
  });
});

/** The principal id of the MCP person. */
const meOf = async (): Promise<string> =>
  (await json<Loose>(await as("consultant", "/v1/me", { email: AGENT }))).principal.id;

describe("propose_change", () => {
  it("queues a new version of a page the caller can read, with a rationale and a diff", async () => {
    const r = await change("c_delivery", {
      pageId: "v4p-gate",
      markdown: MD("Gate").replace("signed before", "signed twice before"),
      rationale: "The checklist now needs two signatures",
    });
    expect(r.status, await r.clone().text()).toBe(201);
    const out = await json<Loose>(r);
    expect(out).toMatchObject({ pageId: "v4p-gate", status: "candidate" });
    const view = await json<Loose>(
      await as("reviewer", `/v1/wiki/c_delivery/proposals/${out.proposalId}`, { email: STEWARD }),
    );
    expect(view.rationale).toBe("The checklist now needs two signatures");
    expect(view.changeCount).toBe(1);
    expect(view.pages[0]).toMatchObject({ pageId: "v4p-gate", title: "Gate", stale: false });
  });

  it("a missing or malformed page id is a 404", async () => {
    expect((await change("c_delivery", { pageId: "no-such-page", markdown: "y" })).status).toBe(
      404,
    );
    expect((await change("c_delivery", { pageId: "../x", markdown: "y" })).status).toBe(404);
  });
});

describe("write_session_report", () => {
  it("lands as a pending page under Sources > Session reports > the person, in a shared brain", async () => {
    const r = await report("c_delivery", {
      markdown: "Fixed the release gate wording.",
      date: "2026-11-04",
    });
    expect(r.status, await r.clone().text()).toBe(201);
    const out = await json<Loose>(r);
    expect(out).toMatchObject({
      ok: true,
      status: "candidate",
      pageId: expect.stringMatching(/^session-report-jane-doe-2026-11-04-[0-9a-f]{4}$/),
      folder: ["Sources", "Session reports", "Jane Doe"],
    });
    const view = await json<Loose>(
      await as("reviewer", `/v1/wiki/c_delivery/proposals/${out.proposalId}`, { email: STEWARD }),
    );
    expect(view.pages[0]).toMatchObject({
      type: "session_report",
      title: "Session report Jane Doe 2026-11-04",
    });
    expect(view.pages[0].after).toContain("Folder: Sources / Session reports / Jane Doe");
    // A second report the same day is a page of its own, not an overwrite.
    const again = await json<Loose>(
      await report("c_delivery", { markdown: "More work.", date: "2026-11-04" }),
    );
    expect(again.pageId).not.toBe(out.pageId);
    expect(again.pageId).toMatch(/^session-report-jane-doe-2026-11-04-[0-9a-f]{4}$/);
  });

  it("after review the page is live and the brain home lists a Session reports collection", async () => {
    const made = await json<Loose>(
      await report("c_delivery", { markdown: "Wrapped up.", date: "2026-11-03" }),
    );
    const view = await json<Loose>(
      await as("reviewer", `/v1/wiki/c_delivery/proposals/${made.proposalId}`, { email: STEWARD }),
    );
    const ok = await as("reviewer", `/v1/wiki/c_delivery/proposals/${made.proposalId}/decide`, {
      email: STEWARD,
      body: { decision: "approve", revisionHash: view.revisionHash, seenChanges: seenOf(view) },
    });
    expect(ok.status, await ok.clone().text()).toBe(200);
    const home = await json<Loose>(
      await as("reviewer", "/v1/brains/c_delivery", { email: STEWARD }),
    );
    expect(home.collections).toContainEqual(
      expect.objectContaining({ type: "session_report", label: "Session reports", count: 1 }),
    );
  });

  it("rejects a bad date, and never takes a date as a way to rewrite an existing page", async () => {
    expect((await report("c_delivery", { markdown: "x", date: "2026-02-30" })).status).toBe(400);
    expect((await report("c_delivery", { markdown: "x", date: "soon" })).status).toBe(400);
    expect((await report("c_delivery", { markdown: "" })).status).toBe(400);
  });

  it("in the Personal Brain it follows that brain's publication mode", async () => {
    // Review (the default): a candidate.
    await as("consultant", "/v1/brains/me/access", {
      email: AGENT,
      method: "PUT",
      body: { publication: "review" },
    });
    const held = await json<Loose>(
      await report("me", { markdown: "Private notes.", date: "2026-11-01" }),
    );
    expect(held.status).toBe("candidate");
    // Direct: published at once.
    await as("consultant", "/v1/brains/me/access", {
      email: AGENT,
      method: "PUT",
      body: { publication: "direct" },
    });
    const live = await json<Loose>(
      await report("me", { markdown: "Private notes.", date: "2026-11-02" }),
    );
    expect(live.status).toBe("published");
    expect(await wsOf(ALPHA, `personal:${await meOf()}`).wikiPage(live.pageId)).toMatchObject({
      type: "session_report",
    });
  });
});

describe("limits and audit", () => {
  it("is audited per call with the tool name, and shares the wiki write rate limit", async () => {
    const id = await meOf();
    await page("c_delivery", { title: "Audited page", markdown: MD("Audited page") });
    const receipts = (await json<Loose>(await as("auditor", `/v1/audit/receipts?principal=${id}`)))
      .receipts as Loose[];
    expect(receipts).toContainEqual(
      expect.objectContaining({
        action: "brain.push_page",
        tool: "propose_page",
        scopeId: "c_delivery",
      }),
    );
    expect(receipts).toContainEqual(
      expect.objectContaining({
        action: "brain.push_session_report",
        tool: "write_session_report",
      }),
    );

    const limited = { env: { WIKI_WRITE_PER_MIN: "2" }, email: "v4p.limited@example.invalid" };
    const codes: number[] = [];
    for (const t of ["a", "b", "c"])
      codes.push(
        (await page("c_delivery", { title: `Limit ${t}`, markdown: MD(t) }, limited)).status,
      );
    expect(codes).toEqual([201, 201, 429]);
  });
});
