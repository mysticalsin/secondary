// v8 Review desk and Knowledge gaps: the pure rules, pinned.

import { describe, expect, it } from "vitest";
import { closureRate, daysOf, keepable, normalise, scoreOf, titleOf } from "../src/gaps/model.ts";
import {
  addedStatements,
  ageOf,
  businessDaysBetween,
  DAY,
  effortMinutes,
  kpisOf,
  median,
  mentionsIn,
  priorityOf,
  riskFlags,
  riskOf,
  sectionOf,
  sensitivityOf,
  stripOf,
  summaryOf,
  whatOf,
} from "../src/review/model.ts";

// 2026-11-06 is a Friday.
const FRI = Date.parse("2026-11-06T12:00:00Z");

describe("business days and SLA", () => {
  it("weekends do not count", () => {
    // Friday noon to Monday noon is one business day (Friday afternoon plus Monday morning).
    expect(businessDaysBetween(FRI, FRI + 3 * DAY)).toBeCloseTo(1, 5);
    expect(businessDaysBetween(FRI + DAY, FRI + 2 * DAY)).toBe(0);
    expect(businessDaysBetween(FRI, FRI - 1)).toBe(0);
  });

  it("age is ok, near (75 percent of the SLA) and overdue (the whole SLA)", () => {
    const monday = Date.parse("2026-11-09T09:00:00Z");
    expect(ageOf(monday, monday + DAY * 1, 2).state).toBe("ok");
    expect(ageOf(monday, monday + DAY * 1.6, 2).state).toBe("near");
    expect(ageOf(monday, monday + DAY * 2, 2).state).toBe("overdue");
    // A tighter SLA turns the same age overdue.
    expect(ageOf(monday, monday + DAY * 1, 1).state).toBe("overdue");
  });
});

describe("priority", () => {
  const base = {
    what: "change" as const,
    approvals: 0,
    required: 1,
    age: { businessDays: 0.5, slaDays: 2, state: "ok" as const },
    sensitivity: "low" as const,
    risk: [] as string[],
  };
  it("blocking, age, brain sensitivity and risk each raise it, and it is capped at 100", () => {
    const quiet = priorityOf(base).priority;
    expect(priorityOf({ ...base, what: "contradiction" }).priority).toBeGreaterThan(quiet);
    expect(
      priorityOf({ ...base, age: { businessDays: 3, slaDays: 2, state: "overdue" } }).priority,
    ).toBeGreaterThan(quiet);
    expect(priorityOf({ ...base, sensitivity: "high" }).priority).toBeGreaterThan(quiet);
    expect(priorityOf({ ...base, risk: ["personal"] }).priority).toBeGreaterThan(quiet);
    const all = priorityOf({
      what: "release",
      approvals: 1,
      required: 2,
      age: { businessDays: 99, slaDays: 2, state: "overdue" },
      sensitivity: "high",
      risk: ["a", "b", "c", "d"],
    });
    expect(all.priority).toBe(100);
    expect(all.reasons).toEqual(
      expect.arrayContaining(["blocking", "overdue", "sensitive_brain", "risk"]),
    );
  });

  it("an item that needs only one more approval outranks one that needs two", () => {
    const one = priorityOf({ ...base, what: "release", approvals: 1, required: 2 });
    const two = priorityOf({ ...base, what: "release", approvals: 0, required: 2 });
    expect(one.priority).toBeGreaterThan(two.priority);
  });

  it("accounts, Global and restricted brains are high, a team brain medium, personal low", () => {
    expect(sensitivityOf({ type: "account" })).toBe("high");
    expect(sensitivityOf({ type: "global" })).toBe("high");
    expect(sensitivityOf({ type: "team", nda: true })).toBe("high");
    expect(sensitivityOf({ type: "team" })).toBe("medium");
    expect(sensitivityOf({ type: "personal" })).toBe("low");
  });
});

describe("effort, summary, kind", () => {
  it("effort is at least one minute and grows with size", () => {
    expect(effortMinutes({ addedWords: 5, removedWords: 0, changes: 1 })).toBe(1);
    expect(effortMinutes({ addedWords: 800, removedWords: 200, changes: 6 })).toBeGreaterThan(4);
    expect(effortMinutes({ addedWords: 90_000, removedWords: 0, changes: 0 })).toBe(30);
  });

  it("the summary is one deterministic sentence per kind", () => {
    expect(
      summaryOf({ what: "change", pageTitles: ["Bid playbook"], added: 3, removed: 1, changes: 2 }),
    ).toBe('Adds 3 lines and removes 1 line in "Bid playbook" (2 changes).');
    expect(
      summaryOf({ what: "new_page", pageTitles: ["A", "B"], added: 5, removed: 0, changes: 1 }),
    ).toBe('Adds the page "A" and 1 more with 5 lines.');
    expect(
      summaryOf({
        what: "contradiction",
        pageTitles: [],
        added: 0,
        removed: 0,
        changes: 0,
        subject: "Acme renewal",
      }),
    ).toContain("Acme renewal");
  });

  it("names what the item is", () => {
    const b = { title: "t", pageTypes: [], pageIds: [], rationale: "", allAdds: false };
    expect(whatOf({ ...b, kind: "contradiction" })).toBe("contradiction");
    expect(whatOf({ ...b, kind: "review", pageIds: ["session-report-ada-2026"] })).toBe(
      "session_report",
    );
    expect(whatOf({ ...b, kind: "review", pageIds: ["p"], rationale: "Imported from zip" })).toBe(
      "import",
    );
    expect(whatOf({ ...b, kind: "review", pageIds: ["p"], allAdds: true })).toBe("new_page");
    expect(whatOf({ ...b, kind: "review", pageIds: ["p"] })).toBe("change");
    expect(whatOf({ ...b, kind: "release" })).toBe("release");
  });
});

