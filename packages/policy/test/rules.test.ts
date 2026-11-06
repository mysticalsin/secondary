import { describe, expect, it } from "vitest";
import {
  affectsProtectedBrains,
  type Condition,
  diffRules,
  evaluateRules,
  FLOOR_IDS,
  type FloorId,
  floorMin,
  type RuleContext,
  type RuleDoc,
  type SimEvent,
  simulateRules,
  validateRule,
} from "../src/index.ts";

const rule = (over: Record<string, unknown> = {}) => ({
  name: "Test rule",
  scope: { kind: "tenant" },
  when: [{ field: "action", op: "is_any_of", values: ["export"] }],
  then: { effect: "review" },
  except: { incident: false },
  status: "enforced",
  ...over,
});
const when = (field: string, op: string, ...values: string[]) => ({ field, op, values });

const ctx = (over: Partial<RuleContext> = {}): RuleContext => ({
  base: "allow",
  action: "export",
  actor: { kind: "human", roles: ["steward"] },
  brain: { id: "c_bid", type: "team" },
  flags: [],
  pages: 10,
  contract: null,
  time: { weekday: 2, hour: 10 },
  incident: false,
  rules: [],
  ...over,
});
const doc = (id: string, version: number, over: Record<string, unknown> = {}): RuleDoc => {
  const v = validateRule(rule(over));
  if (!v.ok) throw new Error(JSON.stringify(v.issues));
  return { ...v.rule, id, version };
};

describe("hard floors: a rule may only tighten", () => {
  const refused = (r: unknown, floor: FloorId) => {
    const v = validateRule(r);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      const hit = v.issues.find((i) => i.floor === floor);
      expect(hit, JSON.stringify(v.issues)).toBeTruthy();
      expect(hit?.message.length).toBeGreaterThan(10);
    }
  };

  it("personal_privacy: a rule cannot be scoped to a Personal Brain", () => {
    refused(
      rule({ scope: { kind: "brain_types", types: ["personal", "team"] } }),
      "personal_privacy",
    );
    refused(rule({ scope: { kind: "brains", ids: ["me"] } }), "personal_privacy");
    refused(rule({ scope: { kind: "brains", ids: ["pb:u_1"] } }), "personal_privacy");
    refused(rule({ when: [when("brain_type", "is_any_of", "personal")] }), "personal_privacy");
  });

  it("nda_named_grants: a rule cannot grant access", () => {
    refused(rule({ then: { effect: "grant_access" } }), "nda_named_grants");
  });

  it("global_two_person: a release to Global cannot be lowered to review or notify", () => {
    for (const effect of ["review", "notify"])
      refused(
        rule({ when: [when("action", "is_any_of", "promote_to_global")], then: { effect } }),
        "global_two_person",
      );
    refused(
      rule({
        when: [when("action", "is_any_of", "publish"), when("brain_type", "is_any_of", "global")],
        then: { effect: "group", approvers: ["stewards"] },
      }),
      "global_two_person",
    );
    // Block and two approvers keep it.
    for (const then of [{ effect: "two_approvers" }, { effect: "block", message: "No." }])
      expect(
        validateRule(rule({ when: [when("action", "is_any_of", "promote_to_global")], then })).ok,
      ).toBe(true);
  });

  it("every_change_seen: nothing may skip or auto-approve a change, or lower publish", () => {
    refused(rule({ then: { effect: "auto_approve" } }), "every_change_seen");
    refused(rule({ then: { effect: "skip_seen" } }), "every_change_seen");
    refused(
      rule({
        when: [when("action", "is_any_of", "publish"), when("brain_type", "is_any_of", "team")],
        then: { effect: "notify" },
      }),
      "every_change_seen",
    );
  });

  it("everyone_ban: a rule cannot open an account brain to Everyone", () => {
    refused(rule({ then: { effect: "open_to_everyone" } }), "everyone_ban");
  });

  it("ai_gate: no bypass, and no allow where the contract says not allowed", () => {
    refused(rule({ then: { effect: "bypass_ai_gate" } }), "ai_gate");
    refused(
      rule({
        when: [
          when("actor", "is_any_of", "agent"),
          when("ai_contract", "is_any_of", "not_allowed"),
        ],
        then: { effect: "review" },
      }),
      "ai_gate",
    );
  });

  it("mcp_review: agent writes in a shared brain cannot be lowered", () => {
    refused(rule({ then: { effect: "bypass_review" } }), "mcp_review");
    refused(
      rule({
        when: [when("actor", "is_any_of", "claude"), when("action", "is_any_of", "propose_page")],
        then: { effect: "notify" },
      }),
      "mcp_review",
    );
    // Narrowed to a human actor the same effect is fine.
    expect(
      validateRule(
        rule({
          when: [when("actor", "is_any_of", "human"), when("action", "is_any_of", "propose_page")],
          then: { effect: "notify" },
        }),
      ).ok,
    ).toBe(true);
  });

  it("an EXCEPT that would lower a rule below a floor is refused, and fine elsewhere", () => {
    refused(
      rule({
        when: [
          when("action", "is_any_of", "promote_to_global"),
          when("content_flag", "is_any_of", "client_name"),
        ],
        then: { effect: "block", message: "Client names stay out of Global." },
        except: { incident: true },
      }),
      "global_two_person",
    );
    expect(validateRule(rule({ except: { incident: true } })).ok).toBe(true);
  });

  it("a plain allow is refused with the tighten-only reason", () => {
    const v = validateRule(rule({ then: { effect: "allow" } }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.issues[0]?.code).toBe("loosens_policy");
  });

  it("expire is a time limit, not a decision: allowed on agent writes", () => {
    expect(
      validateRule(
        rule({
          when: [when("actor", "is_any_of", "agent"), when("action", "is_any_of", "propose_page")],
          then: { effect: "expire", expiresAfterMin: 15 },
        }),
      ).ok,
    ).toBe(true);
  });

  it("every floor id has a situation that triggers it", () => {
    const seen = new Set<FloorId>();
    const sits = [
      { action: "promote_to_global", actor: "human", brainType: "account", contract: null },
      { action: "publish", actor: "human", brainType: "team", contract: null },
      { action: "export", actor: "claude", brainType: "account", contract: "not_allowed" },
      { action: "propose_page", actor: "claude", brainType: "team", contract: null },
    ] as const;
    for (const s of sits) {
      const f = floorMin({ ...s }).floor;
      if (f) seen.add(f);
    }
    // The first four are strength floors; the others are structural (refused above).
    expect([...seen].sort()).toEqual(
      ["ai_gate", "every_change_seen", "global_two_person", "mcp_review"].sort(),
    );
    expect(FLOOR_IDS).toHaveLength(7);
  });
});

