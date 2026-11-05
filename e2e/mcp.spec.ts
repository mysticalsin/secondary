import { expect, test } from "@playwright/test";
import { runMcpFlow } from "./mcp-flow.ts";
import { MCP_URL } from "./ports.ts";

test("scripted MCP host: whoami, search and render_view through the local mcp worker", async () => {
  const r = await runMcpFlow(MCP_URL, "ceo");
  expect(r.whoami.result.principal.roleIds).toEqual(["ceo"]);
  expect(r.tools).toEqual(expect.arrayContaining(["whoami", "search", "render_view"]));
  expect(r.tools).not.toEqual(expect.arrayContaining(["approve_release", "delete"]));
  expect(r.searchHits).toBeGreaterThan(0);
  expect(r.renderView.title).toBe("Company overview");
  expect(r.renderView.components).toBe(2);
  expect(Object.values(r.extras).every(Boolean)).toBe(true);
});
