import { describe, expect, it } from "vitest";
import {
  ACTIONS,
  admittedView,
  buildOrg,
  canDo,
  describe as describeRole,
  governanceStages,
  LENSES,
  PERSONAS,
  type Principal,
  ROLE_ORDER,
  ROLES,
  type Role,
  type RoleId,
  STAGES,
  TENANT_ID,
  toMapView,
  toNodeDetail,
} from "../src/index.ts";
import { accountsOf, allMapNodes, can, ctx, HOUR, mapNodes, NOW, org, view } from "./helpers.ts";

const otherPersonalIds = (r: RoleId) =>
  [...org.nodes.values()]
    .filter((n) => n.ownerId !== undefined && n.ownerId !== PERSONAS[r].id)
    .map((n) => n.id);

describe("personal scope", () => {
  it("every role, including CEO, admin and auditor, is denied every action on every other Personal Brain node", () => {
    const variants = [ctx(), ctx({ ndaGrants: ["a_calypso"], elevatedUntil: NOW + HOUR })];
    for (const r of ROLE_ORDER) {
      for (const id of otherPersonalIds(r)) {
        for (const c of variants) {
          for (const a of ACTIONS)
            expect(can(r, id, a, c)).toEqual({ allowed: false, reason: "Not in your view" });
        }
      }
      const v = view(r);
      expect(
        [...v.ids].filter((id) => id.startsWith("pb:") && !id.startsWith(`pb:${PERSONAS[r].id}`)),
      ).toEqual([]);
    }
  });

  it("a role that grants every action on scope_type personal still admits nothing", () => {
    const root: Role = {
      id: "root",
      label: "Root",
      summary: "test",
      grants: [
        { scope_type: "personal", scope_id: "*", actions: [...ACTIONS], conditions: {} },
        { scope_type: "global", scope_id: "*", actions: [...ACTIONS], conditions: {} },
        { scope_type: "department", scope_id: "*", actions: [...ACTIONS], conditions: {} },
      ],
      exclusions: [],
      never: [],
      elevation: { actions: [...ACTIONS], hours: 24 },
    };
    const o = buildOrg({ roles: { ...ROLES, root } });
    const p: Principal = {
      id: "u_root",
      email: "root@example.invalid",
      tenantId: TENANT_ID,
      roleIds: ["root"],
      memberships: [],
    };
    const c = ctx({ elevatedUntil: NOW + HOUR, ndaGrants: ["a_calypso"] });
    expect(admittedView(p, o, c).ids.has("core")).toBe(true);
    for (const id of o.nodes.keys()) {
      if (!id.startsWith("pb:")) continue;
      for (const a of ACTIONS) expect(canDo(p, o, id, a, c).allowed).toBe(false);
      expect(admittedView(p, o, c).ids.has(id)).toBe(false);
    }
  });

  it("the owner is admitted to their own Personal Brain and nothing else leaks in", () => {
    for (const r of ROLE_ORDER) {
      const own = `pb:${PERSONAS[r].id}`;
      const v = view(r);
      expect(v.ids.has(own)).toBe(true);
      expect(v.nodes.get(own)?.childIds).toHaveLength(3);
      for (const a of [
        "view_structure",
        "view_content",
        "comment",
        "edit",
        "contribute",
      ] as const) {
        expect(can(r, `${own}:1`, a).allowed).toBe(true);
      }
      for (const a of [
        "review",
        "approve_release",
        "manage_members",
        "configure",
        "request_access",
      ] as const) {
        expect(can(r, `${own}:1`, a).allowed).toBe(false);
      }
    }
  });

  it("a user with a Personal Brain and no roles sees only that brain", () => {
    const o = buildOrg({ personalOwners: ["u_solo"] });
    const p: Principal = {
      id: "u_solo",
      email: "solo@example.invalid",
      tenantId: TENANT_ID,
      roleIds: [],
      memberships: [],
    };
    expect([...admittedView(p, o, ctx()).ids].sort()).toEqual([
      "pb:u_solo",
      "pb:u_solo:1",
      "pb:u_solo:2",
      "pb:u_solo:3",
    ]);
  });

  it("the Personal Brain never appears on the Company Map", () => {
    for (const r of ROLE_ORDER) {
      expect(allMapNodes(view(r)).some((n) => n.id.startsWith("pb:"))).toBe(false);
      expect(
        allMapNodes(view(r)).every((n) => !("plane" in n) || n.plane !== "PERSONAL_HOSTED"),
      ).toBe(true);
    }
  });

  it("same user id in another tenant is denied", () => {
    const p = { ...PERSONAS.ceo, tenantId: "tenant_other" };
    expect(admittedView(p, org, ctx()).ids.size).toBe(0);
    expect(canDo(p, org, `pb:${p.id}`, "view_content", ctx()).allowed).toBe(false);
  });
});