describe("validation", () => {
  it("cleans a good rule", () => {
    const v = validateRule(
      rule({ name: "  Big   exports ", when: [when("size_pages", "greater_than", "50")] }),
    );
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.rule.name).toBe("Big exports");
  });

  it("rejects bad input with a path each", () => {
    const v = validateRule({
      name: "x",
      scope: { kind: "nope" },
      when: [],
      then: { effect: "block" },
    });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      const paths = v.issues.map((i) => i.path);
      expect(paths).toContain("name");
      expect(paths).toContain("scope");
      expect(paths).toContain("when");
      expect(paths).toContain("then.message");
    }
    for (const bad of [
      rule({ when: [when("action", "is_any_of", "teleport")] }),
      rule({ when: [when("size_pages", "is_any_of", "5")] }),
      rule({ when: [when("size_pages", "greater_than", "-3")] }),
      rule({ then: { effect: "expire" } }),
      rule({ then: { effect: "group", approvers: ["everyone"] } }),
      rule({ status: "live" }),
      "text",
    ])
      expect(validateRule(bad).ok).toBe(false);
  });

  it("protected brains: tenant and type scopes always, named brains by lookup", () => {
    const protectedIds = new Set(["a_acme"]);
    const p = (id: string) => protectedIds.has(id);
    expect(affectsProtectedBrains({ kind: "tenant" }, p)).toBe(true);
    expect(affectsProtectedBrains({ kind: "brain_types", types: ["team"] }, p)).toBe(false);
    expect(affectsProtectedBrains({ kind: "brain_types", types: ["global"] }, p)).toBe(true);
    expect(affectsProtectedBrains({ kind: "brains", ids: ["c_bid"] }, p)).toBe(false);
    expect(affectsProtectedBrains({ kind: "brains", ids: ["c_bid", "a_acme"] }, p)).toBe(true);
  });
});

