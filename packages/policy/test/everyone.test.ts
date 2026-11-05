import { describe, expect, it } from "vitest";
import { admittedView, canDoInView, type OrgNode, PERSONAS } from "../src/index.ts";
import { ctx, org } from "./helpers.ts";

const nodes = [...org.nodes.values()];
const find = (f: (n: OrgNode) => boolean) => {
  const n = nodes.find(f);
  if (!n) throw new Error("fixture node missing");
  return n;
};

const consultant = PERSONAS.consultant;
const open = (ids: string[]) => ctx({ openBrains: ids });
const levelOf = (id: string, c = ctx()) => admittedView(consultant, org, c).nodes.get(id)?.level;

// A team brain the consultant cannot read today (not a member, no grant).
const closedCircle = find(
  (n) => n.kind === "circle" && !n.restricted && levelOf(n.id) !== "content",
);

describe("Everyone at Mantu widens reading in the policy engine", () => {
  it("lifts a team brain to content and allows view_content", () => {
    expect(levelOf(closedCircle.id)).not.toBe("content");
    const c = open([closedCircle.id]);
    expect(levelOf(closedCircle.id, c)).toBe("content");
    const v = admittedView(consultant, org, c);
    expect(canDoInView(v, consultant, closedCircle.id, "view_content").allowed).toBe(true);
    expect(canDoInView(v, consultant, closedCircle.id, "view_structure").allowed).toBe(true);
  });

  it("never goes beyond view_content", () => {
    const c = open([closedCircle.id]);
    const v = admittedView(consultant, org, c);
    for (const a of [
      "comment",
      "contribute",
      "edit",
      "review",
      "approve_release",
      "manage_members",
      "configure",
    ] as const)
      expect(canDoInView(v, consultant, closedCircle.id, a).allowed, a).toBe(false);
  });

  it("changes nothing for a node not listed", () => {
    const c = open([closedCircle.id]);
    const other = find(
      (n) =>
        n.kind === "circle" &&
        !n.restricted &&
        n.id !== closedCircle.id &&
        levelOf(n.id) !== "content",
    );
    expect(levelOf(other.id, c)).not.toBe("content");
    expect(
      canDoInView(admittedView(consultant, org, c), consultant, other.id, "view_content").allowed,
    ).toBe(false);
  });

  it("does not widen a restricted circle, an account, an NDA account or a contacts subspace", () => {
    const restricted = find((n) => n.kind === "circle" && !!n.restricted);
    const account = find((n) => n.kind === "account" && !n.nda && levelOf(n.id) !== "content");
    const ndaAccount = find((n) => n.kind === "account" && !!n.nda);
    const contacts = nodes.find((n) => !!n.contacts);
    const ids = [restricted.id, account.id, ndaAccount.id, ...(contacts ? [contacts.id] : [])];
    const before = admittedView(consultant, org, ctx());
    const after = admittedView(consultant, org, open(ids));
    for (const id of ids) {
      expect(after.nodes.get(id)?.level, id).toBe(before.nodes.get(id)?.level);
      expect(canDoInView(after, consultant, id, "view_content").allowed, id).toBe(
        canDoInView(before, consultant, id, "view_content").allowed,
      );
    }
  });

  it("does not open another person's Personal Brain", () => {
    const pb = find((n) => n.kind === "personal" && n.ownerId !== consultant.id);
    const c = open([pb.id]);
    const v = admittedView(consultant, org, c);
    expect(v.nodes.has(pb.id)).toBe(false);
    expect(canDoInView(v, consultant, pb.id, "view_content").allowed).toBe(false);
  });

  it("needs a recognised role: no role, no view", () => {
    const nobody = { ...consultant, roleIds: [] as string[] };
    const v = admittedView(nobody, org, open([closedCircle.id]));
    expect(v.nodes.get(closedCircle.id)).toBeUndefined();
    expect(v.nodes.size).toBe(admittedView(nobody, org, ctx()).nodes.size);
    expect(canDoInView(v, nobody, closedCircle.id, "view_content").allowed).toBe(false);
  });

  it("keeps the other tenant out", () => {
    const stranger = { ...consultant, tenantId: "t_other" };
    expect(admittedView(stranger, org, open([closedCircle.id])).nodes.size).toBe(0);
  });

  it("a team node under a restricted ancestor is not lifted (M-8)", () => {
    const parent = org.nodes.get(closedCircle.parentId as string) as OrgNode;
    const nodes = new Map(org.nodes);
    nodes.set(parent.id, { ...parent, restricted: true });
    const tight = { ...org, nodes };
    const v = admittedView(consultant, tight, open([closedCircle.id]));
    expect(v.nodes.get(closedCircle.id)?.level).not.toBe("content");
    expect(v.lifted.has(closedCircle.id)).toBe(false);
    expect(canDoInView(v, consultant, closedCircle.id, "view_content").allowed).toBe(false);
    // The same node with an unrestricted parent is lifted.
    expect(admittedView(consultant, org, open([closedCircle.id])).lifted.has(closedCircle.id)).toBe(
      true,
    );
  });

  it("a cached view is keyed by the opened ids", () => {
    const a = admittedView(consultant, org, ctx());
    const b = admittedView(consultant, org, open([closedCircle.id]));
    expect(a.nodes.get(closedCircle.id)?.level).not.toBe("content");
    expect(b.nodes.get(closedCircle.id)?.level).toBe("content");
    expect(admittedView(consultant, org, ctx()).nodes.get(closedCircle.id)?.level).not.toBe(
      "content",
    );
  });
});
