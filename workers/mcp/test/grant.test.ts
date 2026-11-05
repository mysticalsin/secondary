import { describe, expect, it } from "vitest";
import { grantOf } from "../src/index.ts";

// M-3: the grant id is what lets the API refuse a revoked connection. A token that does not carry one in
// the known shape yields none, and the MCP worker then refuses the call (403 grant_unknown) instead of
// calling the API without a revocation check.
describe("grantOf", () => {
  it("reads the grant id of the library's token shape", () => {
    expect(grantOf("user1:grant_abc-1:secretsecret")).toBe("grant_abc-1");
  });
  it("gives nothing for any other shape", () => {
    for (const t of [
      "",
      "plain",
      "a:b",
      "a:b:c:d",
      "a::c",
      "a:bad id!:c",
      `a:${"x".repeat(129)}:c`,
    ])
      expect(grantOf(t), t).toBeUndefined();
  });
});
