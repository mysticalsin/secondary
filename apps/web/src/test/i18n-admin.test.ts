import { describe, expect, it } from "vitest";
import { en } from "../i18n/en";
import { fr } from "../i18n/fr";

const keys = (d: Record<string, string>) => Object.keys(d).filter((k) => k.startsWith("adm."));

// Same word in both languages, or an identifier that is never translated.
const SAME_IN_FRENCH = new Set([
  "adm.tab.audit", // "Audit" is French too
  "adm.bell.title", // "Notifications"
  "adm.actions", // "Actions"
  "adm.audit.action", // "Action"
  "adm.scope.global", // "global"
  "adm.hist.version", // "Version {n}"
]);

describe("admin i18n (adm.*)", () => {
  it("defines the same keys in English and French", () => {
    expect(keys(fr).sort()).toEqual(keys(en).sort());
    expect(keys(en).length).toBeGreaterThan(150);
  });

  it("translates every French value except the listed same-word cases", () => {
    const same = keys(en).filter(
      (k) => (en as Record<string, string>)[k] === (fr as Record<string, string>)[k],
    );
    expect(same.filter((k) => !SAME_IN_FRENCH.has(k))).toEqual([]);
  });

  it("keeps the same {placeholders} in both languages", () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of keys(en)) {
      expect(vars((fr as Record<string, string>)[k] ?? ""), k).toEqual(
        vars((en as Record<string, string>)[k] ?? ""),
      );
    }
  });
});
