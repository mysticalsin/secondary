import { beforeAll, describe, expect, it } from "vitest";
import { pseudonymFor } from "../src/ops-rights.ts";
import {
  ALPHA,
  as,
  call,
  json,
  type Loose,
  rawEnv,
  seed,
  tenantDo,
  testEnv,
  wsOf,
} from "./helpers.ts";

const SUBJECT = "u_ceo";
const ADMIN_A = { email: "admin-a@example.invalid" };
const ADMIN_B = { email: "admin-b@example.invalid" };

const exportReq = (principal: string, persona = "platform_admin", who = ADMIN_A, env?: Loose) =>
  as(persona, `/v1/admin/rights/export?principal=${encodeURIComponent(principal)}`, {
    ...who,
    ...(env ? { env } : {}),
  });
/** Admin A asks, admin B confirms (H-06): returns the response B gets. */
const exportOf = async (principal: string, persona = "platform_admin") => {
  const first = await exportReq(principal, persona, ADMIN_A);
  return first.status === 202 ? exportReq(principal, persona, ADMIN_B) : first;
};
const erase = (principal: string, who = ADMIN_A, persona = "platform_admin", env?: Loose) =>
  as(persona, "/v1/admin/rights/erase", { ...who, body: { principal }, ...(env ? { env } : {}) });

const everyWorkspaceJson = async (): Promise<string> => {
  const scopes = ["global", "c_bid", "d_bid", "personal:u_ceo"];
  const parts = await Promise.all(
    scopes.map(async (s) => JSON.stringify(await wsOf(ALPHA, s).exportAll())),
  );
  return parts.join("\n");
};

let candidateId = "";
const meId = async () =>
  ((await json(await as("platform_admin", "/v1/me", ADMIN_A))) as Loose).principal.id as string;

beforeAll(async () => {
  await seed();
  // The subject has a Personal Brain note, a contributed candidate and a comment on a company item.
  const item = await json(
    await as("ceo", "/v1/personal/items", {
      body: { title: "Notes on the Acme pitch", body: "Positioning ideas, nothing sensitive." },
    }),
  );
  await as("ceo", "/v1/personal/items", { body: { title: "Second note", kind: "draft" } });
  const made = await as("ceo", `/v1/personal/items/${item.id}/contribute`, {
    body: {
      targetScopeId: "c_bid",
      user_validated: { by: SUBJECT, at: new Date().toISOString(), revision: item.revision },
    },
  });
  expect(made.status).toBe(201);
  candidateId = (await json(made)).candidateId;
  await wsOf(ALPHA, "c_bid").comment(
    candidateId,
    SUBJECT,
    "My own comment on the candidate",
    Date.now(),
  );
});

