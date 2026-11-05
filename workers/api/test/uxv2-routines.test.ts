// UX v2: routines, the classifier, the token ledger and GET /v1/usage.

import { beforeAll, describe, expect, it } from "vitest";
import { classify } from "../src/uxv2/classifier.ts";
import { aiCall, KEY, stubModel } from "./ai-helpers.ts";
import { ALPHA, as, json, type Loose, seed, wsOf } from "./helpers.ts";
import { meId } from "./uxv2-helpers.ts";

beforeAll(async () => {
  await seed();
});

const WORK =
  "The pricing approach for phase 2 was agreed with the steering group. The fixed fee covers three deliverables. A quarterly review of the fee is planned.";

const routines = (persona: string, path = "", o: Loose = {}) =>
  as(persona, `/v1/routines${path}`, o);
const make = async (persona: string, over: Loose = {}, o: Loose = {}) =>
  routines(persona, "", {
    body: {
      name: "Delivery notes",
      source: { kind: "manual" },
      schedule: "manual",
      targetScopeId: "c_delivery",
      guardrails: { excludePersonal: true, excludeHR: true, excludeNewsletters: true },
      enabled: true,
      ...over,
    },
    ...o,
  });
const run = (persona: string, id: string, items: Loose[], o: Loose = {}) =>
  routines(persona, `/${encodeURIComponent(id)}/run`, { method: "POST", body: { items }, ...o });

describe("the classifier", () => {
  const rules = { excludeNewsletters: true };
  const c = (title: string, text: string) => classify({ key: "k", title, text }, rules);

  it("ingests clean work text", () => {
    expect(c("Phase 2 pricing", WORK)).toMatchObject({ verdict: "ingest" });
  });

  it("skips personal content (R-110), keeping nothing of it", () => {
    const r = c(
      "Weekend",
      "My daughter has surgery on Friday. I booked a flight to Lisbon for the holidays.",
    );
    expect(r.verdict).toBe("skip");
    expect(r.kept).toBe("");
    expect(r.excluded).not.toEqual({});
  });

  it("asks when only some passages are personal, and the stored text has them removed", () => {
    const r = c("Status", `${WORK} My son is sick today.`);
    expect(r.verdict).toBe("ask");
    expect(r.kept).not.toContain("son is sick");
    expect(r.kept).toContain("fixed fee");
  });

  it("skips HR matters whatever the wording, by title or by text", () => {
    expect(c("Salary review 2027", WORK).verdict).toBe("skip");
    expect(c("Notes", `${WORK} The disciplinary hearing is on Monday.`).verdict).toBe("skip");
    expect(c("Notes", `${WORK} Payroll changes next month.`).reason).toBe("HR matter");
  });

  it("skips newsletters only while the guardrail is on", () => {
    const text = `${WORK} Click to unsubscribe from this newsletter.`;
    expect(c("Digest", text).verdict).toBe("skip");
    expect(
      classify({ key: "k", title: "Digest", text }, { excludeNewsletters: false }).verdict,
    ).toBe("ingest");
  });

  it("asks when contact details are present and masks them in what would be stored", () => {
    const r = c("Contact", `${WORK} Write to jane.doe@example.invalid or call +33 1 23 45 67 89.`);
    expect(r.verdict).toBe("ask");
    expect(r.kept).not.toContain("jane.doe@");
    expect(r.kept).toContain("[email removed]");
  });

  it("skips empty text", () => {
    expect(c("x", "ok").verdict).toBe("skip");
  });
});

