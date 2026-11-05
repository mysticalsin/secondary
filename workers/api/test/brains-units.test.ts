import { describe, expect, it } from "vitest";
import { computeHealth, normaliseValue, parseFields } from "../src/brains/model.ts";
import { sanitizeMarkdown } from "../src/brains/sanitize.ts";
import { ALPHA, as, json, type Loose, rawEnv, seed, tenantDo } from "./helpers.ts";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 5);
const page = (id: string, type: string, md: string, age = 0) => ({
  id,
  type,
  markdown: md,
  updatedAt: NOW - age * DAY,
});

describe("health score", () => {
  const base = {
    now: NOW,
    freshnessDays: 180,
    lint: 0,
    backlog: 0,
    skipTypes: new Set(["journal"]),
  };

  it("is 100 for a healthy brain and drops with each signal", () => {
    const pages = [page("a", "topic", "[[b]]"), page("b", "topic", "[[a]]")];
    const ok = computeHealth({ ...base, pages, expected: ["topic"] });
    expect(ok.score).toBe(100);
    expect(computeHealth({ ...base, pages, expected: ["topic"], lint: 5 }).score).toBeLessThan(
      ok.score,
    );
    expect(computeHealth({ ...base, pages, expected: ["topic"], backlog: 10 }).score).toBeLessThan(
      ok.score,
    );
    expect(
      computeHealth({ ...base, pages, expected: ["topic", "method", "glossary"] }).components
        .coverage,
    ).toMatchObject({
      have: 1,
      want: 3,
      missing: ["method", "glossary"],
    });
    const stale = [page("a", "topic", "[[b]]", 400), page("b", "topic", "[[a]]", 400)];
    expect(
      computeHealth({ ...base, pages: stale, expected: ["topic"] }).components.freshness.value,
    ).toBe(0);
    const orphans = [page("a", "topic", "x"), page("b", "topic", "y")];
    expect(
      computeHealth({ ...base, pages: orphans, expected: ["topic"] }).components.orphans.value,
    ).toBe(2);
  });

  it("leaves out a signal the caller may not see, and journals are not orphans", () => {
    const pages = [
      page("a", "topic", "[[b]]"),
      page("b", "topic", "[[a]]"),
      page("journal-2026-11-04", "journal", "x"),
    ];
    const h = computeHealth({ ...base, pages, expected: ["topic"], lint: null, backlog: null });
    expect(h.components.lint).toBeNull();
    expect(h.components.backlog).toBeNull();
    expect(h.components.orphans.value).toBe(0);
    expect(h.score).toBe(100);
    // An empty brain is not "unhealthy by orphans", but it lacks its collections.
    const empty = computeHealth({ ...base, pages: [], expected: ["topic", "method"] });
    expect(empty.components.coverage.value).toBe(0);
    expect(empty.score).toBeLessThan(100);
  });
});

describe("sanitizeMarkdown", () => {
  it("removes every route to script execution and keeps the words", () => {
    const out = sanitizeMarkdown(
      [
        "Plain **text** stays.",
        "[a](JaVaScRiPt:alert(1)) [b](&#106;avascript:alert(1)) [c](%6Aavascript:alert(1)) [d](vbscript:x) [e](file:///etc/passwd)",
        "<SCRIPT>alert(1)</SCRIPT><svg onload=alert(1)><style>*{x:y}</style><details open ontoggle=alert(1)>x</details>",
        "![i](x) <!-- hidden --> [ok](https://example.invalid) [rel](/a/b) [anchor](#top) [mail](mailto:a@example.invalid)",
        "[[a_acme:secret]] {src:rec:1} \u0000",
      ].join("\n"),
    );
    expect(out).toContain("Plain **text** stays.");
    expect(out).toContain("[ok](https://example.invalid)");
    expect(out).toContain("[rel](/a/b)");
    expect(out).toContain("[anchor](#top)");
    for (const bad of [
      "javascript:",
      "&#106;",
      "%6A",
      "vbscript",
      "file:",
      "<",
      "alert",
      "onload",
      "ontoggle",
      "hidden",
      "{src",
      "[[",
      "\u0000",
      "*{x:y}",
    ])
      expect(out.toLowerCase(), bad).not.toContain(bad.toLowerCase());
  });
});

describe("field schema", () => {
  it("normalises values by type", () => {
    const f = (type: string, extra: Loose = {}) =>
      ({
        key: "k",
        label: "K",
        type,
        sensitivity: "none",
        retentionDays: null,
        appliesTo: [],
        ...extra,
      }) as never;
    expect(normaliseValue(f("number"), " 12.5 ")).toBe("12.5");
    expect(normaliseValue(f("number"), "1e9")).toBeNull();
    expect(normaliseValue(f("date"), "2026-02-30")).toBeNull();
    expect(normaliseValue(f("date"), "2026-11-05")).toBe("2026-11-05");
    expect(normaliseValue(f("url"), "javascript:alert(1)")).toBeNull();
    expect(normaliseValue(f("url"), "https://example.invalid/x")).toBe("https://example.invalid/x");
    expect(normaliseValue(f("select", { options: ["a"] }), "b")).toBeNull();
    expect(normaliseValue(f("text"), "<b>x</b>")).toBeNull();
    expect(normaliseValue(f("text"), "x".repeat(501))).toBeNull();
  });

  it("rejects what the schema may not contain", () => {
    const f = { key: "ok_key", label: "L", type: "text" };
    expect(parseFields([f]).ok).toBe(true);
    expect(parseFields("no")).toEqual({ ok: false, code: "invalid_fields" });
    expect(parseFields([{ ...f, key: "9x" }])).toEqual({ ok: false, code: "invalid_field_key" });
    expect(parseFields([{ ...f, type: "html" }])).toEqual({
      ok: false,
      code: "invalid_field_type",
    });
    expect(parseFields([{ ...f, appliesTo: ["Bad Type"] }])).toEqual({
      ok: false,
      code: "invalid_applies_to",
    });
  });
});

describe("erasure", () => {
  it("a person's agent connections and pilot invitations go with them", async () => {
    await seed();
    const email = "gone.person@example.invalid";
    const id = (await json<Loose>(await as("consultant", "/v1/me", { email }))).principal
      .id as string;
    const tenant = tenantDo(ALPHA);
    await tenant.humanIds(id, email); // the directory remembers the address this person signs in with
    await tenant.agentSeen({
      principalId: id,
      grantId: "g-erase",
      clientId: "c",
      host: "other",
      scopes: ["secondary.read"],
      tool: "whoami",
      now: Date.now(),
    });
    await tenant.pilotSave(
      {
        id: "erase-cohort",
        name: "E",
        members: [email, "keep@example.invalid"],
        flags: { coach: true },
      },
      true,
      Date.now(),
    );
    expect((await tenant.agentList(id)).length).toBe(1);
    await tenant.erasePrincipal(id);
    expect(await tenant.agentList(id)).toEqual([]);
    const cohort = (await tenant.pilotList()).find((c) => c.id === "erase-cohort");
    expect(cohort?.members).toEqual(["keep@example.invalid"]);
    expect(rawEnv).toBeTruthy();
  });
});
