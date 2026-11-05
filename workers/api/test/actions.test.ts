import { beforeAll, describe, expect, it } from "vitest";
import { ALPHA, as, json, seed, tenantDo } from "./helpers.ts";

beforeAll(async () => {
  await seed();
});

const act = (persona: string, body: unknown, now?: number) =>
  as(persona, "/v1/actions", { body, ...(now === undefined ? {} : { now }) });

async function revisionOf(persona: string, nodeId: string): Promise<number> {
  const d = await json(await as(persona, `/v1/nodes/${nodeId}`));
  return d.record.revision as number;
}

const validated = (by: string, revision = 1, at = new Date().toISOString()) => ({
  by,
  at,
  revision,
});

describe("approval rules", () => {
  const NODE = "c_bid:pricing-models"; // contributed by head_bid, waiting for release

  it("self-approval is refused (403) and leaves the item pending", async () => {
    const revision = await revisionOf("head_bid", NODE);
    const res = await act("head_bid", { nodeId: NODE, action: "approve_release", revision });
    expect(res.status).toBe(403);
    expect((await json(res)).reason).toMatch(/self-approval/i);
    expect((await json(await as("head_bid", `/v1/nodes/${NODE}`))).record.status).toBe("candidate");
  });

  it("a role without the grant cannot approve at all", async () => {
    const revision = await revisionOf("head_bid", NODE);
    for (const p of ["ceo", "consultant", "acme_lead", "auditor", "platform_admin"]) {
      expect((await act(p, { nodeId: NODE, action: "approve_release", revision })).status, p).toBe(
        403,
      );
    }
  });

  it("approval needs the exact revision: a stale one is 409 with the current revision", async () => {
    const revision = await revisionOf("reviewer", NODE);
    const stale = await act("reviewer", {
      nodeId: NODE,
      action: "approve_release",
      revision: revision + 1,
    });
    expect(stale.status).toBe(409);
    const body = await json(stale);
    expect(body.error).toBe("revision_conflict");
    expect(body.currentRevision).toBe(revision);
    expect((await act("reviewer", { nodeId: NODE, action: "approve_release" })).status).toBe(400);
  });

  it("a reviewer who is not the contributor releases it, once", async () => {
    const revision = await revisionOf("reviewer", NODE);
    const ok = await act("reviewer", { nodeId: NODE, action: "approve_release", revision });
    expect(ok.status).toBe(200);
    const body = await json(ok);
    expect(body).toMatchObject({ ok: true, released: true, approvals: 1, required: 1 });
    expect(body.receiptId).toMatch(/^rcpt_/);
    expect((await json(await as("reviewer", `/v1/nodes/${NODE}`))).record.status).toBe("approved");
    // Releasing again is refused.
    expect(
      (await act("reviewer", { nodeId: NODE, action: "approve_release", revision })).status,
    ).toBe(409);
  });

  it("two-person release to Company Global: two distinct approvers, never the contributor", async () => {
    const created = await act("head_bid", {
      nodeId: "c_bid",
      action: "contribute",
      payload: {
        title: "Pricing guardrails v2",
        body: "How we price fixed-fee work",
        releaseTarget: "global",
        user_validated: validated("u_head_bid"),
      },
    });
    expect(created.status).toBe(201);
    const { candidateId } = await json(created);
    expect(candidateId).toMatch(/^cand:c_bid:[0-9a-f]{8}$/);

    // Waiting in the review queue of the people who may act on it, not of the contributor.
    const queue = (p: string) =>
      as(p, "/v1/review")
        .then(json)
        .then((r) => r as { id: string; twoPerson: { needed: number; approvals: number } }[]);
    expect((await queue("reviewer")).find((i) => i.id === candidateId)).toMatchObject({
      twoPerson: { needed: 2, approvals: 0 },
    });
    expect((await queue("head_bid")).find((i) => i.id === candidateId)).toBeUndefined();
    expect((await queue("consultant")).find((i) => i.id === candidateId)).toBeUndefined();

    // The contributor is refused even though the role is a steward of the circle.
    const self = await act("head_bid", {
      nodeId: candidateId,
      action: "approve_release",
      revision: 1,
    });
    expect(self.status).toBe(403);
    expect((await json(self)).reason).toMatch(/self-approval/i);

    // First distinct approver: not released yet.
    const first = await json(
      await act("reviewer", { nodeId: candidateId, action: "approve_release", revision: 1 }),
    );
    expect(first).toMatchObject({ released: false, approvals: 1, required: 2 });
    // The same person cannot count twice.
    const again = await act("reviewer", {
      nodeId: candidateId,
      action: "approve_release",
      revision: 1,
    });
    expect(again.status).toBe(409);
    expect((await json(again)).error).toBe("already_done");
    expect((await queue("reviewer")).find((i) => i.id === candidateId)).toMatchObject({
      twoPerson: { approvals: 1 },
    });
  });

  it("a second distinct approver completes a two-person release", async () => {
    // Contributor is the CEO (steward grants do not matter: the CEO has no approve right anywhere).
    const created = await act("ceo", {
      nodeId: "c_bid",
      action: "contribute",
      payload: {
        title: "Bid pricing playbook",
        releaseTarget: "global",
        user_validated: validated("u_ceo"),
      },
    });
    const { candidateId } = await json(created);
    const a = await json(
      await act("reviewer", { nodeId: candidateId, action: "approve_release", revision: 1 }),
    );
    expect(a).toMatchObject({ released: false, approvals: 1, required: 2 });
    const b = await json(
      await act("head_bid", { nodeId: candidateId, action: "approve_release", revision: 1 }),
    );
    expect(b).toMatchObject({ released: true, approvals: 2, required: 2 });
    // No more approvals once released.
    expect(
      (await act("reviewer", { nodeId: candidateId, action: "approve_release", revision: 1 }))
        .status,
    ).toBe(409);
  });

  it("review is also separate from the author", async () => {
    const revision = await revisionOf("reviewer", "c_delivery:quality-gates");
    expect(
      (await act("consultant", { nodeId: "c_delivery:quality-gates", action: "review", revision }))
        .status,
    ).toBe(403);
    const ok = await act("reviewer", {
      nodeId: "c_delivery:quality-gates",
      action: "review",
      revision,
      payload: { verdict: "accept" },
    });
    expect(ok.status).toBe(200);
    expect(
      (
        await act("reviewer", {
          nodeId: "c_delivery:quality-gates",
          action: "review",
          revision,
          payload: { verdict: "maybe" },
        })
      ).status,
    ).toBe(400);
  });
});