describe("views never leak", () => {
  it("MapView and NodeDetail never contain an id absent from admittedView (all ctx variants)", () => {
    const variants = [
      ctx(),
      ctx({ ndaGrants: ["a_calypso"] }),
      ctx({ ndaGrants: ["a_calypso"], elevatedUntil: NOW + HOUR }),
    ];
    for (const r of ROLE_ORDER) {
      for (const c of variants) {
        const v = view(r, c);
        for (const l of LENSES) {
          const mv = toMapView(v, l);
          for (const n of mapNodes(mv)) expect(v.ids.has(n.id)).toBe(true);
          for (const k of mv.links) expect(v.ids.has(k.from) && v.ids.has(k.to)).toBe(true);
        }
        for (const id of v.ids) {
          const d = toNodeDetail(v, id, PERSONAS[r]);
          expect(d?.node.id).toBe(id);
          expect((d?.backlinks ?? []).every((b) => v.ids.has(b.id))).toBe(true);
        }
      }
    }
  });

  it("toNodeDetail returns null for an absent node and for a different principal", () => {
    expect(toNodeDetail(view("consultant"), "c_escal", PERSONAS.consultant)).toBeNull();
    expect(toNodeDetail(view("consultant"), "d_amaris", PERSONAS.ceo)).toBeNull();
  });

  it("locked nodes have counts null and no children; hidden nodes are absent", () => {
    for (const r of ROLE_ORDER) {
      const v = view(r);
      for (const n of allMapNodes(v)) {
        if (n.access !== "locked") continue;
        expect(n.counts).toBeNull();
        expect(n.children ?? []).toEqual([]);
      }
    }
    const locked = allMapNodes(view("consultant"), ["departments"]).filter(
      (n) => n.access === "locked",
    );
    expect(locked.length).toBeGreaterThan(0);
    expect(locked.every((n) => !("children" in n) || (n.children ?? []).length === 0)).toBe(true);
    expect(view("consultant").ids.has("c_escal")).toBe(false);
    const detail = toNodeDetail(view("consultant"), "d_it", PERSONAS.consultant);
    expect(detail?.node.counts).toBeNull();
    expect(detail?.items).toEqual([]);
    expect(detail?.node.facts).toEqual({});
    expect(detail?.actions[0]?.action).toBe("request_access");
  });

  it("facts do not reveal hidden siblings (no child counts)", () => {
    const d = toNodeDetail(view("consultant"), "d_amaris", PERSONAS.consultant);
    expect(Object.keys(d?.node.facts ?? {})).toEqual(["Group"]);
  });

  it("NDA account appears only with a named grant, and platform admin sees it at structure level", () => {
    expect(view("platform_admin").ids.has("a_calypso")).toBe(false);
    const v = view("platform_admin", ctx({ ndaGrants: ["a_calypso"] }));
    expect(v.nodes.get("a_calypso")?.level).toBe("structure");
    expect(v.ids.has("a_calypso:eng")).toBe(false);
    const wrong = view("ceo", ctx({ ndaGrants: ["a_acme"] }));
    expect(wrong.ids.has("a_calypso")).toBe(false);
    expect(view("ceo", ctx({ ndaGrants: ["a_calypso"] })).ids.has("a_calypso:eng:0")).toBe(true);
    expect(can("ceo", "a_calypso", "comment").allowed).toBe(false);
    expect(can("ceo", "a_calypso", "comment", ctx({ ndaGrants: ["a_calypso"] })).allowed).toBe(
      true,
    );
  });

  it("contacts need membership of the account, not only the role", () => {
    const stranger: Principal = { ...PERSONAS.acme_lead, id: "u_other", memberships: [] };
    expect(admittedView(stranger, org, ctx()).ids.has("a_acme:con")).toBe(false);
    expect(admittedView(PERSONAS.acme_lead, org, ctx()).ids.has("a_acme:con:0")).toBe(true);
  });

  it("unknown roles and empty principals get an empty view", () => {
    const ghost: Principal = {
      id: "u_ghost",
      email: "g@example.invalid",
      tenantId: TENANT_ID,
      roleIds: ["nope"],
      memberships: [],
    };
    expect(admittedView(ghost, org, ctx()).ids.size).toBe(0);
    expect(toMapView(admittedView(ghost, org, ctx()), "departments").hubs).toEqual([]);
    expect(canDo(ghost, org, "core", "view_structure", ctx()).allowed).toBe(false);
  });
});

