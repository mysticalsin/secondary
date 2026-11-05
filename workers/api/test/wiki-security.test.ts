// B2 security fixes, as they apply to the Living Wiki (B3): one AI gate for every model path, the
// signed internal call (HMAC v2) for the wiki MCP tools, the two-person rule on Promote to Global,
// and explicit circle membership for restricted-circle wikis.

import { beforeAll, describe, expect, it } from "vitest";
import {
  HEADER_KID,
  HEADER_NONCE,
  HEADER_SIGNATURE,
  type InternalPrincipal,
  signInternalRequest,
} from "../src/internal-auth.ts";
import { runWikiJobs, type WikiApi } from "../src/wiki/engine.ts";
import { aiCall, KEY, stubModel } from "./ai-helpers.ts";
import {
  ALPHA,
  as,
  call,
  json,
  type Loose,
  rawEnv,
  seed,
  seenOf,
  testEnv,
  wsOf,
} from "./helpers.ts";

beforeAll(async () => {
  await seed();
});

const ACC = "a_acme";
const post = (persona: string, path: string, body: unknown = {}, o: Loose = {}) =>
  as(persona, `/v1/wiki/${path}`, { body, ...o });
const get = (persona: string, path: string, o: Loose = {}) => as(persona, `/v1/wiki/${path}`, o);

let n = 0;
/** A synthetic meeting with one decision, unique per call so every ingest sees a new source. */
async function meeting(): Promise<string> {
  n++;
  const r = await post("acme_lead", `${ACC}/meetings`, {
    title: `Gate check ${n}`,
    date: "2026-11-03",
    decisions: [{ title: `Adopt gate rule ${n}`, owner: "Account lead" }],
    commitments: [],
    risks: [],
  });
  expect(r.status).toBe(201);
  return (await json(r)).id as string;
}

/** Run the wiki jobs of the Acme workspace in the given environment, with a model stand-in. */
async function runAs(
  env: Record<string, unknown>,
  fetch: (u: string, i?: RequestInit) => Promise<Response>,
) {
  return runWikiJobs(wsOf(ALPHA, ACC) as unknown as WikiApi, {
    env: testEnv(env),
    now: Date.now(),
    dueAt: Number.MAX_SAFE_INTEGER,
    fetch,
    sleep: async () => {},
  });
}

const aiSwitch = (enabled: boolean) =>
  as("platform_admin", "/v1/admin/switches", { body: { switch: "ai", enabled } });

const reply = () => ({
  new_information: true,
  facts: [
    {
      kind: "decision",
      title: "Adopt the gate rule",
      attribute: "status",
      value: "decided",
      citations: ["E1"],
    },
  ],
  pages: [],
});