describe("H1: edit-then-approve bypass", () => {
  it("a steward cannot edit a colleague's candidate, and then cannot approve it by other means", async () => {
    const created = await act("ceo", {
      nodeId: "c_bid",
      action: "contribute",
      payload: { title: "Colleague's playbook", user_validated: validated("u_ceo") },
    });
    const { candidateId } = await json(created);
    // head_bid is a steward of c_bid with edit and approve_release, yet may not rewrite it.
    const edit = await act("head_bid", {
      nodeId: candidateId,
      action: "edit",
      revision: 1,
      payload: { body: "my own text" },
    });
    expect(edit.status).toBe(403);
    expect((await json(edit)).reason).toMatch(/only the contributor/i);
    // Stewards may still request changes.
    expect(
      (
        await act("head_bid", {
          nodeId: candidateId,
          action: "review",
          revision: 1,
          payload: { verdict: "changes_requested" },
        })
      ).status,
    ).toBe(200);
  });

  it("whoever edits an item counts as an author: edit then approve is denied, a second person works", async () => {
    // head_bid is a steward of c_bid: edit is allowed on a seeded item, approval by the editor is not.
    const map = (await json(await as("head_bid", "/v1/map?lens=departments"))) as {
      hubs: { children: { id: string; children?: { id: string }[] }[] }[];
    };
    const ids = map.hubs
      .flatMap((h) => h.children)
      .flatMap((c) => (c.id === "c_bid" ? (c.children ?? []) : []))
      .map((c) => c.id);
    let target: string | null = null;
    for (const id of ids) {
      const d = await json(await as("head_bid", `/v1/nodes/${id}`));
      const edit = d.actions?.find((a: { action: string }) => a.action === "edit");
      if (d.record && !d.record.mine && edit?.allowed) {
        target = id;
        break;
      }
    }
    expect(target, "a c_bid topic head_bid may edit").not.toBeNull();
    const id = target as string;
    const rev = await revisionOf("head_bid", id);
    const edited = await act("head_bid", {
      nodeId: id,
      action: "edit",
      revision: rev,
      payload: { title: "Edited by the steward" },
    });
    expect(edited.status).toBe(200);
    const approve = await act("head_bid", { nodeId: id, action: "approve_release", revision: rev + 1 });
    expect(approve.status).toBe(403);
    expect((await json(approve)).reason).toMatch(/wrote or edited/i);
    const review = await act("head_bid", { nodeId: id, action: "review", revision: rev + 1 });
    expect(review.status).toBe(403);
    const second = await act("reviewer", { nodeId: id, action: "approve_release", revision: rev + 1 });
    expect(second.status).toBe(200);
  });
});