describe("elevation", () => {
  const ceoEdit = (c: ReturnType<typeof ctx>) => can("ceo", "c_bid", "edit", c);

  it("is time-boxed by ctx.now and elevatedUntil", () => {
    expect(ceoEdit(ctx()).allowed).toBe(false);
    expect(ceoEdit(ctx({ elevatedUntil: NOW + HOUR })).allowed).toBe(true);
    expect(ceoEdit(ctx({ elevatedUntil: NOW + HOUR })).reason).toMatch(/elevation/);
    expect(ceoEdit({ now: NOW + HOUR - 1, elevatedUntil: NOW + HOUR }).allowed).toBe(true);
    expect(ceoEdit({ now: NOW + HOUR, elevatedUntil: NOW + HOUR }).allowed).toBe(false);
    expect(ceoEdit({ now: NOW + 2 * HOUR, elevatedUntil: NOW + HOUR }).allowed).toBe(false);
  });

  it("cannot exceed the role's hours", () => {
    expect(ceoEdit(ctx({ elevatedUntil: NOW + 4 * HOUR })).allowed).toBe(true);
    expect(ceoEdit(ctx({ elevatedUntil: NOW + 4 * HOUR + 1 })).allowed).toBe(false);
  });

  it("applies to department scopes only and only for the role's elevation actions", () => {
    const c = ctx({ elevatedUntil: NOW + HOUR });
    expect(can("ceo", "core", "edit", c).allowed).toBe(false);
    expect(can("ceo", "a_acme", "edit", c).allowed).toBe(false);
    expect(can("ceo", "c_bid", "review", c).allowed).toBe(true);
    expect(can("ceo", "c_bid", "configure", c).allowed).toBe(false);
    expect(can("head_bid", "c_sales", "edit", c).allowed).toBe(false);
  });
});

describe("viewerScopeHash", () => {
  it("differs per role, is stable per view and shared across lenses", () => {
    const hashes = ROLE_ORDER.map((r) => toMapView(view(r), "departments").viewerScopeHash);
    expect(new Set(hashes).size).toBe(ROLE_ORDER.length);
    expect(hashes.every((h) => /^[0-9a-f]{16}$/.test(h))).toBe(true);
    for (const r of ROLE_ORDER) {
      const hs = LENSES.map((l) => toMapView(view(r), l).viewerScopeHash);
      expect(new Set(hs).size).toBe(1);
      expect(hs[0]).toBe(toMapView(view(r, ctx({ now: NOW + 1 })), "topics").viewerScopeHash);
    }
  });

  it("changes when an NDA grant changes what is visible", () => {
    const a = view("ceo").scopeHash;
    expect(view("ceo", ctx({ ndaGrants: ["a_calypso"] })).scopeHash).not.toBe(a);
  });
});

describe("property: canDo allowed implies the node is in the view", () => {
  it("holds for every role, node id, action and context variant", () => {
    const variants = [ctx(), ctx({ ndaGrants: ["a_calypso"], elevatedUntil: NOW + HOUR })];
    const ids = [...org.nodes.keys(), "missing", "", "core/../x"];
    let allowed = 0;
    for (const r of ROLE_ORDER) {
      for (const c of variants) {
        const v = view(r, c);
        for (const id of ids) {
          for (const a of ACTIONS) {
            const d = can(r, id, a, c);
            if (d.allowed) {
              allowed++;
              expect(v.ids.has(id)).toBe(true);
              if (a !== "request_access") expect(v.nodes.get(id)?.access).not.toBe("locked");
            } else {
              expect(d.reason.length).toBeGreaterThan(0);
            }
          }
        }
      }
    }
    expect(allowed).toBeGreaterThan(1000);
  });

  it("no role can approve its own contribution on any node", () => {
    for (const r of ROLE_ORDER) {
      for (const n of view(r).nodes.values()) {
        if (n.leaf?.authorId === PERSONAS[r].id && n.kind !== "personalitem") {
          expect(can(r, n.id, "approve_release").allowed).toBe(false);
          expect(can(r, n.id, "review").allowed).toBe(false);
        }
      }
    }
  });
});

