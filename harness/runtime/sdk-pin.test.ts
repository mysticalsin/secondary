import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

test("the MCP SDK pin cannot replace a tool through the public registerTool API", () => {
  const installed = JSON.parse(readFileSync("node_modules/@modelcontextprotocol/sdk/package.json", "utf8")).version;
  const declared = JSON.parse(readFileSync("package.json", "utf8")).dependencies["@modelcontextprotocol/sdk"];
  assert.equal(installed, "1.32.2");
  assert.equal(declared, "^1.32.2");
  const server = new McpServer({ name: "pin", version: "0" });
  server.registerTool("personal_note_create", { description: "original" }, async () => ({
    content: [{ type: "text", text: "original" }],
  }));
  assert.throws(
    () => server.registerTool("personal_note_create", { description: "replacement" }, async () => ({ content: [] })),
    /already registered/,
  );
  const entry = readFileSync("reconstruction/mcp/worker/src/import-entry.ts", "utf8");
  assert.equal(entry.includes("mcp_tool_map_unsupported"), true);
  assert.equal(entry.includes("legacy.remove()"), true);
});
