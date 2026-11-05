// The 25 checks from prototypes/company-map/index.html (section 7), ported to the package API.
import { describe, expect, it } from "vitest";
import {
  type AdmittedView,
  GOVERNANCES,
  LENSES,
  PERSONAS,
  ROLE_ORDER,
  type RoleId,
  toMapView,
  toNodeDetail,
} from "../src/index.ts";
import { accountsOf, allMapNodes, can, ctx, mapNodes, org, view } from "./helpers.ts";

const views = Object.fromEntries(ROLE_ORDER.map((r) => [r, view(r)])) as Record<
  RoleId,
  AdmittedView
>;
const labelsOf = (v: AdmittedView, lens: (typeof LENSES)[number]) =>
  mapNodes(toMapView(v, lens)).map((n) => n.label);
const kindCount = (v: AdmittedView, kind: string) =>
  [...v.nodes.values()].filter((n) => n.kind === kind).length;

describe("prototype policy checks", () => {
  it("1. CEO gets all departments, all full", () => {
    const deps = [...views.ceo.nodes.values()].filter((n) => n.kind === "department");
    expect(deps).toHaveLength(12);
    expect(deps.every((d) => d.access === "full")).toBe(true);
  });

  it("2. CEO sees 28 countries and 433 use cases", () => {
    expect(kindCount(views.ceo, "country")).toBe(28);
    expect(kindCount(views.ceo, "usecase")).toBe(433);
    expect(GOVERNANCES.reduce((s, g) => s + g[3], 0)).toBe(433);
  });

  it("3. CEO sees no NDA account without a named grant", () => {
    expect(accountsOf(views.ceo).some((a) => a.nda)).toBe(false);
  });

  it("4. CEO sees the NDA account with a named grant", () => {
    const v = view("ceo", ctx({ ndaGrants: ["a_calypso"] }));
    expect(accountsOf(v).some((a) => a.id === "a_calypso")).toBe(true);
  });

  it("5. No role sees an NDA account without a grant", () => {
    for (const r of ROLE_ORDER) expect(accountsOf(views[r]).some((a) => a.nda)).toBe(false);
  });

  it("6. Head of Bid: no NDA account label in any lens", () => {
    for (const l of LENSES)
      expect(labelsOf(views.head_bid, l).some((x) => /Calypso/.test(x))).toBe(false);
  });

  it("7. Head of Bid: Amaris partial with only the Bid circle, others locked", () => {
    const v = views.head_bid;
    const am = v.nodes.get("d_amaris");
    expect(am?.access).toBe("partial");
    expect(am?.childIds).toEqual(["c_bid"]);
    const others = [...v.nodes.values()].filter(
      (n) => n.kind === "department" && n.id !== "d_amaris",
    );
    expect(others).toHaveLength(11);
    expect(others.every((d) => d.access === "locked" && d.childIds.length === 0)).toBe(true);
  });

  it("8. Head of Bid: only bid-linked accounts", () => {
    const accs = accountsOf(views.head_bid);
    expect(accs.length).toBeGreaterThan(0);
    expect(accs.every((a) => a.bid)).toBe(true);
  });

  it("9. Consultant: no restricted circle nodes in any lens", () => {
    const v = views.consultant;
    expect([...v.nodes.values()].some((n) => n.kind === "circle" && n.restricted)).toBe(false);
    expect(allMapNodes(v).every((n) => !v.nodes.get(n.id)?.restricted)).toBe(true);
  });

  it("10. Consultant: only own Delivery circles", () => {
    const circles = [...views.consultant.nodes.values()]
      .filter((n) => n.kind === "circle")
      .map((n) => n.id);
    expect(circles.sort()).toEqual(["c_delivery", "c_eng"]);
  });

  it("11. Account lead: one account with contacts; CEO has none", () => {
    const accs = accountsOf(views.acme_lead);
    expect(accs.map((a) => a.id)).toEqual(["a_acme"]);
    expect(views.acme_lead.nodes.has("a_acme:con")).toBe(true);
    expect(views.ceo.nodes.has("a_acme")).toBe(true);
    expect(views.ceo.nodes.has("a_acme:con")).toBe(false);
  });

  it("12. Platform admin: zero item counts and no content", () => {
    const v = views.platform_admin;
    const company = [...v.nodes.values()].filter((n) => n.plane !== "PERSONAL_HOSTED");
    expect(company.every((n) => n.leaf === null)).toBe(true);
    expect(allMapNodes(v).every((n) => n.counts === null)).toBe(true);
  });

  it("13. Platform admin: configure only, no content actions", () => {
    for (const id of ["c_bid", "d_amaris", "core"]) {
      for (const a of ["comment", "contribute", "edit", "review", "approve_release"] as const) {
        expect(can("platform_admin", id, a).allowed).toBe(false);
      }
    }
    expect(can("platform_admin", "d_amaris", "configure").allowed).toBe(true);
  });

  it("14. Auditor: counts visible, item content redacted", () => {
    const v = views.auditor;
    expect(allMapNodes(v, ["departments"]).some((n) => n.counts && n.counts.items > 0)).toBe(true);
    const leaves = [...v.nodes.values()].filter((n) => n.leaf && n.plane !== "PERSONAL_HOSTED");
    expect(leaves.length).toBeGreaterThan(0);
    expect(leaves.every((n) => n.leaf?.itemList === null && n.leaf.redacted)).toBe(true);
    expect(toNodeDetail(v, "c_bid", PERSONAS.auditor)?.items).toEqual([]);
  });

  it("15. CEO cannot edit, approve or manage members", () => {
    for (const id of ["d_amaris", "c_bid", "c_bid:response-library", "core"]) {
      for (const a of ["edit", "approve_release", "manage_members"] as const) {
        expect(can("ceo", id, a).allowed).toBe(false);
      }
    }
  });

  it("16. CEO elevated may edit but never approve", () => {
    const c = ctx({ elevatedUntil: ctx().now + 3_600_000 });
    expect(can("ceo", "c_bid", "edit", c).allowed).toBe(true);
    expect(can("ceo", "c_bid", "approve_release", c).allowed).toBe(false);
    expect(can("ceo", "c_bid", "manage_members", c).allowed).toBe(false);
  });

  it("17. Steward cannot approve their own contribution", () => {
    expect(can("head_bid", "c_bid:pricing-models", "approve_release").allowed).toBe(false);
    expect(can("head_bid", "c_bid:pricing-models", "approve_release").reason).toMatch(
      /Self-approval/,
    );
    expect(can("head_bid", "c_bid:response-library", "approve_release").allowed).toBe(true);
  });

  it("18. Reviewer may approve a steward contribution", () => {
    expect(can("reviewer", "c_bid:pricing-models", "approve_release").allowed).toBe(true);
  });

  it("18b. Reviewer holds approve_release on Company Global, never on their own items", () => {
    expect(can("reviewer", "core", "approve_release").allowed).toBe(true);
    expect(can("reviewer", "core", "review").allowed).toBe(true);
    // No other role gained a release right on global.
    for (const r of [
      "ceo",
      "head_bid",
      "acme_lead",
      "consultant",
      "platform_admin",
      "auditor",
    ] as const)
      expect(can(r, "core", "approve_release").allowed, r).toBe(false);
  });

  it("19. Contributor edits own drafts only", () => {
    expect(can("consultant", "c_delivery:quality-gates", "edit").allowed).toBe(true);
    const foreign = [...views.consultant.nodes.values()].find(
      (n) =>
        n.kind === "topic" &&
        n.leaf?.status !== "draft" &&
        n.leaf?.authorId !== PERSONAS.consultant.id,
    );
    expect(foreign).toBeDefined();
    expect(can("consultant", foreign?.id ?? "", "edit")).toEqual({
      allowed: false,
      reason: "Contributors edit their own drafts only",
    });
    // M3: someone else's draft is not theirs to edit, and an item they authored is.
    const draft = [...views.consultant.nodes.values()].find(
      (n) =>
        n.kind === "topic" &&
        n.leaf?.status === "draft" &&
        n.leaf?.authorId !== PERSONAS.consultant.id &&
        n.access === "full",
    );
    expect(draft).toBeDefined();
    expect(can("consultant", draft?.id ?? "", "edit")).toEqual({
      allowed: false,
      reason: "Contributors edit their own drafts only",
    });
    const own = [...views.consultant.nodes.values()].find(
      (n) => n.kind === "topic" && n.leaf?.authorId === PERSONAS.consultant.id,
    );
    if (own) expect(can("consultant", own.id, "edit").allowed).toBe(true);
  });

  it("20. Locked nodes: request_access allowed, other actions denied", () => {
    expect(can("head_bid", "d_it", "request_access").allowed).toBe(true);
    expect(can("head_bid", "d_it", "edit").allowed).toBe(false);
    expect(can("head_bid", "c_bid", "request_access").allowed).toBe(false);
  });

  it("21. Hidden nodes are not in canDo scope", () => {
    const d = can("consultant", "c_escal", "edit");
    expect(d).toEqual({ allowed: false, reason: "Not in your view" });
  });

  it("22. Every map node id exists in admittedView", () => {
    for (const r of ROLE_ORDER) {
      expect(allMapNodes(views[r]).every((n) => views[r].ids.has(n.id))).toBe(true);
    }
  });

  it("23. Node detail never references a node absent from admittedView", () => {
    for (const r of ROLE_ORDER) {
      const v = views[r];
      for (const id of v.ids) {
        const d = toNodeDetail(v, id, PERSONAS[r]);
        expect(d).not.toBeNull();
        if (!d) continue;
        expect(d.backlinks.every((b) => v.ids.has(b.id))).toBe(true);
        expect((d.node.children ?? []).every((c) => v.ids.has(c.id))).toBe(true);
      }
    }
  });

  it("24. Every enabled action satisfies canDo (and disabled ones do not)", () => {
    for (const r of ROLE_ORDER) {
      const v = views[r];
      [...v.ids]
        .filter((_, i) => i % 7 === 0)
        .forEach((id) => {
          const d = toNodeDetail(v, id, PERSONAS[r]);
          for (const a of d?.actions ?? []) {
            expect({ id, a: a.action, ...can(r, id, a.action) }).toEqual({
              id,
              a: a.action,
              allowed: a.allowed,
              reason: a.reason,
            });
          }
        });
    }
  });

  it("25. Replication link only between admitted countries", () => {
    const ceo = toMapView(views.ceo, "accounts").links;
    expect(ceo.some((l) => l.kind === "replication")).toBe(true);
    for (const r of ROLE_ORDER) {
      for (const l of toMapView(views[r], "accounts").links) {
        expect(views[r].ids.has(l.from) && views[r].ids.has(l.to)).toBe(true);
      }
    }
    expect(toMapView(views.head_bid, "accounts").links.some((l) => l.kind === "replication")).toBe(
      false,
    );
    expect(org.links).toHaveLength(1);
  });
});
