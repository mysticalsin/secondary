// v7 brain rules: authority, floors, enforcement on the API, MCP, import, export and connector paths,
// monitor mode, two-person publish and rollback, incident mode, held actions, the simulation against
// a fixture of receipts, and receipts that carry ruleId@version.

import { type RuleDraft, type SimEvent, simulateRules } from "@secondary/policy";
import { beforeAll, describe, expect, it } from "vitest";
import { appendReceipt, fetchReceipts, newReceiptId } from "../src/audit.ts";
import { type InternalPrincipal, signInternalRequest } from "../src/internal-auth.ts";
import { ensureRulesSeed, RULES_SEED_VERSION, SEED_RULES } from "../src/rules/seed.ts";
import { zip } from "../src/uxv2/zip.ts";
import {
  ALPHA,
  as,
  call,
  json,
  type Loose,
  rawEnv,
  seed,
  seenOf,
  tenantDo,
  testEnv,
} from "./helpers.ts";
import { plantPage } from "./uxv2-helpers.ts";

const KEY = (rawEnv as unknown as Env).INTERNAL_HMAC_KEY as string;
const ADMIN = "v7.admin@example.invalid";
const ADMIN2 = "v7.admin2@example.invalid";
const BID = "v7.bid@example.invalid";
const CONS = "v7.cons@example.invalid";
const REV = "v7.rev@example.invalid";
const REV2 = "v7.rev2@example.invalid";
const MD = (t: string) => `# ${t}\n\n## Summary\n- The delivery gate is signed before release.\n`;

const when = (field: string, op: string, ...values: string[]) => ({ field, op, values });
const rule = (over: Loose = {}) => ({
  name: "V7 rule",
  scope: { kind: "brains", ids: ["c_delivery"] },
  when: [when("action", "is_any_of", "propose_page")],
  then: { effect: "block", message: "Pages are paused here today." },
  except: { incident: false },
  status: "enforced",
  ...over,
});

const admin = (path: string, o: Loose = {}) =>
  as("platform_admin", `/v1/rules${path}`, { email: ADMIN, ...o });
const admin2 = (path: string, o: Loose = {}) =>
  as("platform_admin", `/v1/rules${path}`, { email: ADMIN2, ...o });
const bid = (path: string, o: Loose = {}) =>
  as("head_bid", `/v1/rules${path}`, { email: BID, ...o });

async function create(who: typeof admin, body: Loose): Promise<Loose> {
  const r = await who("", { method: "POST", body });
  expect(r.status, await r.clone().text()).toBe(201);
  return json(r);
}
/** Publish by one person (a rule that touches no protected brain is single-person). */
async function publish(who: typeof admin, id: string, body: Loose = {}): Promise<Loose> {
  const r = await who(`/${id}/publish`, { method: "POST", body });
  expect(r.status, await r.clone().text()).toBe(200);
  return json(r);
}
/** Replace a rule's draft, then publish it (a new version). */
async function revise(who: typeof admin, id: string, body: Loose, status: string): Promise<Loose> {
  const r = await who(`/${id}`, { method: "PUT", body });
  expect(r.status, await r.clone().text()).toBe(200);
  return publish(who, id, { status });
}
/** Withdraw so a later test never meets this rule. */
const retire = (who: typeof admin, id: string, scope: Loose) =>
  revise(who, id, rule({ scope, status: "draft" }), "draft");