describe("edit, comment and revisions", () => {
  const NODE = "c_sales:account-planning";

  it("edit uses the expected previous revision; a stale writer gets 409", async () => {
    const r0 = await revisionOf("acme_lead", NODE);
    const first = await act("acme_lead", {
      nodeId: NODE,
      action: "edit",
      revision: r0,
      payload: { title: "Account planning (2026)" },
    });
    expect(first.status).toBe(200);
    expect((await json(first)).revision).toBe(r0 + 1);
    const stale = await act("acme_lead", {
      nodeId: NODE,
      action: "edit",
      revision: r0,
      payload: { title: "Lost update" },
    });
    expect(stale.status).toBe(409);
    expect((await json(stale)).currentRevision).toBe(r0 + 1);
    const detail = await json(await as("acme_lead", `/v1/nodes/${NODE}`));
    expect(detail.record.revision).toBe(r0 + 1);
    expect(detail.node.facts.Revision).toBe(String(r0 + 1));
    // The renamed node is searchable under its new title, still inside the caller's view.
    const s = await json(await as("acme_lead", "/v1/search?q=2026"));
    expect(s.results.map((x: { id: string }) => x.id)).toContain(NODE);
  });

  it("editing needs a grant: view-only roles get 403, empty edits get 400", async () => {
    const r = await revisionOf("acme_lead", NODE);
    expect(
      (await act("ceo", { nodeId: NODE, action: "edit", revision: r, payload: { title: "x" } }))
        .status,
    ).toBe(403);
    expect(
      (await act("auditor", { nodeId: NODE, action: "edit", revision: r, payload: { title: "x" } }))
        .status,
    ).toBe(403);
    expect(
      (await act("acme_lead", { nodeId: NODE, action: "edit", revision: r, payload: {} })).status,
    ).toBe(400);
    expect(
      (
        await act("acme_lead", {
          nodeId: "c_sales",
          action: "edit",
          revision: 1,
          payload: { title: "x" },
        })
      ).status,
    ).toBe(400);
  });

  it("comment shows on the node for people who can see content", async () => {
    const res = await act("ceo", {
      nodeId: NODE,
      action: "comment",
      payload: { text: "Please add the renewal date" },
    });
    expect(res.status).toBe(200);
    const detail = await json(await as("ceo", `/v1/nodes/${NODE}`));
    expect(detail.comments.map((c: { text: string }) => c.text)).toContain(
      "Please add the renewal date",
    );
    expect(
      (await act("platform_admin", { nodeId: NODE, action: "comment", payload: { text: "x" } }))
        .status,
    ).toBe(403);
    expect(
      (await act("ceo", { nodeId: NODE, action: "comment", payload: { text: "x".repeat(2_001) } }))
        .status,
    ).toBe(400);
  });

  it("elevation is time-boxed: the CEO can edit inside the window and not after it", async () => {
    const node = "c_eng:test-strategy";
    const r = await revisionOf("ceo", node);
    expect(
      (
        await act("ceo", {
          nodeId: node,
          action: "edit",
          revision: r,
          payload: { title: "Test strategy" },
        })
      ).status,
    ).toBe(403);
    const t0 = Date.now();
    const before = await tenantDo(ALPHA).epoch();
    await tenantDo(ALPHA).elevate("u_ceo", 2, "Incident review", t0);
    expect(await tenantDo(ALPHA).epoch()).toBe(before + 1);
    const inside = await act(
      "ceo",
      { nodeId: node, action: "edit", revision: r, payload: { title: "Test strategy" } },
      t0 + 60_000,
    );
    expect(inside.status).toBe(200);
    const after = await act(
      "ceo",
      { nodeId: node, action: "edit", revision: r + 1, payload: { title: "Again" } },
      t0 + 3 * 3_600_000,
    );
    expect(after.status).toBe(403);
    expect((await json(after)).reason).toMatch(/elevation/);
  });
});