describe("rights export", () => {
  it("is for the configure role only and validates the principal", async () => {
    for (const p of ["ceo", "consultant", "auditor", "reviewer"])
      expect((await exportOf(SUBJECT, p)).status, p).toBe(403);
    expect((await call(`/v1/admin/rights/export?principal=${SUBJECT}`)).status).toBe(401);
    for (const bad of ["", "has space", "a/b", "x".repeat(300)])
      expect((await exportOf(bad)).status, bad).toBe(400);
  });

  it("H-06: one admin alone gets nothing; a second, different admin completes it; the receipt names the pseudonym", async () => {
    const pz = (await pseudonymFor(testEnv(), ALPHA, SUBJECT)) as string;
    const first = await exportReq(SUBJECT);
    expect(first.status).toBe(202);
    const pending = (await json(first)) as Loose;
    expect(pending).toMatchObject({ status: "pending", needs: "second_person", pseudonym: pz });
    expect(JSON.stringify(pending)).not.toContain("personalBrain");
    // The same admin asking again changes nothing.
    expect((await exportReq(SUBJECT)).status).toBe(202);
    const done = await exportReq(SUBJECT, "platform_admin", ADMIN_B);
    expect(done.status).toBe(200);
    expect(((await json(done)) as Loose).personalBrain).toBeTruthy();
    // The approval is consumed: the next request starts over.
    expect((await exportReq(SUBJECT, "platform_admin", ADMIN_B)).status).toBe(202);
    const audit = await json(await as("auditor", "/v1/audit/receipts?principal=" + (await meId())));
    const reasons = (audit as Loose).receipts.map((r: Loose) => `${r.action}:${r.reason}`);
    expect(reasons.some((r: string) => r.startsWith("rights_export") && r.includes(pz))).toBe(true);
  });

  it("H-06: export is refused while no pseudonym key is configured", async () => {
    const r = await exportReq(SUBJECT, "platform_admin", ADMIN_A, { PSEUDONYM_KEY: "" });
    expect(r.status).toBe(503);
  });

  it("returns the person's Personal Brain, authored company items, comments and receipt metadata", async () => {
    const res = await exportOf(SUBJECT);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    const b = (await json(res)) as Loose;
    expect(b).toMatchObject({
      format: "secondary-subject-export/1",
      tenantId: ALPHA,
      principalId: SUBJECT,
    });
    // The two notes made here, plus the persona's seeded Personal Brain items.
    expect(b.personalBrain.items.map((i: Loose) => i.label)).toEqual(
      expect.arrayContaining(["Notes on the Acme pitch", "Second note"]),
    );
    expect(b.personalBrain.items.find((i: Loose) => i.label === "Second note").kind).toBe(
      "personalitem",
    );
    expect(b.personalBrain.contributions).toHaveLength(1);
    const bid = b.authoredCompany.find((a: Loose) => a.scope === "c_bid");
    expect(bid.items.map((i: Loose) => i.id)).toContain(candidateId);
    expect(bid.comments.map((c: Loose) => c.text)).toEqual(["My own comment on the candidate"]);
    expect(b.receipts.available).toBe(true);
    expect(b.receipts.items.some((r: Loose) => r.action === "contribute")).toBe(true);
    // Only this person: nothing authored by someone else.
    for (const a of b.authoredCompany) for (const i of a.items) expect(i.authorId).toBe(SUBJECT);
  });

  it("accepts an email and resolves it to the same person", async () => {
    const byEmail = (await json(await exportOf("ceo@example.invalid"))) as Loose;
    expect(byEmail.principalId).toBe(SUBJECT);
    expect(byEmail.personalBrain.items.length).toBeGreaterThanOrEqual(2);
  });

  it("export of a stranger is empty, not an error, and never includes another person's data", async () => {
    const b = (await json(await exportOf("u_nobody"))) as Loose;
    expect(b.personalBrain.items).toEqual([]);
    expect(b.authoredCompany).toEqual([]);
  });

  it("the export itself is audited", async () => {
    const receipts = (await json(await as("auditor", "/v1/admin/audit"))) as Loose[];
    expect(receipts.some((r) => r.action === "rights_export")).toBe(true);
  });
});

