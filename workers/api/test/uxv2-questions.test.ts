// UX v2: the Questions inbox. One feed over ingest asks, wiki proposals (contradictions, lint, review)
// and contribution candidates, with the rules of the underlying APIs on every action.

import { beforeAll, describe, expect, it } from "vitest";
import { runWikiJobs, type WikiApi } from "../src/wiki/engine.ts";
import { ALPHA, as, json, type Loose, seed, seenOf, testEnv, wsOf } from "./helpers.ts";
import { meId, plantPage } from "./uxv2-helpers.ts";

const ACC = "a_acme";
const A = "q.a@example.invalid";
const B = "q.b@example.invalid";
const R1 = "q.r1@example.invalid";
const R2 = "q.r2@example.invalid";
const WORK =
  "The pricing approach for phase 2 was agreed with the steering group. The fixed fee covers three deliverables. A quarterly review of the fee is planned.";

const questions = (persona: string, email?: string) =>
  as(persona, "/v1/questions", email ? { email } : {});
const list = async (persona: string, email?: string) =>
  json<Loose[]>(await questions(persona, email));
const resolve = (persona: string, id: string, body: Loose, email?: string) =>
  as(persona, `/v1/questions/${encodeURIComponent(id)}`, { body, ...(email ? { email } : {}) });
const wiki = (persona: string, path: string, o: Loose = {}) => as(persona, `/v1/wiki/${path}`, o);

const fact = (
  subject: string,
  predicate: string,
  object: string,
  validAt: string,
  sources: string[] = [],
) => ({
  subject,
  predicate,
  object,
  validAt,
  sourceIds: sources,
  sourceHashes: Object.fromEntries(sources.map((s) => [s, "x"])),
  confidence: 0.6,
  origin: "human" as const,
});

/** Plants valid facts the way the wiki tests do: a proposal approved at store level. */
async function plantFacts(scope: string, plane: string, facts: Loose[]) {
  const ws = wsOf(ALPHA, scope);
  await ws.wikiTouch(ALPHA, scope, Date.now());
  for (const f of facts) {
    const made = await ws.wikiPropose(
      {
        kind: "wiki_ingest",
        title: `Facts ${f.object}`,
        rationale: "t",
        origin: "human",
        pages: [],
        facts: [f],
        invalidate: [],
        confirm: [],
        archive: [],
        reingest: [],
        sources: [],
        findingKey: null,
      },
      "u_planter",
      Date.now(),
      { plane },
    );
    if (!made.ok || !made.created) throw new Error(JSON.stringify(made));
    const v = await ws.wikiProposalView(made.id);
    const d = await ws.wikiDecide(made.id, "approve", "u_checker", Date.now(), {
      revisionHash: v?.revisionHash,
    });
    if (!d.ok) throw new Error(JSON.stringify(d));
  }
}
const lint = async (ws: string, email: string, persona = "acme_lead") =>
  json(await wiki(persona, `${ws}/run`, { email, body: { jobs: ["lint"] } }));
const factsOf = async (scope: string, subject: string) =>
  (await wsOf(ALPHA, scope).wikiFacts({ subject, validOnly: false })).map((f) => [
    f.object,
    f.invalidAt?.slice(0, 10) ?? null,
  ]);

let meeting = "";
beforeAll(async () => {
  await seed();
  const m = await wiki("acme_lead", `${ACC}/meetings`, {
    email: A,
    body: {
      title: "Questions kickoff",
      date: "2026-11-03",
      decisions: [{ title: "Adopt fixed fee for phase 2", owner: "Account lead" }],
      commitments: [],
      risks: [],
    },
  });
  expect(m.status).toBe(201);
  meeting = (await json(m)).id as string;
});

