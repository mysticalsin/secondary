import { describe, expect, it } from "vitest";
import { initialLang, translate } from "../i18n";
import { en } from "../i18n/en";
import { fr } from "../i18n/fr";
import { diffStats, lineDiff } from "../lib/diff";

describe("lineDiff", () => {
  it("marks added, removed and unchanged lines", () => {
    const d = lineDiff("a\nb\nc", "a\nc\nd");
    expect(d).toEqual([
      { type: "same", text: "a" },
      { type: "del", text: "b" },
      { type: "same", text: "c" },
      { type: "add", text: "d" },
    ]);
    expect(diffStats(d)).toEqual({ added: 1, removed: 1 });
  });
  it("treats no previous text as all added", () => {
    expect(lineDiff(null, "x\ny").every((l) => l.type === "add")).toBe(true);
  });
  it("identical text has no changes", () => {
    expect(diffStats(lineDiff("a\nb", "a\nb"))).toEqual({ added: 0, removed: 0 });
  });
  it("handles very long input without a table", () => {
    const big = Array.from({ length: 700 }, (_, i) => `l${i}`).join("\n");
    expect(lineDiff(big, big).length).toBe(1400);
  });
});

describe("dictionaries", () => {
  it("French defines exactly the English keys", () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
  });
  it("uses the same placeholders in both languages", () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
    for (const k of Object.keys(en) as (keyof typeof en)[]) expect(ph(fr[k]), k).toBe(ph(en[k]));
  });
  it("has no em dashes and no empty strings", () => {
    for (const d of [en, fr])
      for (const [k, v] of Object.entries(d)) {
        expect(v, k).not.toMatch(/—/);
        expect(v.length, k).toBeGreaterThan(0);
      }
  });
  it("fills variables", () => {
    expect(translate("fr", "acc.ov.overdue", { n: 3 })).toBe("3 en retard.");
  });
  it("takes the browser language by default", () => {
    expect(initialLang()).toBe("en");
  });
});