describe("risk panel", () => {
  it("finds client names, personal data, confidential fields, a rule and unsupported lines", () => {
    const lines = addedStatements([
      { type: "add", text: "# Heading" },
      { type: "add", text: "- Acme pays on net 60. {src:s1}" },
      { type: "add", text: "- Contact jane@example.invalid or +1 514 555 0199" },
      { type: "add", text: "- Budget: 40k" },
      { type: "same", text: "- unchanged" },
    ]);
    expect(lines).toHaveLength(3);
    const r = riskOf({
      addedText: lines,
      clientNames: ["Acme", "Globex"],
      fieldLabels: ["Budget", "Margin"],
      rule: "R-12@3",
    });
    expect(r.clients).toEqual(["Acme"]);
    expect(r.personalData.kinds).toEqual(expect.arrayContaining(["email", "phone"]));
    expect(r.confidential).toEqual(["Budget"]);
    expect(r.rule).toBe("R-12@3");
    expect(r.unsupported).toBe(2);
    expect(riskFlags(r)).toEqual(["client", "personal", "confidential", "rule", "unsupported"]);
    expect(
      riskOf({ addedText: [], clientNames: [], fieldLabels: [], rule: "not a rule" }).rule,
    ).toBeNull();
  });
});

describe("sections, mentions, strip and KPIs", () => {
  const now = FRI;
  const st = { snoozedUntil: null, waitingOnAuthor: false, mentioned: false };
  it("snoozed and waiting win over mentions, which win over contradictions", () => {
    expect(sectionOf({ what: "change", state: st, nowMs: now })).toBe("decision");
    expect(sectionOf({ what: "contradiction", state: st, nowMs: now })).toBe("contradictions");
    expect(
      sectionOf({ what: "contradiction", state: { ...st, mentioned: true }, nowMs: now }),
    ).toBe("mentions");
    expect(
      sectionOf({ what: "change", state: { ...st, snoozedUntil: now + DAY }, nowMs: now }),
    ).toBe("snoozed");
    expect(sectionOf({ what: "change", state: { ...st, snoozedUntil: now - 1 }, nowMs: now })).toBe(
      "decision",
    );
    expect(sectionOf({ what: "change", state: { ...st, waitingOnAuthor: true }, nowMs: now })).toBe(
      "snoozed",
    );
  });

  it("mentions are the local part after @, once each", () => {
    expect(mentionsIn("Please look, @Ada.Lovelace and @bob. Mail a@b.co @ada.lovelace")).toEqual([
      "ada.lovelace",
      "bob",
    ]);
  });

  it("the strip has 14 days, newest last, and colours by state", () => {
    const s = stripOf(
      [
        { id: "a", status: "candidate", createdAt: now },
        { id: "b", status: "approved", createdAt: now },
        { id: "c", status: "rejected", createdAt: now - 3 * DAY },
        { id: "old", status: "approved", createdAt: now - 20 * DAY },
      ],
      now,
    );
    expect(s.days).toHaveLength(14);
    expect(s.days[13]).toBe("2026-11-06");
    expect(s.dots.map((d) => [d.id, d.state, d.slot])).toEqual([
      ["c", "rejected", 0],
      ["a", "waiting", 0],
      ["b", "approved", 1],
    ]);
  });

  it("KPIs: median time to decision, overdue and cleared this week", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    const k = kpisOf({
      waiting: 4,
      overdue: 1,
      nowMs: now,
      decided: [
        { createdAt: now - 3 * DAY, decidedAt: now - 2 * DAY },
        { createdAt: now - 10 * DAY, decidedAt: now - 8 * DAY },
        { createdAt: now - 40 * DAY, decidedAt: now - 39 * DAY },
      ],
    });
    expect(k).toEqual({ waiting: 4, medianHoursToDecision: 36, overdue: 1, clearedThisWeek: 1 });
  });
});

describe("gaps: normalise, keep, rank", () => {
  it("near-duplicates share a key", () => {
    expect(normalise("What is our pricing method?")).toBe(normalise("pricing method"));
    expect(normalise("Quelle est notre méthode de pricing ?")).toBe(normalise("methode pricing"));
    expect(normalise("the of and")).toBe("");
  });

  it("personal data drops the whole text, plain work text is kept tidy", () => {
    expect(keepable("How do we price a frame agreement?")).toMatchObject({
      ok: true,
      text: "How do we price a frame agreement",
    });
    for (const t of [
      "Who is jane@example.invalid?",
      "Call +1 514 555 0199 about pricing",
      "Why was my sick leave refused",
      "salary bands for consultants",
      "my son starts a new school",
      "?",
    ])
      expect(keepable(t).ok, t).toBe(false);
    expect(keepable("x".repeat(700)).ok).toBe(false);
  });

  it("the title is sentence case without the question mark", () => {
    expect(titleOf("how do we price a frame agreement?")).toBe("How do we price a frame agreement");
  });

  it("score halves every two weeks without a new ask, and closure counts only gaps that needed an answer", () => {
    const g = { count: 4, askers: 2, lastAt: FRI };
    expect(scoreOf(g, FRI)).toBe(6);
    expect(scoreOf(g, FRI + 14 * DAY)).toBe(3);
    expect(closureRate([])).toBeNull();
    expect(closureRate(["closed", "open", "dismissed", "merged"])).toBe(50);
    const days = daysOf({ "2026-11-06": 3 }, FRI, 3);
    expect(days.map((d) => d.count)).toEqual([0, 0, 3]);
  });
});