describe("wiki review questions", () => {
  let id = "";

  it("an ingest proposal is a review question for a second person, with options and a revision hash", async () => {
    const res = await json(await wiki("acme_lead", `${ACC}/run`, { email: A, body: {} }));
    expect(res.results[0]).toMatchObject({ kind: "ingest", triage: "proposed" });
    const q = (await list("acme_lead", B)).find((x) => x.id === res.results[0].id);
    expect(q).toMatchObject({
      kind: "review",
      workspaceId: ACC,
      options: [
        { action: "approve", label: expect.any(String) },
        { action: "reject", label: expect.any(String) },
      ],
    });
    expect(q?.detail.revisionHash).toMatch(/^[0-9a-f]{64}$/);
    expect(q?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    id = q?.id;
  });

  it("a person who cannot review sees no such question, and cannot answer it", async () => {
    expect((await list("ceo")).map((x) => x.id)).not.toContain(id);
    const r = await resolve("ceo", id, { action: "reject" });
    expect(r.status).toBe(403);
    expect((await json(r)).reason).toBeTruthy();
    // Not in the Acme account at all: absent, the same as a question that does not exist.
    expect((await list("consultant")).map((x) => x.id)).not.toContain(id);
    expect((await resolve("consultant", id, { action: "reject" })).status).toBe(404);
  });

  it("the person who wrote the source cannot decide it", async () => {
    const q = (await list("acme_lead", A)).find((x) => x.id === id);
    const r = await resolve(
      "acme_lead",
      id,
      { action: "approve", revisionHash: q?.detail.revisionHash, seenChanges: seenOf(q) },
      A,
    );
    expect(r.status).toBe(403);
    expect((await json(r)).error).toBe("self_approval");
  });

  it("approving needs the revision that was read, and a stale one is a conflict", async () => {
    const q = (await list("acme_lead", B)).find((x) => x.id === id);
    const none = await resolve("acme_lead", id, { action: "approve" }, B);
    expect(none.status).toBe(400);
    expect((await json(none)).error).toBe("revision_required");
    const stale = await resolve(
      "acme_lead",
      id,
      { action: "approve", revisionHash: "0".repeat(64) },
      B,
    );
    expect(stale.status).toBe(409);
    const ok = await resolve(
      "acme_lead",
      id,
      { action: "approve", revisionHash: q?.detail.revisionHash, seenChanges: seenOf(q) },
      B,
    );
    expect(ok.status).toBe(200);
    expect(await json(ok)).toMatchObject({ ok: true, status: "approved" });
    expect((await list("acme_lead", B)).map((x) => x.id)).not.toContain(id);
    // A decided question cannot be decided again.
    expect((await resolve("acme_lead", id, { action: "reject" }, B)).status).toBe(409);
  });

  it("an unknown action, a malformed id and a missing question are refused", async () => {
    expect(
      (await resolve("acme_lead", id, { action: "explode" }, B)).status,
    ).toBeGreaterThanOrEqual(400);
    expect((await resolve("acme_lead", "nonsense", { action: "reject" }, B)).status).toBe(404);
    expect(
      (await resolve("acme_lead", "cand:a_acme:deadbeef", { action: "reject" }, B)).status,
    ).toBe(404);
    expect((await resolve("acme_lead", id, {}, B)).status).toBe(400);
  });
});

describe("contradictions", () => {
  const SUBJECT = "risk: Key supplier loss";
  const pending = async (email = B) =>
    (await list("acme_lead", email)).filter((x) => x.kind === "contradiction");

  beforeAll(async () => {
    await plantFacts(ACC, "ACCOUNT_RESTRICTED", [
      fact(SUBJECT, "severity", "low", "2026-08-01T00:00:00.000Z", [meeting]),
      fact(SUBJECT, "severity", "critical", "2026-09-01T00:00:00.000Z", [meeting]),
    ]);
    await lint(ACC, B);
  });

  it("shows both statements side by side with their sources", async () => {
    const q = (await pending()).find((x) => x.title.includes("Key supplier loss"));
    expect(q).toBeTruthy();
    expect(q?.detail.current).toMatchObject({
      text: "severity: low",
      validFrom: "2026-08-01T00:00:00.000Z",
      sources: [{ id: meeting, title: "Questions kickoff" }],
    });
    expect(q?.detail.incoming).toMatchObject({ text: "severity: critical" });
    expect(q?.options.map((o: Loose) => o.action)).toEqual(["prefer_incoming", "keep_current"]);
  });

  it("needs review rights: the author's account peers without them are refused, others see nothing", async () => {
    const q = (await pending())[0] as Loose;
    expect(
      (
        await resolve("ceo", q.id, {
          action: "prefer_incoming",
          revisionHash: q.detail.revisionHash,
          seenChanges: seenOf(q),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await resolve("consultant", q.id, {
          action: "prefer_incoming",
          revisionHash: q.detail.revisionHash,
          seenChanges: seenOf(q),
        })
      ).status,
    ).toBe(404);
    expect(await factsOf(ACC, SUBJECT)).toEqual([
      ["low", null],
      ["critical", null],
    ]);
  });

  it("choosing the newer statement ends the older fact and keeps it in the history", async () => {
    const q = (await pending())[0] as Loose;
    const none = await resolve("acme_lead", q.id, { action: "prefer_incoming" }, B);
    expect(none.status).toBe(400);
    const ok = await resolve(
      "acme_lead",
      q.id,
      { action: "prefer_incoming", revisionHash: q.detail.revisionHash, seenChanges: seenOf(q) },
      B,
    );
    expect(ok.status).toBe(200);
    expect(await factsOf(ACC, SUBJECT)).toEqual([
      ["low", "2026-09-01"],
      ["critical", null],
    ]);
    expect((await pending()).some((x) => x.title.includes("Key supplier loss"))).toBe(false);
  });

  it("choosing the current statement ends the incoming one instead, and confirms the current", async () => {
    const S2 = "risk: Vendor delay";
    await plantFacts(ACC, "ACCOUNT_RESTRICTED", [
      fact(S2, "severity", "medium", "2026-08-01T00:00:00.000Z", [meeting]),
      fact(S2, "severity", "high", "2026-10-01T00:00:00.000Z", [meeting]),
    ]);
    await lint(ACC, B);
    const q = (await pending()).find((x) => x.title.includes("Vendor delay")) as Loose;
    expect(q).toBeTruthy();
    const stale = await resolve(
      "acme_lead",
      q.id,
      { action: "keep_current", revisionHash: "f".repeat(64) },
      B,
    );
    expect(stale.status).toBe(409);
    expect(await factsOf(ACC, S2)).toEqual([
      ["medium", null],
      ["high", null],
    ]);
    const ok = await resolve(
      "acme_lead",
      q.id,
      { action: "keep_current", revisionHash: q.detail.revisionHash, seenChanges: seenOf(q) },
      B,
    );
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(await factsOf(ACC, S2)).toEqual([
      ["medium", null],
      ["high", "2026-10-01"],
    ]);
    // The person who chose confirms the statement they kept.
    const kept = (await wsOf(ALPHA, ACC).wikiFacts({ subject: S2, validOnly: true }))[0];
    expect(kept?.object).toBe("medium");
    expect(kept?.verifiedBy).not.toBe("u_checker");
    expect(kept?.verifiedBy).not.toBeNull();
  });

  it("masks both sides when a source is not readable for the caller", async () => {
    const SRC = `src:abcdef:${"ux2contra".padEnd(24, "0")}`;
    await wsOf(ALPHA, ACC).sourceUpsert([
      {
        id: SRC,
        sourceId: "abcdef",
        gateNodeId: "a_acme:con",
        plane: "ACCOUNT_RESTRICTED",
        title: "Restructuring plan Lyon.md",
        body: "x",
        webUrl: null,
        mime: "text/markdown",
        size: 1,
        eTag: "e1",
        syncedAt: Date.now(),
      },
    ]);
    const S3 = "risk: Lyon closure";
    await plantFacts(ACC, "ACCOUNT_RESTRICTED", [
      fact(S3, "severity", "minor", "2026-08-01T00:00:00.000Z", [SRC]),
      fact(S3, "severity", "severe", "2026-09-01T00:00:00.000Z", [SRC]),
    ]);
    await lint(ACC, B);
    const q = (await pending()).find(
      (x) =>
        JSON.stringify(x).includes("restricted source") &&
        x.detail.current.text === "restricted source",
    );
    expect(q).toBeTruthy();
    const body = JSON.stringify(q);
    expect(body).not.toContain("Lyon");
    expect(body).not.toContain("severe");
  });
});

describe("lint questions", () => {
  it("a lint finding is a lint question that can be dismissed", async () => {
    await plantPage(ACC, {
      id: "ux2-uncited",
      type: "topic",
      title: "Loose notes",
      markdown:
        "# Loose notes\n\n## Summary\n- Says something without any source\n- And another unsupported claim\n",
    });
    await lint(ACC, B);
    const q = (await list("acme_lead", B)).find(
      (x) => x.kind === "lint" && x.title.startsWith("Uncited"),
    );
    expect(q).toBeTruthy();
    expect(q?.options.map((o: Loose) => o.action)).toEqual(["approve", "reject"]);
    expect((await resolve("acme_lead", q?.id, { action: "prefer_incoming" }, B)).status).toBe(403);
    const r = await resolve("acme_lead", q?.id, { action: "reject" }, B);
    expect(r.status).toBe(200);
    expect((await list("acme_lead", B)).map((x) => x.id)).not.toContain(q?.id);
  });
});

describe("review and release questions", () => {
  const contribute = async (persona: string, node: string, title: string, payload: Loose = {}) => {
    const email = `${persona}@example.invalid`;
    const r = await as("ceo" === persona ? "ceo" : persona, "/v1/actions", {
      body: {
        nodeId: node,
        action: "contribute",
        payload: {
          title,
          body: WORK,
          user_validated: { by: email, at: new Date().toISOString(), revision: 1 },
          ...payload,
        },
      },
    });
    expect(r.status, await r.clone().text()).toBe(201);
    return (await json(r)).candidateId as string;
  };

  it("a Company Global release is a release question that needs two different people and the revision read", async () => {
    const cid = await contribute("ceo", "core", "Global pricing lesson", {
      releaseTarget: "global",
    });
    const q = (await list("reviewer", R1)).find((x) => x.id === cid) as Loose;
    expect(q).toMatchObject({
      kind: "release",
      workspaceId: "core",
      detail: { required: 2, approvals: 0, release: "global" },
    });
    expect(q.options.map((o: Loose) => o.action)).toEqual(["approve", "request_changes"]);
    // Not the author, not someone without the right.
    expect((await list("ceo")).map((x) => x.id)).not.toContain(cid);
    expect(
      (
        await resolve("ceo", cid, {
          action: "approve",
          revisionHash: q.detail.revisionHash,
          seenChanges: seenOf(q),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await resolve("consultant", cid, {
          action: "approve",
          revisionHash: q.detail.revisionHash,
          seenChanges: seenOf(q),
        })
      ).status,
    ).toBe(403);
    expect((await resolve("reviewer", cid, { action: "approve" }, R1)).status).toBe(400);
    expect(
      (await resolve("reviewer", cid, { action: "approve", revisionHash: "a".repeat(32) }, R1))
        .status,
    ).toBe(409);
    const first = await json(
      await resolve(
        "reviewer",
        cid,
        { action: "approve", revisionHash: q.detail.revisionHash, seenChanges: seenOf(q) },
        R1,
      ),
    );
    expect(first).toMatchObject({ ok: true, released: false, approvals: 1, required: 2 });
    // The same person again does not count twice.
    const again = await resolve(
      "reviewer",
      cid,
      { action: "approve", revisionHash: q.detail.revisionHash, seenChanges: seenOf(q) },
      R1,
    );
    expect(again.status).toBe(409);
    const second = await json(
      await resolve(
        "reviewer",
        cid,
        { action: "approve", revisionHash: q.detail.revisionHash, seenChanges: seenOf(q) },
        R2,
      ),
    );
    expect(second).toMatchObject({ ok: true, released: true, approvals: 2 });
    expect((await list("reviewer", R1)).map((x) => x.id)).not.toContain(cid);
  });

  it("requesting changes on a candidate records the reason and returns it to its author", async () => {
    const cid = await contribute("consultant", "c_delivery", "Delivery playbook idea");
    const q = (await list("reviewer", R1)).find((x) => x.id === cid) as Loose;
    expect(q.kind).toBe("release");
    const r = await resolve(
      "reviewer",
      cid,
      {
        action: "request_changes",
        revisionHash: q.detail.revisionHash,
        seenChanges: seenOf(q),
        note: "Add the source",
      },
      R1,
    );
    expect(r.status).toBe(200);
    const comments = await wsOf(ALPHA, "c_delivery").comments(cid, 10);
    expect(comments.map((x) => x.text)).toContain("Add the source");
  });

  it("a steward who can only review gets the review options, not release", async () => {
    // Acme's lead reviews candidates in the account but cannot release them.
    const cid = await contribute("head_bid", ACC, "Account lesson", {});
    const q = (await list("acme_lead", A)).find((x) => x.id === cid) as Loose;
    expect(q.kind).toBe("review");
    expect(q.options.map((o: Loose) => o.action)).toEqual(["accept", "request_changes"]);
    const bad = await resolve(
      "acme_lead",
      cid,
      { action: "approve", revisionHash: q.detail.revisionHash, seenChanges: seenOf(q) },
      A,
    );
    expect(bad.status).toBe(403);
    const ok = await resolve(
      "acme_lead",
      cid,
      { action: "accept", revisionHash: q.detail.revisionHash, seenChanges: seenOf(q) },
      A,
    );
    expect(ok.status).toBe(200);
  });
});

describe("ingest questions from routines", () => {
  const mk = async (persona: string, over: Loose = {}) =>
    json(
      await as(persona, "/v1/routines", {
        body: {
          name: "Asks",
          source: { kind: "manual" },
          schedule: "manual",
          targetScopeId: "c_delivery",
          guardrails: { excludePersonal: true, excludeHR: true, excludeNewsletters: true },
          ...over,
        },
      }),
    );

  it("an ask becomes an ingest question for its owner only, and ingesting writes where the owner may", async () => {
    const rt = await mk("consultant");
    await as("consultant", `/v1/routines/${rt.id}/run`, {
      body: { items: [{ title: "Status note", text: `${WORK} My son is sick today.` }] },
    });
    const q = (await list("consultant")).find((x) => x.kind === "ingest") as Loose;
    expect(q).toMatchObject({
      title: "Status note",
      workspaceId: "c_delivery",
      options: [{ action: "ingest" }, { action: "skip" }],
    });
    expect(q.detail.excerpt).toContain("fixed fee");
    expect(q.detail.excerpt).not.toContain("son is sick");
    // Nobody else sees it or can answer it.
    for (const p of ["head_bid", "reviewer", "ceo", "platform_admin"])
      expect(
        (await list(p)).map((x) => x.id),
        p,
      ).not.toContain(q.id);
    expect((await resolve("head_bid", q.id, { action: "ingest" })).status).toBe(404);
    expect((await resolve("consultant", q.id, { action: "approve" })).status).toBe(403);
    const ok = await resolve("consultant", q.id, { action: "ingest" });
    expect(ok.status).toBe(200);
    const cands = await wsOf(ALPHA, "c_delivery").listByKind("candidate", 100);
    const made = cands.find((x) => x.label === "Status note");
    expect(made?.body).not.toContain("son is sick");
    expect((await list("consultant")).map((x) => x.id)).not.toContain(q.id);
    expect((await resolve("consultant", q.id, { action: "ingest" })).status).toBe(404);
  });

  it("skip closes the question and writes nothing", async () => {
    const rt = await mk("consultant", { name: "Skips" });
    await as("consultant", `/v1/routines/${rt.id}/run`, {
      body: {
        items: [{ title: "Contact list", text: `${WORK} Write to jane.doe@example.invalid.` }],
      },
    });
    const q = (await list("consultant")).find((x) => x.title === "Contact list") as Loose;
    expect((await resolve("consultant", q.id, { action: "skip" })).status).toBe(200);
    const cands = await wsOf(ALPHA, "c_delivery").listByKind("candidate", 100);
    expect(cands.some((x) => x.label === "Contact list")).toBe(false);
    const stored = JSON.stringify(
      await wsOf(ALPHA, `personal:${await meId("consultant")}`).listByKind("u2_ask", 50),
    );
    expect(stored).not.toContain("jane.doe");
  });

  it("an answer is held to today's rights: a target the owner lost refuses the ingest and leaves the question open", async () => {
    const id = await meId("consultant");
    await wsOf(ALPHA, `personal:${id}`).create(
      {
        id: "ask:00000000000000aa",
        label: "Old question",
        kind: "u2_ask",
        plane: "PERSONAL_HOSTED",
        origin: "personal",
        status: "open",
        authorId: id,
        body: JSON.stringify({
          routineId: "rt:00000000",
          targetScopeId: "a_acme",
          reason: "r",
          text: WORK,
        }),
      },
      Date.now(),
    );
    const r = await resolve("consultant", "ask:00000000000000aa", { action: "ingest" });
    expect(r.status).toBe(403);
    expect((await list("consultant")).map((x) => x.id)).toContain("ask:00000000000000aa");
    expect(JSON.stringify(await wsOf(ALPHA, ACC).listByKind("candidate", 100))).not.toContain(
      "Old question",
    );
  });
});

describe("absence", () => {
  it("nothing about an NDA account without a grant reaches any inbox, and its ids answer 404", async () => {
    await plantPage("a_calypso", {
      id: "ux2-calypso-q",
      type: "topic",
      title: "Calypso loose notes",
      markdown: "# Calypso loose notes\n\n## Summary\n- Calypso claim without any source\n",
    });
    await plantFacts("a_calypso", "ACCOUNT_RESTRICTED", [
      fact("risk: Calypso exit", "severity", "low", "2026-08-01T00:00:00.000Z"),
      fact("risk: Calypso exit", "severity", "high", "2026-09-01T00:00:00.000Z"),
    ]);
    const ws = wsOf(ALPHA, "a_calypso");
    await ws.wikiEnqueue("lint", {}, Date.now(), Date.now());
    await runWikiJobs(ws as unknown as WikiApi, {
      env: testEnv({}),
      now: Date.now(),
      dueAt: Number.MAX_SAFE_INTEGER,
    });
    const planted = (await ws.pending(50)).map((x) => x.id);
    expect(planted.length).toBeGreaterThan(1);
    for (const p of [
      "ceo",
      "head_bid",
      "acme_lead",
      "consultant",
      "reviewer",
      "platform_admin",
      "auditor",
    ]) {
      const body = JSON.stringify(await list(p));
      expect(body, p).not.toMatch(/calypso/i);
      for (const id of planted)
        expect((await resolve(p, id, { action: "reject" })).status, `${p} ${id}`).toBe(404);
    }
  });
});