describe("request validation", () => {
  it("rejects malformed input before doing anything", async () => {
    expect((await act("ceo", { nodeId: "core", action: "fly" })).status).toBe(400);
    expect((await act("ceo", { nodeId: "Bad Id", action: "comment" })).status).toBe(400);
    expect((await act("ceo", { nodeId: "core", action: "view_content" })).status).toBe(400);
    expect((await as("ceo", "/v1/actions", { rawBody: "{nope" })).status).toBe(400);
    expect((await as("ceo", "/v1/actions", { rawBody: "[]" })).status).toBe(400);
  });

  it("manage_members and configure are authorised by policy but not built in B1", async () => {
    expect((await act("head_bid", { nodeId: "c_bid", action: "manage_members" })).status).toBe(501);
    expect((await act("platform_admin", { nodeId: "core", action: "configure" })).status).toBe(501);
    expect((await act("consultant", { nodeId: "c_bid", action: "manage_members" })).status).toBe(
      403,
    );
  });

  it("request_access is allowed on locked nodes only", async () => {
    const map = await json(await as("acme_lead", "/v1/map?lens=departments"));
    const locked = map.hubs.find((h: { access: string }) => h.access === "locked");
    expect(locked).toBeTruthy();
    const res = await act("acme_lead", { nodeId: locked.id, action: "request_access" });
    expect(res.status).toBe(200);
    expect((await act("acme_lead", { nodeId: "core", action: "request_access" })).status).toBe(403);
  });
});

describe("Personal Brain contribute", () => {
  async function newItem(persona: string, title: string, body: string) {
    const r = await as(persona, "/v1/personal/items", { body: { title, body } });
    expect(r.status).toBe(201);
    return (await json(r)) as {
      id: string;
      revision: number;
      sensitivity_flags: { id: string; type: string }[];
    };
  }
  const contribute = (persona: string, itemId: string, body: unknown) =>
    as(persona, `/v1/personal/items/${itemId}/contribute`, { body });

  it("flags sensitive text, blocks until each flag is acknowledged, keeps the original private", async () => {
    const item = await newItem(
      "ceo",
      "Notes after the offsite",
      "Call Jo on +33 6 12 34 56 78 or jo.doe@example.invalid. Salary talk is for HR.",
    );
    const types = item.sensitivity_flags.map((f) => f.type);
    expect(types).toEqual(expect.arrayContaining(["email", "phone", "hr"]));

    // 1. No validation: refused, flags returned for the pre-share sheet.
    const noVal = await contribute("ceo", item.id, { targetScopeId: "c_bid" });
    expect(noVal.status).toBe(422);
    const noValBody = await json(noVal);
    expect(noValBody.error).toBe("user_validation_required");
    expect(noValBody.sensitivity_flags.length).toBe(item.sensitivity_flags.length);
    // 2. Validated but flags pending: blocked (R-110/R-111).
    const v = validated("u_ceo", item.revision);
    const blocked = await contribute("ceo", item.id, { targetScopeId: "c_bid", user_validated: v });
    expect(blocked.status).toBe(422);
    const blockedBody = await json(blocked);
    expect(blockedBody.error).toBe("sensitivity_flags_pending");
    expect(blockedBody.pending.length).toBe(item.sensitivity_flags.length);
    // Acknowledging only some is still blocked.
    const partial = await contribute("ceo", item.id, {
      targetScopeId: "c_bid",
      user_validated: v,
      acknowledged_flags: [blockedBody.pending[0]],
    });
    expect(partial.status).toBe(422);
    // 3. All acknowledged: a candidate is created.
    const ok = await contribute("ceo", item.id, {
      targetScopeId: "c_bid",
      user_validated: v,
      acknowledged_flags: blockedBody.pending,
    });
    expect(ok.status).toBe(201);
    const made = await json(ok);
    expect(made.candidateId).toMatch(/^cand:c_bid:/);
    expect(made.sensitivity_flags.length).toBe(item.sensitivity_flags.length);
    // The personal original is still there and still private.
    const mine = await json(await as("ceo", "/v1/personal/items"));
    expect(mine.map((i: { id: string }) => i.id)).toContain(item.id);
    for (const p of ["head_bid", "reviewer", "auditor", "platform_admin"]) {
      expect(JSON.stringify(await json(await as(p, "/v1/personal/items"))), p).not.toContain(
        "jo.doe@example.invalid",
      );
    }
    // Reviewers of the target scope see the candidate; the consultant (no review grant on c_bid) does not.
    const queue = (p: string) =>
      as(p, "/v1/review")
        .then(json)
        .then((r) => r as { id: string }[]);
    expect((await queue("reviewer")).map((i) => i.id)).toContain(made.candidateId);
    expect((await queue("consultant")).map((i) => i.id)).not.toContain(made.candidateId);
  });

  it("checks who validated, when, and which revision", async () => {
    const item = await newItem("acme_lead", "Renewal prep", "No personal data in here");
    expect(item.sensitivity_flags).toEqual([]);
    const target = { targetScopeId: "c_sales" };
    const bad = [
      validated("u_someone_else", item.revision),
      validated("u_acme_lead", item.revision + 1),
      validated("u_acme_lead", item.revision, new Date(Date.now() - 3 * 86_400_000).toISOString()),
      validated("u_acme_lead", item.revision, new Date(Date.now() + 3_600_000).toISOString()),
      validated("u_acme_lead", item.revision, "not a date"),
    ];
    for (const v of bad)
      expect(
        (await contribute("acme_lead", item.id, { ...target, user_validated: v })).status,
      ).toBe(422);
    expect(
      (
        await contribute("acme_lead", item.id, {
          ...target,
          user_validated: validated("u_acme_lead", item.revision),
        })
      ).status,
    ).toBe(201);
  });

  it("the target must be one the contributor may contribute to", async () => {
    const item = await newItem("consultant", "Delivery tip", "Short and clean");
    const v = validated("u_consultant", item.revision);
    expect(
      (await contribute("consultant", item.id, { targetScopeId: "c_bid", user_validated: v }))
        .status,
    ).toBe(403);
    expect(
      (await contribute("consultant", item.id, { targetScopeId: "a_acme", user_validated: v }))
        .status,
    ).toBe(403);
    expect(
      (
        await contribute("consultant", item.id, {
          targetScopeId: "pb:u_consultant",
          user_validated: v,
        })
      ).status,
    ).toBe(403);
    expect(
      (await contribute("consultant", item.id, { targetScopeId: "c_delivery", user_validated: v }))
        .status,
    ).toBe(201);
  });
});

