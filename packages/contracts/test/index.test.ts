import { expect, it } from "vitest";
import { PACKAGE_NAME } from "../src/index.ts";

it("exports its package name", () => {
  expect(PACKAGE_NAME).toBe("@secondary/contracts");
});
