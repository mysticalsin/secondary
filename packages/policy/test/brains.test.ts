import { describe, expect, it } from "vitest";
import {
  BRAIN_ROLES,
  brainRoleActions,
  brainTypeOf,
  effectiveEveryone,
  effectivePublication,
  everyoneBound,
  isShareable,
  minRoleFor,
  publicationBound,
  roleAllows,
} from "../src/index.ts";

describe("brain rules", () => {
  it("maps node kinds to brain types", () => {
    expect(brainTypeOf("core")).toBe("global");
    expect(brainTypeOf("account")).toBe("account");
    expect(brainTypeOf("circle")).toBe("team");
    expect(brainTypeOf("department")).toBe("team");
    expect(brainTypeOf("personal")).toBe("personal");
    expect(brainTypeOf("usecase")).toBeNull();
  });

  it("roles are a strict ladder and map to policy actions", () => {
    let prev = 0;
    for (const r of BRAIN_ROLES) {
      const n = brainRoleActions(r).length;
      expect(n).toBeGreaterThan(prev);
      prev = n;
    }
    expect(brainRoleActions("reader")).not.toContain("contribute");
    expect(brainRoleActions("contributor")).not.toContain("edit");
    expect(brainRoleActions("editor")).not.toContain("approve_release");
    expect(brainRoleActions("steward")).not.toContain("manage_members");
    expect(brainRoleActions("owner")).toContain("manage_members");
    expect(minRoleFor("edit")).toBe("editor");
    expect(minRoleFor("configure")).toBe("owner");
  });

  it("a stored role only narrows", () => {
    expect(roleAllows(null, "edit")).toBe(true);
    expect(roleAllows("reader", "contribute")).toBe(false);
    expect(roleAllows("editor", "edit")).toBe(true);
    expect(roleAllows("editor", "approve_release")).toBe(false);
  });

  it("publication is forced to review on account, restricted and global brains", () => {
    expect(publicationBound({ type: "account" }).allowed).toEqual(["review"]);
    expect(publicationBound({ type: "team", restricted: true }).allowed).toEqual(["review"]);
    expect(publicationBound({ type: "team", nda: true }).allowed).toEqual(["review"]);
    expect(publicationBound({ type: "global" }).allowed).toEqual(["review"]);
    expect(publicationBound({ type: "team" }).allowed).toContain("direct");
    expect(publicationBound({ type: "personal" }).allowed).toContain("direct");
    // A stored "direct" that no longer fits the bounds is not honoured.
    expect(effectivePublication({ type: "team", restricted: true }, "direct")).toBe("review");
    expect(effectivePublication({ type: "team" }, "direct")).toBe("direct");
  });

  it("Everyone at Mantu is impossible on account, NDA, restricted and personal brains", () => {
    for (const f of [
      { type: "account" as const },
      { type: "account" as const, nda: true },
      { type: "team" as const, restricted: true },
      { type: "personal" as const },
    ]) {
      expect(everyoneBound(f).allowed).toEqual(["none"]);
      expect(effectiveEveryone(f, "reader")).toBe("none");
    }
    expect(everyoneBound({ type: "team" }).allowed).toContain("reader");
  });

  it("a Personal Brain is not shareable", () => {
    expect(isShareable({ type: "personal" })).toBe(false);
    expect(isShareable({ type: "team" })).toBe(true);
  });
});