describe("audit receipts", () => {
  it("every decision leaves a receipt without content; only the auditor reads them", async () => {
    const created = await act("head_bid", {
      nodeId: "c_bid",
      action: "contribute",
      payload: {
        title: "SECRET-TITLE-4471",
        body: "SECRET-BODY-4471",
        user_validated: validated("u_head_bid"),
      },
    });
    expect(created.status).toBe(201);
    await act("consultant", {
      nodeId: "c_bid",
      action: "comment",
      payload: { text: "SECRET-COMMENT-4471" },
    });

    const mine = await json(await as("auditor", "/v1/audit/receipts?principal=u_head_bid"));
    const contribute = mine.receipts.find((r: { action: string }) => r.action === "contribute");
    expect(contribute).toMatchObject({
      decision: "allow",
      nodeId: "c_bid",
      scopeId: "c_bid",
      tenantId: ALPHA,
      principalId: "u_head_bid",
    });
    const denied = await json(await as("auditor", "/v1/audit/receipts?principal=u_consultant"));
    expect(denied.receipts.find((r: { action: string }) => r.action === "comment")).toMatchObject({
      decision: "deny",
    });
    expect(JSON.stringify([mine, denied])).not.toContain("SECRET");

    for (const p of ["ceo", "head_bid", "platform_admin", "reviewer"])
      expect((await as(p, "/v1/audit/receipts?principal=u_head_bid")).status, p).toBe(403);
    expect((await as("auditor", "/v1/audit/receipts")).status).toBe(400);
  });

  it("a mutation fails closed when the audit log is unavailable", async () => {
    const broken = { AUDIT: { fetch: async () => new Response("down", { status: 500 }) } };
    const res = await as("head_bid", "/v1/actions", {
      env: broken,
      body: {
        nodeId: "c_bid",
        action: "contribute",
        payload: { title: "Should not be stored", user_validated: validated("u_head_bid") },
      },
    });
    expect(res.status).toBe(503);
    expect((await json(res)).error).toBe("audit_unavailable");
  });
});