describe("evaluateRules composes after the base policy", () => {
  it("a base deny always wins and nothing is evaluated", () => {
    const r = evaluateRules(ctx({ base: "deny", rules: [doc("r1", 1)] }));
    expect(r.effect).toBe("none");
    expect(r.baseDenied).toBe(true);
    expect(r.tag).toBeNull();
    expect(r.would).toEqual([]);
  });

  it("an enforced match returns the effect and ruleId@version", () => {
    const r = evaluateRules(ctx({ rules: [doc("r1", 3)] }));
    expect(r).toMatchObject({
      effect: "review",
      ruleId: "r1",
      version: 3,
      tag: "r1@3",
      requiredApprovals: 1,
    });
  });

  it("the tightest effect wins, ties go to the lower id", () => {
    const rules = [
      doc("b", 1, { then: { effect: "review" } }),
      doc("a", 1, { then: { effect: "review" } }),
      doc("c", 2, { then: { effect: "two_approvers" } }),
    ];
    expect(evaluateRules(ctx({ rules })).tag).toBe("c@2");
    expect(evaluateRules(ctx({ rules: rules.slice(0, 2) })).tag).toBe("a@1");
    const blocked = evaluateRules(
      ctx({ rules: [...rules, doc("z", 1, { then: { effect: "block", message: "Stop" } })] }),
    );
    expect(blocked).toMatchObject({ effect: "block", message: "Stop", requiredApprovals: 0 });
  });

  it("monitor logs a would-match and never changes the outcome", () => {
    const monitor = doc("m", 1, { status: "monitor", then: { effect: "block", message: "No" } });
    const r = evaluateRules(ctx({ rules: [monitor] }));
    expect(r.effect).toBe("none");
    expect(r.tag).toBeNull();
    expect(r.would).toEqual([{ ruleId: "m", version: 1, effect: "block", mode: "monitor" }]);
    // Together with an enforced rule the enforced one decides.
    const both = evaluateRules(ctx({ rules: [monitor, doc("e", 2)] }));
    expect(both.tag).toBe("e@2");
    expect(both.would).toHaveLength(1);
  });

  it("a draft never matches", () => {
    const d = { ...doc("d", 1), status: "draft" as const };
    expect(evaluateRules(ctx({ rules: [d] })).effect).toBe("none");
  });

  it("scope: a rule never reaches a Personal Brain, even if stored with a tenant scope", () => {
    const r = evaluateRules(ctx({ brain: { id: "me", type: "personal" }, rules: [doc("r1", 1)] }));
    expect(r.effect).toBe("none");
    const typed = doc("t", 1, { scope: { kind: "brain_types", types: ["account"] } });
    expect(evaluateRules(ctx({ rules: [typed] })).effect).toBe("none");
    expect(
      evaluateRules(ctx({ brain: { id: "a_x", type: "account" }, rules: [typed] })).effect,
    ).toBe("review");
    const named = doc("n", 1, { scope: { kind: "brains", ids: ["c_sales"] } });
    expect(evaluateRules(ctx({ rules: [named] })).effect).toBe("none");
  });

  it("conditions: AND, is none of, size, time, actor host", () => {
    const rules = [
      doc("r", 1, {
        when: [
          when("action", "is_any_of", "propose_page"),
          when("actor", "is_any_of", "claude"),
          when("time", "is_any_of", "weekend"),
          when("content_flag", "is_none_of", "client_name"),
        ],
        then: { effect: "two_approvers" },
      }),
    ];
    const base = ctx({
      action: "propose_page",
      actor: { kind: "agent", host: "claude", roles: [] },
      time: { weekday: 6, hour: 11 },
      rules,
    });
    expect(evaluateRules(base).requiredApprovals).toBe(2);
    expect(evaluateRules({ ...base, time: { weekday: 3, hour: 11 } }).effect).toBe("none");
    expect(
      evaluateRules({ ...base, actor: { kind: "agent", host: "dust", roles: [] } }).effect,
    ).toBe("none");
    expect(evaluateRules({ ...base, flags: ["client_name"] }).effect).toBe("none");
    const big = doc("p", 1, { when: [when("size_pages", "greater_than", "50")] });
    expect(evaluateRules(ctx({ pages: 51, rules: [big] })).effect).toBe("review");
    expect(evaluateRules(ctx({ pages: 50, rules: [big] })).effect).toBe("none");
    expect(evaluateRules(ctx({ pages: null, rules: [big] })).effect).toBe("none");
    const off = doc("o", 1, { when: [when("time", "is_any_of", "outside_business_hours")] });
    expect(evaluateRules(ctx({ time: { weekday: 2, hour: 20 }, rules: [off] })).effect).toBe(
      "review",
    );
    expect(evaluateRules(ctx({ time: { weekday: 2, hour: 9 }, rules: [off] })).effect).toBe("none");
  });

  it("incident mode: EXCEPT downgrades to allow and notify, but never below a floor", () => {
    const exp = doc("e", 1, { except: { incident: true } });
    expect(evaluateRules(ctx({ incident: false, rules: [exp] })).effect).toBe("review");
    expect(evaluateRules(ctx({ incident: true, rules: [exp] })).effect).toBe("notify");
    // A stored rule that slipped past validation: the floor holds at run time.
    const sneaky: RuleDoc = {
      id: "s",
      version: 1,
      name: "Sneaky",
      scope: { kind: "tenant" },
      when: [{ field: "action", op: "is_any_of", values: ["promote_to_global"] }],
      then: { effect: "block", message: "No" },
      except: { incident: true },
      status: "enforced",
    };
    const r = evaluateRules(
      ctx({
        action: "promote_to_global",
        brain: { id: "a_x", type: "account" },
        incident: true,
        rules: [sneaky],
      }),
    );
    expect(r.effect).toBe("block");
    expect(r.floor).toBe("global_two_person");
  });

  it("expire adds a limit alongside another effect", () => {
    const rules = [
      doc("x", 1, { then: { effect: "expire", expiresAfterMin: 30 } }),
      doc("y", 1, { then: { effect: "expire", expiresAfterMin: 15 } }),
      doc("z", 1, { then: { effect: "review" } }),
    ];
    const r = evaluateRules(ctx({ rules }));
    expect(r.effect).toBe("review");
    expect(r.expiresAfterMin).toBe(15);
  });

  it("group effect carries its approver groups", () => {
    const r = evaluateRules(
      ctx({ rules: [doc("g", 1, { then: { effect: "group", approvers: ["privacy"] } })] }),
    );
    expect(r).toMatchObject({ effect: "group", approvers: ["privacy"], requiredApprovals: 1 });
  });
});