describe("AI gate: ingest drafting goes through the same gate as briefs", () => {
  const OFF: [string, Record<string, unknown>][] = [
    ["AI_ENABLED unset", { ...KEY, AI_ENABLED: "" }],
    ["processor contract not approved", { ...KEY, AI_PROCESSOR_CONTRACT: "pending" }],
    ["no key", { ...KEY, ANTHROPIC_API_KEY: "" }],
  ];

  for (const [name, over] of OFF) {
    it(`${name}: no model call; the extractor runs for the synthetic dev org only`, async () => {
      await meeting();
      const m = stubModel(reply);
      const dev = await runAs({ ...over, ENVIRONMENT: "dev" }, m.fetch);
      expect(m.calls).toHaveLength(0);
      expect(dev[0]).toMatchObject({
        kind: "ingest",
        triage: "proposed",
        method: "deterministic extractor",
      });
      // The same refusal outside dev: no model call and no stand-in, the source stays un-ingested.
      for (const environment of ["staging", "prod"]) {
        await meeting();
        const real = await runAs({ ...over, ENVIRONMENT: environment }, m.fetch);
        expect(m.calls, environment).toHaveLength(0);
        expect(real[0], environment).toMatchObject({ kind: "ingest", triage: "skipped" });
        expect(JSON.stringify(await wsOf(ALPHA, ACC).wikiLog(20))).toContain("AI not available");
      }
    });
  }

  it("the tenant kill switch stops the call even with every env flag on, and lifting it restores AI", async () => {
    expect((await aiSwitch(false)).status).toBe(200);
    try {
      await meeting();
      const m = stubModel(reply);
      const off = await runAs({ ...KEY, ENVIRONMENT: "staging" }, m.fetch);
      expect(m.calls).toHaveLength(0);
      expect(off[0]).toMatchObject({ triage: "skipped" });
      // In dev the extractor stands in for the synthetic org, still without a model call.
      await meeting();
      const dev = await runAs({ ...KEY, ENVIRONMENT: "dev" }, m.fetch);
      expect(m.calls).toHaveLength(0);
      expect(dev[0]?.method).toBe("deterministic extractor");
    } finally {
      expect((await aiSwitch(true)).status).toBe(200);
    }
    await meeting();
    const m = stubModel(reply);
    const on = await runAs({ ...KEY, ENVIRONMENT: "staging" }, m.fetch);
    expect(m.calls.length).toBeGreaterThanOrEqual(1);
    expect(on[0]?.method).toMatch(/^AI processor/);
  });

  it("dreaming and ask never call a model, whatever the flags", async () => {
    const m = stubModel(reply);
    const dream = await aiCall("head_bid", "/v1/wiki/c_bid/run", {
      body: { jobs: ["dream", "lint"] },
      env: KEY,
      fetch: m.fetch,
    });
    expect(dream.status).toBe(200);
    const ask = await aiCall("acme_lead", `/v1/wiki/${ACC}/ask?q=gate%20rule`, {
      env: KEY,
      fetch: m.fetch,
    });
    expect(ask.status).toBe(200);
    expect(m.calls).toHaveLength(0);
  });
});

describe("HMAC v2: the wiki routes accept only the signed internal call", () => {
  const INTERNAL = (rawEnv as unknown as Env).INTERNAL_HMAC_KEY as string;
  const ORIGIN = "https://secondary.example.test";
  const principal: InternalPrincipal = {
    v: 1,
    iss: "secondary-mcp",
    grant_id: "g_test",
    aud: "secondary-api",
    sub: "sub-wiki",
    email: "acme_lead@example.invalid",
    persona: "acme_lead",
    client_id: "claude.ai",
    scope: ["secondary.read"],
    tool: "wiki_search",
  };
  const path = `/v1/wiki/${ACC}/search?q=gate`;
  const send = (headers: Record<string, string>) => call(path, { token: null, headers });
  const sign = (secret = INTERNAL) =>
    signInternalRequest({ secret, method: "GET", url: `${ORIGIN}${path}`, principal });

  it("a v2 signed call is served once; the same headers replayed are refused", async () => {
    const headers = await sign();
    expect(headers[HEADER_SIGNATURE]).toMatch(/^v2=/);
    expect(headers[HEADER_KID]).toBeTruthy();
    expect(headers[HEADER_NONCE]).toBeTruthy();
    expect((await send(headers)).status).toBe(200);
    expect((await send(headers)).status).toBe(401);
  });

  it("a legacy v1 signature, a missing nonce and a wrong key are refused", async () => {
    const h = await sign();
    expect(
      (
        await send({
          ...h,
          [HEADER_SIGNATURE]: h[HEADER_SIGNATURE]?.replace("v2=", "v1=") as string,
        })
      ).status,
    ).toBe(401);
    const { [HEADER_NONCE]: _n, ...noNonce } = await sign();
    expect((await send(noNonce)).status).toBe(401);
    expect((await send(await sign(`${INTERNAL}x`))).status).toBe(401);
    // The signature binds the path: the same headers do not open another wiki route.
    const other = await call(`/v1/wiki/${ACC}/index`, { token: null, headers: await sign() });
    expect(other.status).toBe(401);
  });
});

