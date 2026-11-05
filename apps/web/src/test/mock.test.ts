import { describe, expect, it } from "vitest";
import { handle } from "../mock/index";

describe("dev mock", () => {
  it("returns a synced source file in search and by id for a role that sees Delivery", async () => {
    const found = (await handle("GET", "/v1/search?q=handbook", undefined, "consultant")) as {
      results: { id: string; kind: string }[];
    };
    const src = found.results.find((r) => r.kind === "source");
    expect(src).toBeTruthy();
    const rec = (await handle(
      "GET",
      `/v1/sources/${encodeURIComponent(src?.id ?? "")}`,
      undefined,
      "consultant",
    )) as { kind: string; body: string };
    expect(rec.kind).toBe("source");
    expect(rec.body).toContain("Delivery handbook");
  });

  it("says plainly what it does not cover", async () => {
    await expect(handle("GET", "/v1/admin/changes", undefined, "ceo")).rejects.toMatchObject({
      status: 501,
    });
    await expect(
      handle("POST", "/v1/briefs", { accountId: "a_acme" }, "ceo"),
    ).rejects.toMatchObject({
      status: 501,
    });
    const st = (await handle("GET", "/v1/ai/status", undefined, "ceo")) as { state: string };
    expect(st.state).toBe("not_configured");
  });
});