describe("simulation replays events against a draft", () => {
  const ev = (at: number, over: Partial<SimEvent> = {}): SimEvent => ({
    at,
    actor: { kind: "human", roles: [] },
    action: "export",
    brain: { id: "c_bid", type: "team" },
    flags: [],
    pages: 80,
    contract: null,
    time: { weekday: 2, hour: 10 },
    ...over,
  });

  it("counts, splits, samples newest first and estimates the wait", () => {
    const v = validateRule(rule({ when: [when("size_pages", "greater_than", "50")] }));
    if (!v.ok) throw new Error("bad");
    const events = [
      ev(1, { pages: 80 }),
      ev(2, { pages: 20 }),
      ev(3, { pages: 99 }),
      ev(4, { pages: 100, baseDenied: true }),
    ];
    const r = simulateRules(v.rule, events, { days: 7 });
    expect(r.total).toBe(4);
    expect(r.matches).toBe(2);
    expect(r.split).toEqual({ approval: 2, blocked: 0, allowed: 0 });
    expect(r.samples.map((s) => s.at)).toEqual([3, 1]);
    expect(r.addedWaitMin).toBeGreaterThan(0);
    expect(r.approvalsPerDay).toBeCloseTo(0.3, 1);
  });

  it("blocked and notified land in their own parts of the split", () => {
    const b = validateRule(rule({ then: { effect: "block", message: "No" } }));
    const n = validateRule(rule({ then: { effect: "notify" } }));
    if (!b.ok || !n.ok) throw new Error("bad");
    const events = [ev(1), ev(2)];
    expect(simulateRules(b.rule, events).split).toEqual({ approval: 0, blocked: 2, allowed: 0 });
    expect(simulateRules(n.rule, events).split).toEqual({ approval: 0, blocked: 0, allowed: 2 });
    expect(simulateRules(n.rule, events).addedWaitMin).toBe(0);
  });
});

describe("diffRules", () => {
  it("lists only the parts that changed", () => {
    const a = validateRule(rule());
    const b = validateRule(rule({ then: { effect: "two_approvers" }, name: "Renamed rule" }));
    if (!a.ok || !b.ok) throw new Error("bad");
    expect(
      diffRules(a.rule, b.rule)
        .map((c) => c.part)
        .sort(),
    ).toEqual(["name", "then"]);
    expect(diffRules(null, a.rule).length).toBeGreaterThan(3);
    expect(diffRules(a.rule, a.rule)).toEqual([]);
  });

  it("conditions render as text", () => {
    const c: Condition = { field: "action", op: "is_any_of", values: ["export"] };
    const a = validateRule(rule({ when: [c] }));
    if (!a.ok) throw new Error("bad");
    expect(diffRules(null, a.rule).find((d) => d.part === "when")?.to).toBe(
      "action is any of export",
    );
  });
});
