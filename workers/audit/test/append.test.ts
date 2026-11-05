import { SELF } from "cloudflare:test";
import { expect, it } from "vitest";

it("POST /append is a stub that accepts", async () => {
  const res = await SELF.fetch("https://example.com/append", { method: "POST", body: "{}" });
  expect(res.status).toBe(202);
});