describe("Promote to Global: the requester never counts as an approver", () => {
  const PROMOTER = "ceo.gate@example.invalid";
  const validated = { by: PROMOTER, at: new Date().toISOString(), revision: 1 };

  it("the person who requested the promotion cannot approve it, and a second person cannot be the first twice", async () => {
    // Publish a page to promote.
    const prop = await json(
      await post("acme_lead", `${ACC}/propose`, {
        title: "Gate playbook",
        markdown: "# Gate playbook\n\n- Review every change twice.\n",
      }),
    );
    const other = { email: "other.lead@example.invalid" };
    const read = await json(await get("acme_lead", `${ACC}/proposals/${prop.proposalId}`, other));
    expect(
      (
        await post(
          "acme_lead",
          `${ACC}/proposals/${prop.proposalId}/decide`,
          { decision: "approve", revisionHash: read.revisionHash, seenChanges: seenOf(read) },
          other,
        )
      ).status,
    ).toBe(200);
    const r = await post(
      "ceo",
      `${ACC}/pages/gate-playbook/promote`,
      { user_validated: validated, acknowledged_flags: [] },
      { email: PROMOTER },
    );
    expect(r.status, await r.clone().text()).toBe(201);
    const candidate = (await json(r)).candidateId as string;
    const approve = (persona: string, email: string) =>
      as(persona, "/v1/actions", {
        email,
        body: { nodeId: candidate, action: "approve_release", revision: 1 },
      });
    // The requester is the item's author: the workspace itself refuses their approval, whatever role they hold.
    const item = await wsOf(ALPHA, "global").get(candidate);
    const own = await wsOf(ALPHA, "global").approve(
      candidate,
      1,
      item?.authorId as string,
      Date.now(),
    );
    expect(own).toMatchObject({ ok: false, code: "self_approval" });
    // Two other people release it; one of them twice is not enough.
    const first = await json(await approve("reviewer", "reviewer@example.invalid"));
    expect(first).toMatchObject({ released: false, approvals: 1, required: 2 });
    expect((await approve("reviewer", "reviewer@example.invalid")).status).toBe(409);
    expect(await json(await approve("reviewer", "second.gate@example.invalid"))).toMatchObject({
      released: true,
      approvals: 2,
    });
  });
});

describe("restricted circles: a department membership never opens a restricted wiki", () => {
  const C = "c_hr_pp";

  it("is not found for a department-level member (the CEO's own grant aside), and opens only after an approved circle membership", async () => {
    // Nobody holds the circle yet: it is invisible to every persona, whatever their department.
    for (const p of [
      "head_bid",
      "consultant",
      "reviewer",
      "acme_lead",
      "platform_admin",
      "auditor",
    ])
      expect((await get(p, `${C}/index`)).status, p).toBe(404);
    // A department membership in HR does not change that (H-03).
    const dept = await as("platform_admin", "/v1/admin/memberships", {
      body: { op: "add", principalId: "u_head_bid", scope_type: "department", scope_id: "d_hr" },
    });
    expect(dept.status).toBe(200);
    if (!(await json(dept)).applied) {
      const id = (await json(dept)).change?.id;
      await as("platform_admin", `/v1/admin/changes/${id}/approve`, {
        body: {},
        email: "person9@example.invalid",
      });
    }
    expect((await get("head_bid", `${C}/index`)).status).toBe(404);
    expect((await get("head_bid", `${C}/search?q=case`)).status).toBe(404);
    // An explicit circle membership needs a second person, then the wiki opens.
    const add = await as("platform_admin", "/v1/admin/memberships", {
      body: { op: "add", principalId: "u_head_bid", scope_type: "circle", scope_id: C },
    });
    expect(add.status).toBe(200);
    const out = await json(add);
    expect(out.applied).toBe(false);
    expect((await get("head_bid", `${C}/index`)).status).toBe(404);
    expect(
      (
        await as("platform_admin", `/v1/admin/changes/${out.change.id}/approve`, {
          body: {},
          email: "person8@example.invalid",
        })
      ).status,
    ).toBe(200);
    expect((await get("head_bid", `${C}/index`)).status).toBe(200);
    // And the cross-workspace search of someone without the circle does not reach it.
    const all = await json(await get("consultant", "all/search?q=case"));
    expect(JSON.stringify(all)).not.toContain(C);
  });
});
