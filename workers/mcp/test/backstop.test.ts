import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/tools.ts";
import { apiCalls, auditEvents, clearApiCalls, clearAudit, type Loose } from "./helpers.ts";

// The SDK answers 403 insufficient_scope before a tool runs (see tools.test.ts). If that gate is ever
// bypassed (for example authInfo missing), each tool still refuses on its own. This drives the server
// directly over an in-memory transport, with no HTTP gate in front.

type Msg = {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: Loose;
  error?: Loose;
};

async function session(scopes: string[]) {
  const server = buildServer({
    env,
    caller: { sub: "dev-1", email: "alice@example.invalid", clientId: "client-x", scopes },
  });
  const sent: Msg[] = [];
  const transport = {
    onmessage: undefined as ((m: Msg) => void) | undefined,
    onclose: undefined as (() => void) | undefined,
    onerror: undefined as ((e: Error) => void) | undefined,
    start: async () => {},
    send: async (m: Msg) => {
      sent.push(m);
    },
    close: async () => {},
  };
  await server.connect(transport as never);
  let id = 0;
  const call = async (method: string, params: unknown) => {
    const my = ++id;
    transport.onmessage?.({ jsonrpc: "2.0", id: my, method, params });
    for (let i = 0; i < 200 && !sent.some((m) => m.id === my); i++)
      await new Promise((r) => setTimeout(r, 5));
    return sent.find((m) => m.id === my) as Msg;
  };
  await call("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "t", version: "1" },
  });
  transport.onmessage?.({ jsonrpc: "2.0", method: "notifications/initialized" });
  return { call };
}

beforeEach(async () => {
  await clearAudit();
  await clearApiCalls();
});

describe("in-tool scope backstop", () => {
  it("refuses a write tool without its scope, audits it as denied, and never calls the API", async () => {
    const { call } = await session(["secondary.read"]);
    for (const [name, args, missing] of [
      ["personal_note_create", { title: "t", body: "b" }, "secondary.personal.write"],
      [
        "contribute",
        { personalItemId: "pb:u1:n1", targetScopeId: "c_bid" },
        "secondary.contribute",
      ],
    ] as const) {
      const r = await call("tools/call", { name, arguments: args });
      expect(r.result?.isError, name).toBe(true);
      expect(r.result.structuredContent).toMatchObject({ error: "insufficient_scope" });
      expect(r.result.structuredContent.required_scopes).toContain(missing);
    }
    expect(await apiCalls()).toEqual([]);
    const ev = (await auditEvents()).filter((e) => e.kind === "mcp.tool_call");
    expect(ev.map((e) => [e.action, e.outcome, e.reason, e.result_count])).toEqual([
      ["personal_note_create", "denied", "insufficient_scope", 0],
      ["contribute", "denied", "insufficient_scope", 0],
    ]);
  });

  it("refuses everything for a token with no scopes", async () => {
    const { call } = await session([]);
    const r = await call("tools/call", { name: "whoami", arguments: {} });
    expect(r.result?.isError).toBe(true);
    expect(await apiCalls()).toEqual([]);
  });

  it("serves a read tool when the scope is present", async () => {
    const { call } = await session(["secondary.read"]);
    const r = await call("tools/call", { name: "whoami", arguments: {} });
    expect(r.result?.isError).toBeUndefined();
  });
});