describe("synthetic organisation", () => {
  it("has the real Mantu structure", () => {
    const nodes = [...org.nodes.values()];
    const of = (k: string) => nodes.filter((n) => n.kind === k);
    expect(of("department").filter((d) => d.group === "bl")).toHaveLength(5);
    expect(of("department").filter((d) => d.group === "cf")).toHaveLength(7);
    expect(of("governance")).toHaveLength(12);
    expect(of("usecase")).toHaveLength(433);
    expect(of("region")).toHaveLength(4);
    expect(of("country")).toHaveLength(28);
    expect(of("account")).toHaveLength(21);
    expect(
      of("account")
        .filter((a) => a.nda)
        .map((a) => a.id),
    ).toEqual(["a_calypso"]);
    expect(of("personal")).toHaveLength(ROLE_ORDER.length);
    expect(nodes.every((n) => /^[a-z0-9][a-z0-9_.:-]*$/.test(n.id))).toBe(true);
  });

  it("is deterministic for a seed and varies with it", () => {
    const sig = (o: typeof org) =>
      JSON.stringify([...o.nodes.values()].map((n) => [n.id, n.leaf?.items, n.leaf?.days]));
    expect(sig(buildOrg())).toBe(sig(buildOrg()));
    expect(sig(buildOrg({ seed: 1 }))).not.toBe(sig(buildOrg()));
  });

  it("uses synthetic data only", () => {
    const text = JSON.stringify([...org.nodes.values()]);
    expect((text.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? []).length).toBe(0);
    expect(Object.values(PERSONAS).every((p) => p.email.endsWith("@example.invalid"))).toBe(true);
  });

  it("governances: 433 use cases across five maturity stages for the CEO, none for the admin", () => {
    const g = governanceStages(view("ceo"));
    expect(g).toHaveLength(12);
    expect(g.reduce((s, x) => s + x.total, 0)).toBe(433);
    expect(g.every((x) => x.stages.map((s) => s.stage).join() === STAGES.join())).toBe(true);
    expect(g.find((x) => x.id === "g_lbc")?.total).toBe(92);
    expect(governanceStages(view("platform_admin")).reduce((s, x) => s + x.total, 0)).toBe(0);
  });

  it("MapView has the contract shape per lens", () => {
    const v = view("ceo");
    const kinds = {
      departments: "department",
      accounts: "region",
      topics: "theme",
      governances: "governance",
    } as const;
    for (const l of LENSES) {
      const mv = toMapView(v, l);
      expect(mv.lens).toBe(l);
      expect(mv.core).toEqual({ id: "core", label: "Company Global", topicCount: 14 });
      expect(mv.hubs.length).toBeGreaterThan(0);
      expect(mv.hubs.every((h) => h.kind === kinds[l])).toBe(true);
    }
    const dep = toMapView(v, "departments").hubs.find((h) => h.id === "d_amaris");
    expect(dep?.group).toBe("Business lines");
    expect(dep?.counts?.items).toBeGreaterThan(0);
    expect(accountsOf(v).length).toBe(20);
  });
});

describe("describe", () => {
  it("lists what each role sees, does and never does", () => {
    for (const r of ROLE_ORDER) {
      const d = describeRole(PERSONAS[r], org);
      expect(d.see.length).toBeGreaterThan(0);
      expect(d.do.length).toBeGreaterThan(0);
      expect(d.never).toContain("Other people's Personal Brains");
      expect(d.see).toContain("Your own Personal Brain: only you");
    }
    expect(
      describeRole(PERSONAS.platform_admin, org).do.every((x) => x.startsWith("configure in")),
    ).toBe(true);
    expect(describeRole(PERSONAS.head_bid, org).see).toContain("Full: Bid & Pre-sales (circle)");
    expect(describeRole(PERSONAS.auditor, org).see).toContain("Metadata only: all departments");
  });
});
