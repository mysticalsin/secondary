import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mcpEnabled } from "../src/switch.ts";
import { callTool, getToken, rpc } from "./helpers.ts";

const setMcp = (on: boolean) =>
  env.API.fetch("https://api.internal/__switch", { method: on ? "DELETE" : "PUT" });
afterEach(() => setMcp(true));

describe("MCP kill switch", () => {
  it("answers 503 switched_off on /mcp while the switch is off, and works again when it is on", async () => {
    const t = await getToken();
    expect((await rpc(t.token as string, "tools/list")).res.status).toBe(200);
    await setMcp(false);
    const off = await rpc(t.token as string, "tools/list");
    expect(off.res.status).toBe(503);
    expect(off.json).toEqual({ error: "switched_off", switch: "mcp" });
    expect((await callTool(t.token as string, "whoami")).res.status).toBe(503);
    await setMcp(true);
    expect((await rpc(t.token as string, "tools/list")).res.status).toBe(200);
  });
});

describe("I-03: the edge pre-check fails open and says so", () => {
  const withApi = (fetch: () => Promise<Response>) =>
    ({ ...env, SWITCH_CACHE_MS: "0", API: { fetch } }) as unknown as Env;

  it("logs mcp_switch_check_failed when the API answers an error or does not answer", async () => {
    const later = Date.now() + 3_600_000;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(
        await mcpEnabled(
          withApi(async () => new Response("no", { status: 500 })),
          later,
        ),
      ).toBe(true);
      expect(
        await mcpEnabled(
          withApi(async () => {
            throw new Error("down");
          }),
          later + 10,
        ),
      ).toBe(true);
      const lines = log.mock.calls
        .map((c) => String(c[0]))
        .filter((l) => l.includes("mcp_switch_check_failed"));
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain('"status":500');
      expect(lines[1]).toContain('"errorName":"Error"');
    } finally {
      log.mockRestore();
    }
  });
});