describe("rights erase", () => {
  it("is for the configure role only, needs the pseudonym key, and refuses self-erasure", async () => {
    expect((await erase(SUBJECT, ADMIN_A, "ceo")).status).toBe(403);
    expect((await erase(SUBJECT, ADMIN_A, "platform_admin", { PSEUDONYM_KEY: "" })).status).toBe(
      503,
    );
    expect(
      (
        await erase(
          "u_platform_admin",
          ADMIN_A.email === "x" ? ADMIN_A : { email: "platform_admin@example.invalid" },
        )
      ).status,
    ).toBe(409);
    expect((await erase("bad principal")).status).toBe(400);
  });

  it("the pseudonym is keyed, stable and does not contain the id", async () => {
    const p1 = await pseudonymFor(testEnv(), ALPHA, SUBJECT);
    expect(p1).toMatch(/^pz_[0-9a-f]{32}$/);
    expect(p1).toBe(await pseudonymFor(testEnv(), ALPHA, SUBJECT));
    expect(p1).not.toBe(await pseudonymFor(testEnv(), "tenant_beta", SUBJECT));
    expect(p1).not.toBe(
      await pseudonymFor(
        testEnv({ PSEUDONYM_KEY: "another-pseudonym-key-0123456789abcdef" }),
        ALPHA,
        SUBJECT,
      ),
    );
    expect(await pseudonymFor(testEnv({ PSEUDONYM_KEY: "short" }), ALPHA, SUBJECT)).toBeNull();
  });

  it("one admin alone changes nothing; a second, different admin completes it", async () => {
    const first = await erase(SUBJECT, ADMIN_A);
    expect(first.status).toBe(202);
    expect(await json(first)).toMatchObject({ status: "pending", needs: "second_person" });
    expect((await erase(SUBJECT, ADMIN_A)).status).toBe(202);
    const before = (await wsOf(ALPHA, "personal:u_ceo").listByKind("personalitem", 100)).length;
    expect(before).toBeGreaterThanOrEqual(2);

    const done = await erase(SUBJECT, ADMIN_B);
    expect(done.status).toBe(200);
    const out = (await json(done)) as Loose;
    expect(out.status).toBe("erased");
    expect(out.personalItemsDeleted).toBeGreaterThanOrEqual(before);
    expect(out.authored.items).toBeGreaterThanOrEqual(1);
    expect(out.receiptsPseudonymised).toBeGreaterThanOrEqual(1);
    expect(out.pseudonym).toBe(await pseudonymFor(testEnv(), ALPHA, SUBJECT));

    // Personal Brain gone, including its search index entries.
    expect(await json(await as("ceo", "/v1/personal/items"))).toEqual([]);
    const personal = (await wsOf(ALPHA, "personal:u_ceo").exportAll()) as Loose;
    for (const rows of Object.values(personal)) expect(rows).toEqual([]);
    // The authored company item stays, under the pseudonym, and is gone from the search index.
    const bid = wsOf(ALPHA, "c_bid");
    expect((await bid.authoredBy(SUBJECT)).items).toEqual([]);
    const pz = await bid.authoredBy(out.pseudonym);
    expect(pz.items.map((i: Loose) => i.id)).toContain(candidateId);
    expect(pz.items.find((i: Loose) => i.id === candidateId)?.userValidated?.by).toBe(
      out.pseudonym,
    );
    expect(pz.comments).toHaveLength(1);
    const fts = ((await bid.exportAll()) as Loose).items_fts as Loose[];
    expect(fts.map((r) => r.id)).not.toContain(candidateId);
    // The id appears nowhere in company workspaces or in receipts.
    expect(await everyWorkspaceJson()).not.toContain(`"${SUBJECT}"`);
    expect(await everyWorkspaceJson()).not.toContain(`personal:${SUBJECT}`);
    const receipts = JSON.stringify(await json(await as("auditor", "/v1/admin/audit")));
    expect(receipts).not.toContain(SUBJECT);
    expect(receipts).toContain(out.pseudonym);
    // Directory entry is gone: the email now resolves to an anonymous id with no roles.
    const dir = (await tenantDo(ALPHA).exportAll()) as Loose;
    expect(dir.principals.map((p: Loose) => p.id)).not.toContain(SUBJECT);
    expect(dir.role_assignments.map((p: Loose) => p.principal_id)).not.toContain(SUBJECT);
    expect(JSON.stringify(dir)).not.toContain("ceo@example.invalid");
  });

  it("the erase is audited by pseudonym, and a repeat export finds nothing", async () => {
    const receipts = (await json(await as("auditor", "/v1/admin/audit"))) as Loose[];
    expect(receipts.some((r) => r.action === "rights_erase")).toBe(true);
    const b = (await json(await exportOf(SUBJECT))) as Loose;
    expect(b.personalBrain.items).toEqual([]);
    expect(b.authoredCompany).toEqual([]);
    expect(b.receipts.items).toEqual([]);
  });

  it("when the audit worker cannot rewrite receipts the erase stops before deleting the directory entry", async () => {
    const dir0 = (await tenantDo(ALPHA).exportAll()) as Loose;
    const id = dir0.principals.find((p: Loose) => p.email.startsWith("consultant@")).id;
    const failing = { fetch: async () => new Response("down", { status: 503 }) };
    const env = { AUDIT: failing };
    await erase(id, ADMIN_A, "platform_admin", env);
    const res = await erase(id, ADMIN_B, "platform_admin", env);
    expect(res.status).toBe(502);
    expect(
      ((await tenantDo(ALPHA).exportAll()) as Loose).principals.map((p: Loose) => p.id),
    ).toContain(id);
    void rawEnv;
  });
});
