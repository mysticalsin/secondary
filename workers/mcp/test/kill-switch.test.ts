import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
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