async function mcp(
  path: string,
  body: Loose,
  o: { email?: string; persona?: string; tool?: string } = {},
) {
  const url = `https://secondary.example.test${path}`;
  const raw = JSON.stringify(body);
  const principal: InternalPrincipal = {
    v: 1,
    iss: "secondary-mcp",
    aud: "secondary-api",
    sub: `sub-${o.email ?? CONS}`,
    email: o.email ?? CONS,
    persona: o.persona ?? "consultant",
    client_id: "claude.ai",
    grant_id: "g_v7",
    host: "claude_ai",
    scope: ["secondary.read", "secondary.contribute"],
    tool: o.tool ?? "propose_page",
  };
  const headers = await signInternalRequest({
    secret: KEY,
    method: "POST",
    url,
    body: raw,
    principal,
    now: Math.floor(Date.now() / 1000),
  });
  return call(path, {
    method: "POST",
    token: null,
    rawBody: raw,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

/** Each export is rate limited per minute: a later minute for each call, so a test can make many. */
let tick = Date.now();
const nextMinute = (): number => {
  tick += 61_000;
  return tick;
};
const receipts = async () => (await fetchReceipts(testEnv(), ALPHA, null, 1, 1000)) ?? [];
const queue = async (scope: string) =>
  json<Loose[]>(
    await as("reviewer", `/v1/wiki/${scope}/proposals?status=candidate`, { email: REV }),
  );
const proposeApi = (scope: string, title: string, email = CONS, persona = "consultant") =>
  as(persona, `/v1/wiki/${scope}/propose`, { email, body: { title, markdown: MD(title) } });
const pushPage = (scope: string, title: string) =>
  mcp(`/v1/brains/${scope}/push/page`, { title, markdown: MD(title) });

const meId = async (persona: string, email: string): Promise<string> =>
  (await json(await as(persona, "/v1/me", { email }))).principal.id as string;

beforeAll(async () => {
  await seed();
  for (const id of ["v7-gate", "v7-gate-2"])
    await plantPage(
      "c_delivery",
      { id, type: "topic", title: id, markdown: MD(id) },
      "TEAM_RESTRICTED",
    );
});

describe("authority", () => {
  it("admins see tenant rules, stewards see their brain, everyone else gets 404", async () => {
    const a = await json<Loose>(await admin(""));
    expect(a.rules[0]).toMatchObject({
      id: "floor:mcp_review",
      readOnly: true,
      floor: "mcp_review",
      status: "enforced",
    });
    expect(a.counts.total).toBe(0);
    expect(a.incident.on).toBe(false);
    expect((await as("consultant", "/v1/rules", { email: CONS })).status).toBe(404);
    expect((await bid("")).status).toBe(404);
    const mine = await bid("?brain=c_bid");
    expect(mine.status).toBe(200);
    expect((await json<Loose>(mine)).brain).toMatchObject({ id: "c_bid" });
    // Not a steward of that brain, or no such brain: the same 404.
    expect((await bid("?brain=c_delivery")).status).toBe(404);
    expect((await as("consultant", "/v1/rules?brain=c_delivery", { email: CONS })).status).toBe(
      404,
    );
    expect((await bid("?brain=c_nonexistent")).status).toBe(404);
    // A Personal Brain never carries rules.
    expect((await bid("?brain=me")).status).toBe(404);
  });

  it("a steward can write rules for their own brains only", async () => {
    for (const scope of [
      { kind: "tenant" },
      { kind: "brain_types", types: ["team"] },
      { kind: "brains", ids: ["c_delivery"] },
      { kind: "brains", ids: ["c_bid", "c_delivery"] },
    ]) {
      const r = await bid("", { method: "POST", body: rule({ scope }) });
      expect(r.status, JSON.stringify(scope)).toBe(403);
      expect((await json<Loose>(r)).error).toBe("scope_not_allowed");
    }
    const ok = await bid("", {
      method: "POST",
      body: rule({ scope: { kind: "brains", ids: ["c_bid"] } }),
    });
    expect(ok.status).toBe(201);
    const id = (await json<Loose>(ok)).id as string;
    // The admin sees it; a steward of another brain does not.
    expect((await admin(`/${id}`)).status).toBe(200);
    expect((await as("consultant", `/v1/rules/${id}`, { email: CONS })).status).toBe(404);
    // A rule an admin wrote for c_delivery is not the c_bid steward's to open.
    const other = await create(admin, rule({ name: "Admin only c_delivery" }));
    expect((await bid(`/${other.id}`)).status).toBe(404);
    expect((await bid(`/${other.id}`, { method: "PUT", body: rule() })).status).toBe(404);
    expect((await bid(`/${other.id}/publish`, { method: "POST", body: {} })).status).toBe(404);
    // A tenant rule that reaches c_bid is listed there, read-only.
    const tenantRule = await create(
      admin,
      rule({ name: "Admin tenant", scope: { kind: "tenant" } }),
    );
    const list = await json<Loose>(await bid("?brain=c_bid"));
    expect(list.rules.find((x: Loose) => x.id === tenantRule.id)).toMatchObject({
      editable: false,
    });
    expect(list.rules.some((x: Loose) => x.id === other.id)).toBe(false);
    expect(
      (await bid(`/${tenantRule.id}`, { method: "PUT", body: rule({ scope: { kind: "tenant" } }) }))
        .status,
    ).toBe(404);
    // Wire up the admin rule counts for the next test.
    const all = await json<Loose>(await admin(""));
    expect(all.counts).toMatchObject({ total: 3, draft: 3, enforced: 0, monitor: 0 });
    expect(all.counts.new).toBe(3);
  });
});

describe("hard floors, through the API", () => {
  let totalBefore = 0;
  beforeAll(async () => {
    totalBefore = (await json<Loose>(await admin(""))).counts.total;
  });
  const cases: [string, Loose][] = [
    ["personal_privacy", rule({ scope: { kind: "brain_types", types: ["personal", "team"] } })],
    ["nda_named_grants", rule({ then: { effect: "grant_access" } })],
    [
      "global_two_person",
      rule({
        when: [when("action", "is_any_of", "promote_to_global")],
        then: { effect: "review" },
      }),
    ],
    [
      "every_change_seen",
      rule({
        when: [when("action", "is_any_of", "publish"), when("brain_type", "is_any_of", "team")],
        then: { effect: "notify" },
      }),
    ],
    ["everyone_ban", rule({ then: { effect: "open_to_everyone" } })],
    [
      "ai_gate",
      rule({
        when: [
          when("actor", "is_any_of", "agent"),
          when("ai_contract", "is_any_of", "not_allowed"),
        ],
        then: { effect: "review" },
      }),
    ],
    [
      "mcp_review",
      rule({
        when: [when("actor", "is_any_of", "claude"), when("action", "is_any_of", "propose_page")],
        then: { effect: "notify" },
      }),
    ],
  ];
  for (const [floor, body] of cases)
    it(`refuses a rule that would loosen ${floor}, with the reason, on save and on validate`, async () => {
      for (const send of [
        () => admin("", { method: "POST", body }),
        () => admin("/validate", { method: "POST", body }),
        () => admin("/simulate", { method: "POST", body: { rule: body, days: 7 } }),
      ]) {
        const r = await send();
        expect(r.status).toBe(422);
        const out = await json<Loose>(r);
        expect(out.error).toBe("rule_refused");
        const issue = out.issues.find((i: Loose) => i.floor === floor);
        expect(issue, JSON.stringify(out.issues)).toBeTruthy();
        expect(issue.message.length).toBeGreaterThan(10);
      }
    });

  it("nothing was stored by the refused rules", async () => {
    const list = await json<Loose>(await admin(""));
    expect(list.counts.total).toBe(totalBefore);
  });
});

describe("enforcement: API, MCP, import, with the receipt naming ruleId@version", () => {
  let id = "";
  it("a block rule (draft) changes nothing until it is published", async () => {
    const created = await create(admin, rule({ name: "Pause pages in delivery" }));
    id = created.id;
    expect(created.version).toBe(0);
    expect((await proposeApi("c_delivery", "Before publish")).status).toBe(201);
  });

  it("enforced: the API path, the MCP path and import are refused with the rule and its message", async () => {
    const pub = await publish(admin, id, {});
    expect(pub).toMatchObject({ status: "published", version: 1 });
    expect(pub.rule.status).toBe("enforced");
    const before = (await queue("c_delivery")).length;

    const api = await proposeApi("c_delivery", "Blocked by api");
    expect(api.status).toBe(403);
    expect(await json<Loose>(api)).toMatchObject({
      error: "blocked_by_rule",
      rule: `${id}@1`,
      message: "Pages are paused here today.",
    });
    const viaMcp = await pushPage("c_delivery", "Blocked by mcp");
    expect(viaMcp.status).toBe(403);
    expect(await json<Loose>(viaMcp)).toMatchObject({ error: "blocked_by_rule", rule: `${id}@1` });
    expect((await queue("c_delivery")).length).toBe(before);

    // The import path is the same gate. A rule for import in c_bid, written by its own steward.
    const imp = await create(
      bid,
      rule({
        name: "No imports in bid",
        scope: { kind: "brains", ids: ["c_bid"] },
        when: [when("action", "is_any_of", "import")],
      }),
    );
    await publish(bid, imp.id, {});
    const archive = zip(
      [
        {
          path: "topic/note.md",
          content: `---\ntype: topic\ntitle: "Note"\ndescription: "d"\ntags: ["topic"]\nsources: []\ngenerated: "2026-01-01"\nverified: false\n---\n\n## Summary\n- The bid review is on Monday.\n`,
        },
      ],
      Date.now(),
    );
    const sent = await as("head_bid", "/v1/brains/c_bid/import?format=okf", {
      email: BID,
      method: "POST",
      rawBody: archive as unknown as string,
      headers: { "Content-Type": "application/zip" },
    });
    expect(sent.status).toBe(403);
    expect(await json<Loose>(sent)).toMatchObject({
      error: "blocked_by_rule",
      rule: `${imp.id}@1`,
    });
    // A dry run writes nothing and is not gated.
    const dry = await as("head_bid", "/v1/brains/c_bid/import?format=okf&dryRun=1", {
      email: BID,
      method: "POST",
      rawBody: archive as unknown as string,
      headers: { "Content-Type": "application/zip" },
    });
    expect(dry.status).toBe(200);

    // Receipts: the refusals carry the rule and replayable metadata, never content.
    const rs = await receipts();
    const blocks = rs.filter((r) => r.action === "rule.block");
    expect(blocks.map((r) => r.rule)).toEqual(expect.arrayContaining([`${id}@1`, `${imp.id}@1`]));
    const one = blocks.find((r) => r.rule === `${id}@1`);
    expect(one).toMatchObject({ decision: "deny", ruleMode: "enforced" });
    expect(one?.meta).toMatchObject({
      action: "propose_page",
      brainId: "c_delivery",
      brainType: "team",
    });
    expect(JSON.stringify(blocks)).not.toContain("Blocked by");
    expect(rs.some((r) => r.meta?.actor === "agent" && r.meta.host === "claude")).toBe(true);
    await retire(bid, imp.id, { kind: "brains", ids: ["c_bid"] });
  });

  it("monitor mode never changes the outcome: it logs a would-match", async () => {
    const v2 = await revise(admin, id, rule({ name: "Pause pages in delivery" }), "monitor");
    expect(v2.version).toBe(2);
    expect(v2.rule.status).toBe("monitor");
    expect((await proposeApi("c_delivery", "Allowed in monitor")).status).toBe(201);
    expect((await pushPage("c_delivery", "Allowed in monitor via mcp")).status).toBe(201);
    const would = (await receipts()).filter(
      (r) => r.action === "rule.would_match" && r.rule === `${id}@2`,
    );
    expect(would.length).toBeGreaterThanOrEqual(2);
    expect(would[0]).toMatchObject({ ruleMode: "monitor", decision: "allow" });
    // The accepted action's own receipt carries the metadata but no rule: monitor decided nothing.
    const own = (await receipts()).find(
      (r) => r.action === "wiki.propose" && r.meta?.brainId === "c_delivery",
    );
    expect(own?.rule ?? null).toBeNull();
    await retire(admin, id, { kind: "brains", ids: ["c_delivery"] });
    expect((await proposeApi("c_delivery", "Allowed after retire")).status).toBe(201);
  });
});

describe("approval effects stamp the proposal and the receipt", () => {
  it("two approvers on agent proposals: one approval is not enough, the second publishes", async () => {
    const r = await create(
      admin,
      rule({
        name: "Two people for agent pages",
        when: [when("actor", "is_any_of", "agent"), when("action", "is_any_of", "propose_page")],
        then: { effect: "two_approvers" },
      }),
    );
    await publish(admin, r.id, {});
    const made = await pushPage("c_delivery", "Needs two");
    expect(made.status, await made.clone().text()).toBe(201);
    const q = (
      await json<Loose[]>(await as("reviewer", "/v1/questions?brain=c_delivery", { email: REV }))
    ).find((x) => x.title.includes("Needs two")) as Loose;
    expect(q).toBeTruthy();
    expect(q.detail.required).toBe(2);
    const first = await as("reviewer", `/v1/questions/${q.id}`, {
      email: REV,
      body: { action: "approve", revisionHash: q.detail.revisionHash, seenChanges: seenOf(q) },
    });
    expect(first.status, await first.clone().text()).toBe(200);
    expect(await json<Loose>(first)).toMatchObject({
      status: "pending",
      approvals: 1,
      required: 2,
    });
    const second = await as("reviewer", `/v1/questions/${q.id}`, {
      email: REV2,
      body: { action: "approve", revisionHash: q.detail.revisionHash, seenChanges: seenOf(q) },
    });
    expect(await json<Loose>(second)).toMatchObject({ status: "approved", approvals: 2 });
    // The proposing receipt and the decisions all name the rule version.
    const rs = await receipts();
    expect(rs.find((x) => x.action === "brain.push_page" && x.rule === `${r.id}@1`)).toBeTruthy();
    expect(
      rs.filter((x) => x.action === "wiki.approve" && x.rule === `${r.id}@1`).length,
    ).toBeGreaterThanOrEqual(2);
    // A person's proposal in the same brain is not an agent write: one approver, no rule.
    await proposeApi("c_delivery", "Human page");
    const hq = (
      await json<Loose[]>(await as("reviewer", "/v1/questions?brain=c_delivery", { email: REV }))
    ).find((x) => x.title.includes("Human page")) as Loose;
    expect(hq.detail.required).toBe(1);
    await retire(admin, r.id, { kind: "brains", ids: ["c_delivery"] });
  });

  it("a named approver group limits who may approve", async () => {
    const r = await create(
      admin,
      rule({
        name: "Privacy approves delivery pages",
        when: [when("action", "is_any_of", "propose_page")],
        then: { effect: "group", approvers: ["privacy"] },
      }),
    );
    await publish(admin, r.id, {});
    await proposeApi("c_delivery", "Needs privacy");
    const q = (
      await json<Loose[]>(await as("reviewer", "/v1/questions?brain=c_delivery", { email: REV }))
    ).find((x) => x.title.includes("Needs privacy")) as Loose;
    const approve = (email: string) =>
      as("reviewer", `/v1/questions/${q.id}`, {
        email,
        body: { action: "approve", revisionHash: q.detail.revisionHash, seenChanges: seenOf(q) },
      });
    const refused = await approve(REV);
    expect(refused.status).toBe(403);
    expect(await json<Loose>(refused)).toMatchObject({
      error: "approver_group_required",
      groups: ["privacy"],
    });
    // An admin names the privacy group; a steward who is in it may approve.
    const put = await admin("/groups", {
      method: "PUT",
      body: { privacy: [await meId("reviewer", REV)] },
    });
    expect(put.status).toBe(200);
    const ok = await approve(REV);
    expect(ok.status, await ok.clone().text()).toBe(200);
    await retire(admin, r.id, { kind: "brains", ids: ["c_delivery"] });
  });

  it("review forces a candidate where a brain would publish directly", async () => {
    // The brain's own publication mode is "direct" for a human edit in a team brain only if bounds allow;
    // the rule must never make it more direct. Checked through the policy path: with a review rule the
    // proposal waits, and its decide step still needs the seen-changes rule.
    const r = await create(
      admin,
      rule({
        name: "Review all",
        when: [when("action", "is_any_of", "propose_page", "propose_change")],
        then: { effect: "review" },
      }),
    );
    await publish(admin, r.id, {});
    const res = await proposeApi("c_delivery", "Waits for review");
    expect((await json<Loose>(res)).status).toBe("candidate");
    await retire(admin, r.id, { kind: "brains", ids: ["c_delivery"] });
  });
});

describe("held actions: export and share", () => {
  it("an approval effect on export holds the call until an approver decides, once", async () => {
    const r = await create(
      admin,
      rule({
        name: "Exports need a steward",
        when: [when("action", "is_any_of", "export"), when("size_pages", "greater_than", "0")],
        then: { effect: "review" },
      }),
    );
    await publish(admin, r.id, {});
    const exportAs = (persona: string, email: string, headers: Record<string, string> = {}) =>
      as(persona, "/v1/brain/export?workspaceId=c_delivery", { email, headers, now: nextMinute() });
    const held = await exportAs("consultant", CONS);
    expect(held.status).toBe(202);
    const h = await json<Loose>(held);
    expect(h).toMatchObject({ status: "needs_approval", rule: `${r.id}@1`, required: 1 });
    // The same call again reuses the open hold.
    expect((await json<Loose>(await exportAs("consultant", CONS))).holdId).toBe(h.holdId);
    // The requester sees it, cannot decide it; a steward of the brain can; a person with no rights cannot see it.
    const mine = await json<Loose[]>(await as("consultant", "/v1/rules/holds", { email: CONS }));
    expect(mine.find((x) => x.id === h.holdId)).toMatchObject({ mine: true, canDecide: false });
    const self = await as("consultant", `/v1/rules/holds/${h.holdId}/decide`, {
      email: CONS,
      body: { decision: "approve" },
    });
    expect(self.status).toBe(403);
    expect(
      (
        await as("head_bid", `/v1/rules/holds/${h.holdId}/decide`, {
          email: BID,
          body: { decision: "approve" },
        })
      ).status,
    ).toBe(404);
    // Not yet approved: the hold id alone does not release the export.
    const early = await exportAs("consultant", CONS, { "X-Rule-Hold": h.holdId });
    expect(early.status).toBe(409);
    const theirs = await json<Loose[]>(await as("reviewer", "/v1/rules/holds", { email: REV }));
    expect(theirs.find((x) => x.id === h.holdId)).toMatchObject({ canDecide: true });
    const ok = await as("reviewer", `/v1/rules/holds/${h.holdId}/decide`, {
      email: REV,
      body: { decision: "approve" },
    });
    expect(await json<Loose>(ok)).toMatchObject({ status: "approved", approvals: 1, required: 1 });
    // Someone else cannot spend it; the requester can, once.
    expect((await exportAs("reviewer", REV2, { "X-Rule-Hold": h.holdId })).status).toBe(409);
    const done = await exportAs("consultant", CONS, { "X-Rule-Hold": h.holdId });
    expect(done.status, await done.clone().text()).toBe(200);
    expect(done.headers.get("Content-Type")).toContain("zip");
    expect((await exportAs("consultant", CONS, { "X-Rule-Hold": h.holdId })).status).toBe(409);
    const rs = await receipts();
    expect(rs.find((x) => x.action === "brain.export" && x.rule === `${r.id}@1`)).toBeTruthy();
    expect(rs.find((x) => x.action === "rule.hold" && x.rule === `${r.id}@1`)).toBeTruthy();
    // A rejection ends it.
    const again = await json<Loose>(await exportAs("consultant", CONS));
    expect(again.status).toBe("needs_approval");
    const no = await as("reviewer", `/v1/rules/holds/${again.holdId}/decide`, {
      email: REV,
      body: { decision: "reject" },
    });
    expect((await json<Loose>(no)).status).toBe("rejected");
    expect((await exportAs("consultant", CONS, { "X-Rule-Hold": again.holdId })).status).toBe(409);
    await retire(admin, r.id, { kind: "brains", ids: ["c_delivery"] });
    expect((await exportAs("consultant", CONS)).status).toBe(200);
  });
});

describe("two-person publish, rollback and incident mode", () => {
  let id = "";
  it("a tenant-wide rule needs a second admin; the same person twice is not enough", async () => {
    const r = await create(
      admin,
      rule({
        name: "Tenant exports note",
        scope: { kind: "tenant" },
        when: [when("action", "is_any_of", "export"), when("size_pages", "greater_than", "100000")],
        then: { effect: "review" },
        except: { incident: true },
      }),
    );
    id = r.id;
    const detail = await json<Loose>(await admin(`/${id}`));
    expect(detail.needsSecond).toBe(true);
    const first = await admin(`/${id}/publish`, { method: "POST", body: { status: "enforced" } });
    expect(first.status).toBe(202);
    expect(await json<Loose>(first)).toMatchObject({ status: "pending", needs: "second_person" });
    const again = await admin(`/${id}/publish`, { method: "POST", body: { status: "enforced" } });
    expect(again.status).toBe(202);
    expect((await json<Loose>(again)).sameActor).toBe(true);
    // Still not live.
    expect((await json<Loose>(await admin(`/${id}`))).version).toBe(0);
    const seen = await json<Loose>(await admin2(`/${id}`));
    expect(seen.pending).toMatchObject({ by: "other", kind: "publish", version: 1 });
    // Changing the draft starts again: the second person confirms what the first one saw.
    await admin(`/${id}`, {
      method: "PUT",
      body: rule({
        name: "Tenant exports note v2",
        scope: { kind: "tenant" },
        when: [when("action", "is_any_of", "export"), when("size_pages", "greater_than", "100000")],
        then: { effect: "review" },
        except: { incident: true },
      }),
    });
    const stale = await admin2(`/${id}/publish`, { method: "POST", body: { status: "enforced" } });
    expect(stale.status).toBe(202);
    const live = await admin(`/${id}/publish`, { method: "POST", body: { status: "enforced" } });
    expect(live.status, await live.clone().text()).toBe(200);
    expect(await json<Loose>(live)).toMatchObject({ status: "published", version: 1 });
  });

  it("a steward cannot be the second person for a tenant rule", async () => {
    const r = await create(
      admin,
      rule({
        name: "Tenant two",
        scope: { kind: "tenant" },
        when: [when("action", "is_any_of", "export"), when("size_pages", "greater_than", "100000")],
      }),
    );
    expect(
      (await admin(`/${r.id}/publish`, { method: "POST", body: { status: "monitor" } })).status,
    ).toBe(202);
    expect(
      (await bid(`/${r.id}/publish`, { method: "POST", body: { status: "monitor" } })).status,
    ).toBe(404);
    expect((await json<Loose>(await admin(`/${r.id}`))).version).toBe(0);
  });

  it("rollback is two-person and a new version, with history and diffs", async () => {
    const v2 = rule({
      name: "Tenant exports note",
      scope: { kind: "tenant" },
      when: [when("action", "is_any_of", "export"), when("size_pages", "greater_than", "100000")],
      then: { effect: "two_approvers" },
      except: { incident: true },
    });
    expect((await admin(`/${id}`, { method: "PUT", body: v2 })).status).toBe(200);
    expect(
      (await admin(`/${id}/publish`, { method: "POST", body: { status: "enforced" } })).status,
    ).toBe(202);
    expect(
      (await admin2(`/${id}/publish`, { method: "POST", body: { status: "enforced" } })).status,
    ).toBe(200);
    const d2 = await json<Loose>(await admin(`/${id}`));
    expect(d2.version).toBe(2);
    expect(d2.history[0].changes.map((c: Loose) => c.part)).toEqual(
      expect.arrayContaining(["then"]),
    );
    const asked = await admin(`/${id}/rollback`, { method: "POST", body: { toVersion: 1 } });
    expect(asked.status).toBe(202);
    expect((await json<Loose>(await admin(`/${id}`))).version).toBe(2);
    const bad = await admin2(`/${id}/rollback`, { method: "POST", body: { toVersion: 2 } });
    expect(bad.status).toBe(400);
    const done = await admin2(`/${id}/rollback`, { method: "POST", body: { toVersion: 1 } });
    expect(done.status, await done.clone().text()).toBe(200);
    const d3 = await json<Loose>(await admin(`/${id}`));
    expect(d3.version).toBe(3);
    expect(d3.history[0]).toMatchObject({ version: 3, rolledBackFrom: 1 });
    expect(d3.history).toHaveLength(3);
    expect(d3.published.then.effect).toBe("review");
  });

  it("incident mode is two-person, applies EXCEPT, and one admin can end it", async () => {
    const exportAs = (persona: string, email: string) =>
      as(persona, "/v1/brain/export?workspaceId=c_delivery", { email, now: nextMinute() });
    // A rule for the incident check: exports always need approval here, except during an incident.
    const r = await create(
      admin,
      rule({
        name: "Exports held, except in incident",
        when: [when("action", "is_any_of", "export"), when("size_pages", "greater_than", "0")],
        then: { effect: "review" },
        except: { incident: true },
      }),
    );
    await publish(admin, r.id, {});
    expect((await exportAs("consultant", CONS)).status).toBe(202);
    const on1 = await admin("/incident", { method: "PUT", body: { on: true } });
    expect(on1.status).toBe(202);
    expect((await json<Loose>(await admin("/incident"))).pending).toBe(true);
    expect((await admin("/incident", { method: "PUT", body: { on: true } })).status).toBe(202);
    expect((await exportAs("consultant", CONS)).status).toBe(202);
    const on2 = await admin2("/incident", { method: "PUT", body: { on: true } });
    expect(on2.status, await on2.clone().text()).toBe(200);
    const state = await json<Loose>(await admin("/incident"));
    expect(state).toMatchObject({ on: true, by: "other" });
    expect(new Date(state.until).getTime() - new Date(state.since).getTime()).toBe(24 * 3_600_000);
    // During the incident the same export goes through (allow and notify), and says so on the receipt.
    expect((await exportAs("consultant", CONS)).status).toBe(200);
    // Stewards cannot touch it.
    expect((await bid("/incident", { method: "PUT", body: { on: false } })).status).toBe(404);
    // One admin ends it.
    expect((await admin("/incident", { method: "PUT", body: { on: false } })).status).toBe(200);
    expect((await json<Loose>(await admin("/incident"))).on).toBe(false);
    expect((await exportAs("consultant", CONS)).status).toBe(202);
    await retire(admin, r.id, { kind: "brains", ids: ["c_delivery"] });
  });
});

describe("simulation replays audit receipts", () => {
  const DAY = 86_400_000;
  const now = Date.now();
  const synth: { at: number; meta: Loose; node: string }[] = [];
  const actions = [
    "export",
    "propose_page",
    "import",
    "propose_page",
    "export",
    "write_session_report",
  ] as const;

  beforeAll(async () => {
    // A fixture of receipts: ids and enumerated labels only. Some inside 7 days, some inside 30.
    let n = 0;
    for (const [i, action] of actions.entries())
      for (const age of [1, 3, 12, 20]) {
        const brain = i % 2 === 0 ? "c_delivery" : "c_bid";
        const agent = action === "propose_page" || action === "write_session_report";
        const meta = {
          action,
          actor: agent ? "agent" : "human",
          host: agent ? (i % 2 ? "claude" : "chatgpt") : null,
          brainId: brain,
          brainType: "team",
          flags: n % 3 === 0 ? ["personal_data"] : [],
          pages: action === "export" || action === "import" ? 20 + n * 10 : 1,
          contract: null,
          expiresAfterMin: null,
        };
        const at = now - age * DAY - n * 1000;
        n++;
        synth.push({ at, meta, node: brain });
        await appendReceipt(testEnv(), {
          receiptId: newReceiptId(),
          at: new Date(at).toISOString(),
          tenantId: ALPHA,
          principalId: "u_sim",
          action: `sim.${action}`.slice(0, 40),
          nodeId: brain,
          scopeId: brain,
          decision: "allow",
          reason: "fixture",
          revision: null,
          requestId: null,
          clientId: agent ? "claude.ai" : null,
          tool: null,
          meta: meta as never,
        });
      }
  });

  const toEvents = (list: typeof synth, days: number, only?: string): SimEvent[] =>
    list
      .filter((s) => s.at >= Date.now() - days * DAY && (!only || s.node === only))
      .map((s) => ({
        at: s.at,
        actor: { kind: s.meta.actor, host: s.meta.host, roles: [] },
        action: s.meta.action,
        brain: { id: s.meta.brainId, type: "team" as const },
        flags: s.meta.flags,
        pages: s.meta.pages,
        contract: null,
        time: { weekday: 0, hour: 0 },
      }));

  const draft: RuleDraft = {
    name: "Big exports and agent pages",
    scope: { kind: "tenant" },
    when: [
      { field: "action", op: "is_any_of", values: ["export"] },
      { field: "size_pages", op: "greater_than", values: ["40"] },
    ],
    then: { effect: "review" },
    except: { incident: false },
    status: "enforced",
  };

  it("counts equal a replay of the same receipts, for 7 and 30 days, and the split adds up", async () => {
    for (const days of [7, 30] as const) {
      const r = await admin("/simulate", { method: "POST", body: { rule: draft, days } });
      expect(r.status, await r.clone().text()).toBe(200);
      const out = await json<Loose>(r);
      // The replay of exactly the fixture rows (the earlier tests wrote receipts of their own; the
      // simulator also counts those, so compare against fixture-only through the difference).
      const expected = simulateRules(draft, toEvents(synth, days), { days });
      expect(out.matches).toBeGreaterThanOrEqual(expected.matches);
      expect(out.split.approval + out.split.blocked + out.split.allowed).toBe(out.matches);
      expect(out.estimate).toBe(true);
      expect(out.samples.length).toBeLessThanOrEqual(5);
      for (const s of out.samples) {
        expect(Object.keys(s).sort()).toEqual(["action", "actor", "at", "brain", "effect"]);
        expect(s.effect).toBe("review");
      }
      if (days === 30)
        expect(out.matches).toBeGreaterThan(
          (
            await json<Loose>(
              await admin("/simulate", { method: "POST", body: { rule: draft, days: 7 } }),
            )
          ).matches,
        );
    }
  });

  it("a window with no other receipts matches the fixture replay exactly", async () => {
    // A rule no other test traffic can match: agents on import with a page count only the fixture has.
    const exact: RuleDraft = {
      ...draft,
      name: "Imports of 20+ pages",
      when: [
        { field: "action", op: "is_any_of", values: ["import"] },
        { field: "size_pages", op: "greater_than", values: ["5"] },
      ],
    };
    const r = await json<Loose>(
      await admin("/simulate", { method: "POST", body: { rule: exact, days: 30 } }),
    );
    const expected = simulateRules(exact, toEvents(synth, 30), { days: 30 });
    expect(r.matches).toBe(expected.matches);
    expect(r.split).toEqual(expected.split);
    expect(r.addedWaitMin).toBe(expected.addedWaitMin);
    expect(r.matches).toBeGreaterThan(0);
  });

  it("a steward replays only the brains they decide in", async () => {
    const mine: RuleDraft = {
      ...draft,
      name: "Bid steward view",
      scope: { kind: "brains", ids: ["c_bid"] },
      when: [
        {
          field: "action",
          op: "is_any_of",
          values: ["propose_page", "write_session_report", "import"],
        },
      ],
    };
    const r = await json<Loose>(
      await bid("/simulate", { method: "POST", body: { rule: mine, days: 30 } }),
    );
    const expected = simulateRules(mine, toEvents(synth, 30, "c_bid"), { days: 30 });
    expect(r.total).toBeGreaterThanOrEqual(expected.total);
    expect(r.matches).toBeGreaterThanOrEqual(expected.matches);
    // Nothing from c_delivery is in a c_bid steward's replay: every sample names c_bid.
    expect(r.samples.every((s: Loose) => s.brain.id === "c_bid")).toBe(true);
    const wide: RuleDraft = { ...mine, scope: { kind: "brains", ids: ["c_delivery"] } };
    expect((await bid("/simulate", { method: "POST", body: { rule: wide, days: 7 } })).status).toBe(
      403,
    );
    const adminAll = await json<Loose>(
      await admin("/simulate", {
        method: "POST",
        body: { rule: { ...mine, scope: { kind: "tenant" } }, days: 30 },
      }),
    );
    expect(adminAll.total).toBeGreaterThan(r.total);
    expect(
      (await admin("/simulate", { method: "POST", body: { rule: draft, days: 14 } })).status,
    ).toBe(400);
  });
});

describe("the connector path", () => {
  const CKEY = "test-connector-hmac-key-0123456789abcdef";
  const fromConnector = async (body: Loose) => {
    const path = "/internal/connector/upsert";
    const raw = JSON.stringify(body);
    const headers = await signInternalRequest({
      secret: CKEY,
      method: "POST",
      url: `https://secondary.example.test${path}`,
      body: raw,
      principal: {
        v: 1,
        iss: "secondary-mcp",
        grant_id: "g_test",
        aud: "secondary-api",
        sub: "secondary-connector",
        email: "connector@service.invalid",
        client_id: "secondary-connector",
        scope: [],
        tool: "connector.sync",
      },
    });
    return call(path, { token: null, headers, rawBody: raw, method: "POST" });
  };
  const batch = (n: number) => ({
    tenantId: ALPHA,
    sourceId: "srcv7001",
    scopeId: "c_delivery",
    gateNodeId: "c_delivery",
    plane: "TEAM_RESTRICTED",
    items: [
      {
        id: `src:srcv7001:${n.toString(16).padStart(24, "0")}`,
        title: "Gate checklist",
        body: "Checklist body",
        webUrl: "https://contoso.example.invalid/doc.md",
        mime: "text/markdown",
        size: 20,
        eTag: '"e1"',
        syncedAt: 1_700_000_000_000,
      },
    ],
  });

  it("a sync is held by an enforced rule, never by a monitor one, and the receipt says which", async () => {
    const r = await create(
      admin,
      rule({
        name: "No connector imports in delivery",
        when: [when("action", "is_any_of", "import"), when("actor", "is_any_of", "connector")],
        then: { effect: "block", message: "Sync paused." },
      }),
    );
    await publish(admin, r.id, { status: "monitor" });
    const free = await fromConnector(batch(1));
    expect(await json<Loose>(free)).toMatchObject({ ok: true, changed: 1 });
    await revise(
      admin,
      r.id,
      rule({
        name: "No connector imports in delivery",
        when: [when("action", "is_any_of", "import"), when("actor", "is_any_of", "connector")],
        then: { effect: "block", message: "Sync paused." },
      }),
      "enforced",
    );
    const held = await json<Loose>(await fromConnector(batch(2)));
    expect(held).toMatchObject({ ok: true, changed: 0, held: `${r.id}@2` });
    expect(
      (await receipts()).find((x) => x.rule === `${r.id}@2` && x.meta?.actor === "connector"),
    ).toBeTruthy();
    await retire(admin, r.id, { kind: "brains", ids: ["c_delivery"] });
    expect(await json<Loose>(await fromConnector(batch(3)))).toMatchObject({ changed: 1 });
  });
});

describe("the synthetic seed", () => {
  it("seeds the design rules once, they validate, and they show with their statuses", async () => {
    expect(SEED_RULES).toHaveLength(4);
    expect(await ensureRulesSeed(testEnv({ WIKI_SEED: "on" }), ALPHA, Date.now())).toBe(4);
    expect(await ensureRulesSeed(testEnv({ WIKI_SEED: "on" }), ALPHA, Date.now())).toBe(0);
    expect(RULES_SEED_VERSION).toBe(1);
    const list = await json<Loose>(await admin(""));
    const seeded = list.rules.filter((r: Loose) => String(r.id).startsWith("r_seed_"));
    expect(seeded.map((r: Loose) => [r.id, r.status, r.version])).toEqual(
      expect.arrayContaining([
        ["r_seed_client_global", "enforced", 1],
        ["r_seed_export_50", "enforced", 1],
        ["r_seed_ai_unknown", "enforced", 1],
        ["r_seed_weekend_bid", "monitor", 1],
      ]),
    );
    expect(seeded.find((r: Loose) => r.id === "r_seed_weekend_bid").scopeLabel).toBe(
      "Bid & Pre-sales",
    );
    expect((await json<Loose>(await admin("/r_seed_weekend_bid"))).published.then.effect).toBe(
      "two_approvers",
    );
  });

  it("is off outside dev and when WIKI_SEED is off", async () => {
    expect(await ensureRulesSeed(testEnv({ WIKI_SEED: "off" }), ALPHA, Date.now())).toBe(0);
    expect(
      await ensureRulesSeed(testEnv({ ENVIRONMENT: "prod", WIKI_SEED: "on" }), ALPHA, Date.now()),
    ).toBe(0);
    void tenantDo;
  });
});
