// v3 brains over MCP: the guide and the coach proposal, and what revoking a connection does.

import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { hostOf } from "../../../packages/contracts/src/agent-host.ts";
import {
  apiCalls,
  callTool,
  clearApiCalls,
  clearAudit,
  getToken,
  type Loose,
  rpc,
} from "./helpers.ts";

const textOf = (r: { json: Loose }) => r.json?.result?.content?.[0]?.text as string;

beforeEach(async () => {
  await clearAudit();
  await clearApiCalls();
  await env.API.fetch("https://api.internal/__revoked", { method: "DELETE" });
});

describe("brain tools", () => {
  it("get_brain_guide reads the guide route with the read scope only", async () => {
    const t = await getToken({ scope: "secondary.read" });
    const r = await callTool(t.token as string, "get_brain_guide", { brainId: "c_bid" });
    const g = JSON.parse(textOf(r));
    expect(g.brain.id).toBe("c_bid");
    expect(g.collections[0].type).toBe("topic");
    const call = (await apiCalls()).find((c) => c.path === "/v1/brains/c_bid/guide");
    expect(call?.method).toBe("GET");
    expect(call?.principal.tool).toBe("get_brain_guide");
  });

  it("coach_propose_structure needs the contribute scope and only proposes", async () => {
    const ro = await getToken({ scope: "secondary.read" });
    const denied = await callTool(ro.token as string, "coach_propose_structure", {
      brainId: "c_bid",
      answers: { role: "Bid manager" },
    });
    expect(denied.res.status).toBe(403);
    expect(await apiCalls()).toEqual([]);

    const t = await getToken({ scope: "secondary.read secondary.contribute" });
    const r = await callTool(t.token as string, "coach_propose_structure", {
      brainId: "c_bid",
      answers: { role: "Bid manager", accounts: ["Acme"] },
    });
    expect(JSON.parse(textOf(r)).proposalId).toMatch(/^coach-/);
    const paths = (await apiCalls()).map((c) => `${c.method} ${c.path}`);
    expect(paths).toEqual(["POST /v1/brains/c_bid/coach/propose"]);
    // There is no tool that applies a structure.
    const names = (await rpc(t.token as string, "tools/list")).json.result.tools.map(
      (x: { name: string }) => x.name,
    );
    expect(names).not.toContain("coach_apply_structure");
    expect(names.join(" ")).not.toMatch(/apply/);
  });

  it("a brain the user does not manage is refused by the API and the refusal reaches the host", async () => {
    const t = await getToken({ scope: "secondary.read secondary.contribute" });
    const r = await callTool(t.token as string, "coach_propose_structure", {
      brainId: "denied",
      answers: {},
    });
    expect(r.json.result.isError).toBe(true);
  });
});

describe("agent connections", () => {
  it("every call carries the grant and the host, never the token", async () => {
    const t = await getToken({ scope: "secondary.read", clientName: "Claude Test" });
    await callTool(t.token as string, "whoami");
    const call = (await apiCalls()).find((c) => c.path === "/v1/me");
    expect(call?.principal.grant_id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(call?.principal.host).toBe("claude_ai");
    expect(call?.hasAuthorization).toBe(false);
    expect(JSON.stringify(call)).not.toContain(t.token as string);
  });

  it("revoking in the API kills the token at the host's end too", async () => {
    const t = await getToken({ scope: "secondary.read" });
    const token = t.token as string;
    expect((await callTool(token, "whoami")).res.status).toBe(200);

    // The API now answers connection_revoked for this grant.
    await env.API.fetch("https://api.internal/__revoked", { method: "PUT" });
    const refused = await callTool(token, "whoami");
    expect(refused.json.result.isError).toBe(true);
    expect(textOf(refused)).toContain("connection_revoked");

    // The grant was deleted: the token is dead even if the API would have answered.
    await env.API.fetch("https://api.internal/__revoked", { method: "DELETE" });
    const after = await callTool(token, "whoami");
    expect(after.res.status).toBe(401);
  });
});

describe("host labels", () => {
  it("maps redirect URIs and names to a host", () => {
    expect(hostOf(["https://claude.ai/api/mcp/auth_callback"], "x")).toBe("claude_ai");
    expect(hostOf(["https://chatgpt.com/connector/oauth/abc"], "x")).toBe("chatgpt");
    expect(hostOf(["https://eu.dust.tt/oauth/x"], "x")).toBe("dust");
    expect(hostOf(["http://localhost:8123/cb"], "Codex CLI")).toBe("codex");
    expect(hostOf(["http://localhost:8123/cb"], "Claude Code")).toBe("claude_code");
    expect(hostOf(["https://example.invalid/cb"], "x")).toBe("other");
    expect(hostOf(["nope"], "")).toBe("other");
  });
});