describe("routines: CRUD and ownership", () => {
  it("creates, lists, reads, updates and deletes a routine, owned by its maker only", async () => {
    const made = await make("consultant");
    expect(made.status).toBe(201);
    const rt = await json(made);
    expect(rt).toMatchObject({
      name: "Delivery notes",
      source: { kind: "manual" },
      targetScopeId: "c_delivery",
      enabled: true,
      guardrails: { excludePersonal: true, excludeHR: true, excludeNewsletters: true },
    });
    expect(rt.id).toMatch(/^rt:[0-9a-f]{8}$/);
    expect((await json<Loose[]>(await routines("consultant"))).map((x) => x.id)).toContain(rt.id);
    expect((await routines("consultant", `/${rt.id}`)).status).toBe(200);
    // Somebody else sees none of it.
    expect((await json<Loose[]>(await routines("head_bid"))).map((x) => x.id)).not.toContain(rt.id);
    expect((await routines("head_bid", `/${rt.id}`)).status).toBe(404);
    expect((await routines("head_bid", `/${rt.id}`, { method: "DELETE" })).status).toBe(404);
    expect((await run("head_bid", rt.id, [])).status).toBe(404);
    const upd = await routines("consultant", `/${rt.id}`, {
      method: "PUT",
      body: { name: "Renamed", enabled: false, guardrails: { excludeNewsletters: false } },
    });
    expect(upd.status).toBe(200);
    expect(await json(upd)).toMatchObject({
      name: "Renamed",
      enabled: false,
      guardrails: { excludePersonal: true, excludeHR: true, excludeNewsletters: false },
    });
    expect((await run("consultant", rt.id, [])).status).toBe(409);
    expect((await routines("consultant", `/${rt.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await routines("consultant", `/${rt.id}`)).status).toBe(404);
  });

  it("refuses bad input, and refuses to switch the personal or HR guardrails off", async () => {
    for (const over of [
      { name: "" },
      { source: { kind: "ftp" } },
      { source: { kind: "meetings" } },
      { schedule: "hourly" },
      { targetScopeId: 5 },
      { guardrails: { excludePersonal: false } },
      { guardrails: { excludeHR: false } },
      { enabled: "yes" },
    ]) {
      const r = await make("consultant", over);
      expect(r.status, JSON.stringify(over)).toBe(400);
    }
  });
});

describe("routines: where they may write", () => {
  it("cannot target a scope the owner cannot contribute to, or cannot see", async () => {
    // Absent from the view: same answer as a scope that does not exist.
    for (const target of ["a_acme", "a_calypso", "c_bid", "nonexistent"]) {
      const r = await make("consultant", { targetScopeId: target });
      expect(r.status, target).toBe(404);
    }
    // Visible but no right to contribute: refused with the reason.
    const r = await make("reviewer", { targetScopeId: "core" });
    expect(r.status).toBe(403);
    expect((await json(r)).reason).toBeTruthy();
    // And no routine was stored by any of those.
    expect(await json<Loose[]>(await routines("consultant"))).toEqual([]);
  });

  it("an update cannot move the target somewhere the owner cannot write", async () => {
    const rt = await json(await make("consultant"));
    for (const target of ["a_acme", "a_calypso"]) {
      const r = await routines("consultant", `/${rt.id}`, {
        method: "PUT",
        body: { targetScopeId: target },
      });
      expect(r.status, target).toBe(404);
    }
    expect((await json(await routines("consultant", `/${rt.id}`))).targetScopeId).toBe(
      "c_delivery",
    );
    await routines("consultant", `/${rt.id}`, { method: "DELETE" });
  });

  it("a stored routine is checked again at every run: rights that are gone mean no read and no write", async () => {
    const id = await meId("consultant");
    // A routine whose target the owner can no longer reach (planted below the API, as after a revocation).
    await wsOf(ALPHA, `personal:${id}`).scratch(
      {
        id: "rt:deadbeef",
        label: "Stale routine",
        kind: "u2_routine",
        plane: "PERSONAL_HOSTED",
        origin: "personal",
        status: "draft",
        authorId: id,
        body: JSON.stringify({
          source: { kind: "manual" },
          schedule: "manual",
          targetScopeId: "a_acme",
          guardrails: { excludePersonal: true, excludeHR: true, excludeNewsletters: true },
          enabled: true,
        }),
      },
      Date.now(),
    );
    const r = await run("consultant", "rt:deadbeef", [{ title: "Pricing", text: WORK }]);
    expect(r.status).toBe(404);
    const candidates = await wsOf(ALPHA, "a_acme").listByKind("candidate", 100);
    expect(JSON.stringify(candidates)).not.toContain("Pricing");
    // The refusal is on the record.
    const rec = await as("platform_admin", "/v1/admin/audit");
    expect(JSON.stringify(await json(rec))).toContain("routine.run");
  });
});

describe("routines: runs", () => {
  it("ingests clean text into a shared scope as a candidate that waits for review, never as a direct write", async () => {
    const rt = await json(await make("consultant"));
    const r = await run("consultant", rt.id, [{ title: "Phase 2 pricing", text: WORK }]);
    expect(r.status).toBe(200);
    const out = await json(r);
    expect(out).toMatchObject({ ingested: 1, skipped: 0, asked: 0, tokens: 0 });
    expect(out.items).toEqual([
      { title: "Phase 2 pricing", verdict: "ingest", reason: expect.any(String) },
    ]);
    const cands = await wsOf(ALPHA, "c_delivery").listByKind("candidate", 100);
    const mine = cands.find((x) => x.label === "Phase 2 pricing");
    expect(mine).toMatchObject({
      status: "candidate",
      targetNode: "c_delivery",
      origin: "candidate",
    });
    expect(mine?.tags).toContain("routine");
    // The same item is not looked at twice.
    const again = await json(
      await run("consultant", rt.id, [{ title: "Phase 2 pricing", text: WORK }]),
    );
    expect(again).toMatchObject({ ingested: 0, skipped: 0, asked: 0, items: [] });
    // The run is in the log.
    const log = await json<Loose[]>(await routines("consultant", `/${rt.id}/runs`));
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({
      id: expect.stringMatching(/^run:/),
      ingested: expect.any(Number),
    });
    // Another person cannot read the log.
    expect((await routines("head_bid", `/${rt.id}/runs`)).status).toBe(404);
  });

  it("sends personal, HR and newsletter content to skip or ask, and writes none of it anywhere shared", async () => {
    const rt = await json(await make("consultant", { name: "Mixed" }));
    const items = [
      {
        title: "Weekend plans",
        text: "My daughter has surgery on Friday. I booked a flight to Lisbon for the holidays.",
      },
      { title: "Salary review 2027", text: WORK },
      { title: "Product newsletter", text: `${WORK} Click to unsubscribe from this newsletter.` },
      { title: "Status with a personal line", text: `${WORK} My son is sick today.` },
      { title: "Contact sheet", text: `${WORK} Write to jane.doe@example.invalid.` },
      { title: "Clean update", text: `${WORK} The workshop is on Tuesday.` },
    ];
    const out = await json(await run("consultant", rt.id, items));
    const by = Object.fromEntries(out.items.map((x: Loose) => [x.title, x.verdict]));
    expect(by).toMatchObject({
      "Weekend plans": "skip",
      "(title withheld)": "skip",
      "Product newsletter": "skip",
      "Status with a personal line": "ask",
      "Contact sheet": "ask",
      "Clean update": "ingest",
    });
    expect(out).toMatchObject({ ingested: 1, skipped: 3, asked: 2 });
    const stored = JSON.stringify(await wsOf(ALPHA, "c_delivery").listByKind("candidate", 200));
    for (const leaked of ["daughter", "Lisbon", "Salary", "unsubscribe", "son is sick", "jane.doe"])
      expect(stored, leaked).not.toContain(leaked);
    // What an ask keeps is the cleaned text, in the owner's own workspace.
    const id = await meId("consultant");
    const asks = await wsOf(ALPHA, `personal:${id}`).listByKind("u2_ask", 50);
    const body = JSON.stringify(asks);
    expect(body).toContain("fixed fee");
    for (const leaked of ["son is sick", "jane.doe", "daughter"])
      expect(body, leaked).not.toContain(leaked);
  });

  it("a notes routine reads the owner's notes, and never sends them to the model", async () => {
    await as("consultant", "/v1/personal/items", {
      body: { title: "Delivery lesson", body: WORK, kind: "note" },
    });
    const rt = await json(
      await make("consultant", { name: "From notes", source: { kind: "notes" } }),
    );
    expect(
      (await make("consultant", { source: { kind: "notes" }, targetScopeId: "me" })).status,
    ).toBe(400);
    const m = stubModel(() => ({ verdict: "skip", reason: "not useful" }));
    const r = await aiCall("consultant", `/v1/routines/${rt.id}/run`, {
      method: "POST",
      env: { ...KEY },
      fetch: m.fetch,
    });
    expect(r.status).toBe(200);
    expect((await json(r)).ingested).toBe(1);
    expect(m.calls).toHaveLength(0);
  });

  it("a meetings routine reads only a workspace the owner can read", async () => {
    expect((await make("consultant", { source: { kind: "meetings", ref: "a_acme" } })).status).toBe(
      400,
    );
    expect(
      (await make("consultant", { source: { kind: "meetings", ref: "a_calypso" } })).status,
    ).toBe(400);
  });

  it("the model may only tighten a verdict, never loosen one", async () => {
    const rt = await json(await make("consultant", { name: "AI check" }));
    const m = stubModel((call) =>
      /Quarterly forecast/.test(call.user)
        ? { verdict: "skip", reason: "Not shareable" }
        : { verdict: "ingest", reason: "Looks fine" },
    );
    const r = await aiCall("consultant", `/v1/routines/${rt.id}/run`, {
      method: "POST",
      body: {
        items: [
          { title: "Quarterly forecast", text: `${WORK} Forecast figures below.` },
          { title: "Salary review 2028", text: WORK },
          { title: "Plain update", text: `${WORK} Nothing else to add.` },
        ],
      },
      env: { ...KEY },
      fetch: m.fetch,
    });
    expect(r.status).toBe(200);
    const out = await json(r);
    const by = Object.fromEntries(out.items.map((x: Loose) => [x.title, x]));
    expect(by["Quarterly forecast"]).toMatchObject({
      verdict: "skip",
      reason: "AI: Not shareable",
    });
    // An HR item never reaches the model, and "ingest" from the model cannot override the rules.
    expect(by["(title withheld)"]?.verdict ?? by["Salary review 2028"]?.verdict).toBe("skip");
    expect(by["Plain update"].verdict).toBe("ingest");
    expect(m.calls).toHaveLength(2);
    for (const call of m.calls) expect(call.user).not.toMatch(/salary/i);
    expect(out.tokens).toBeGreaterThan(0);
  });

  it("every run is counted in the ledger, with its tokens", async () => {
    const u = await json(await as("consultant", "/v1/usage?period=7d"));
    const routine = u.byCapability.find((x: Loose) => x.capability === "routine");
    expect(routine.runs).toBeGreaterThanOrEqual(3);
    expect(routine.tokens).toBeGreaterThan(0);
  });
});

describe("GET /v1/usage", () => {
  it("shows a person their own tokens, and the tenant view only to an admin", async () => {
    const mine = await json(await as("consultant", "/v1/usage"));
    expect(mine.me).toMatchObject({
      tokens: expect.any(Number),
      runs: expect.any(Number),
      answers: expect.any(Number),
      savedPct: expect.any(Number),
    });
    expect(Array.isArray(mine.byCapability)).toBe(true);
    for (const p of ["ceo", "head_bid", "acme_lead", "consultant", "reviewer", "auditor"]) {
      const body = await json(await as(p, "/v1/usage?period=30d"));
      expect(body, p).not.toHaveProperty("tenant");
      expect(JSON.stringify(body), p).not.toContain("tenant");
    }
    const admin = await json(await as("platform_admin", "/v1/usage"));
    expect(admin.tenant).toBeTruthy();
    expect(admin.tenant.tokens).toBeGreaterThanOrEqual(mine.me.tokens);
    expect(admin.tenant.byCapability.map((x: Loose) => x.capability)).toContain("routine");
    // The admin's own numbers stay their own.
    expect(admin.me.tokens).toBeLessThanOrEqual(admin.tenant.tokens);
  });

  it("only knows 7d and 30d, and one person never sees another's usage", async () => {
    expect((await as("consultant", "/v1/usage?period=1y")).status).toBe(400);
    expect((await as("consultant", "/v1/usage?period=7d")).status).toBe(200);
    const other = await json(await as("head_bid", "/v1/usage"));
    const mine = await json(await as("consultant", "/v1/usage"));
    expect(other.me.runs).toBeLessThan(mine.me.runs);
  });

  it("the planner and briefs write the ledger too", async () => {
    const m = stubModel(
      () => ({
        version: 1,
        title: "Account overview",
        components: [{ type: "NodeCard", props: { nodeId: "a_acme" } }],
      }),
      {
        input_tokens: 200,
        output_tokens: 50,
      },
    );
    const r = await aiCall("acme_lead", "/v1/genui/plan", {
      body: { prompt: "show the account", nodeId: "a_acme" },
      env: { ...KEY },
      fetch: m.fetch,
    });
    expect(r.status).toBe(200);
    const u = await json(await aiCall("acme_lead", "/v1/usage"));
    expect(u.byCapability.map((x: Loose) => x.capability)).toContain("planner");
  });
});
