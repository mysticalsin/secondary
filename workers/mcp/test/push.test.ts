// v4 brain tools: list_brains, propose_page, propose_change, write_session_report. They act with the
// caller's rights through the API (which decides contributor-or-above and review); here: scopes, the
// exact API call, the projection, refusals and the audit trail.

import { beforeEach, describe, expect, it } from "vitest";
import {
  apiCalls,
  auditEvents,
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
});

describe("list_brains", () => {
  it("is read-only, needs only the read scope, and returns id, name, type, role and publication", async () => {
    const t = await getToken({ scope: "secondary.read" });
    const token = t.token as string;
    const listed = (await rpc(token, "tools/list")).json.result.tools as Loose[];
    expect(listed.find((x) => x.name === "list_brains")?.annotations.readOnlyHint).toBe(true);
    const r = await callTool(token, "list_brains");
    expect(JSON.parse(textOf(r))).toEqual({
      brains: [
        { id: "me", name: "My Secondary", type: "personal", role: "owner", publication: "review" },
        {
          id: "c_bid",
          name: "Bid & Pre-sales",
          type: "team",
          role: "contributor",
          publication: "review",
        },
      ],
    });
    const call = (await apiCalls())[0];
    expect(`${call?.method} ${call?.path}`).toBe("GET /v1/brains");
    expect(call?.principal.tool).toBe("list_brains");
  });
});

describe("push tools", () => {
  const WRITE = [
    ["propose_page", { brainId: "c_bid", title: "Pricing", markdown: "# Pricing\n- x" }],
    ["propose_change", { brainId: "c_bid", pageId: "pricing", markdown: "# Pricing\n- y" }],
    ["write_session_report", { brainId: "c_bid", markdown: "Worked on the bid." }],
  ] as const;

  it("need the contribute scope and never reach the API without it", async () => {
    const t = await getToken({ scope: "secondary.read" });
    for (const [tool, args] of WRITE) {
      const { res } = await callTool(t.token as string, tool, args);
      expect(res.status, tool).toBe(403);
      expect(res.headers.get("www-authenticate") ?? "", tool).toContain("secondary.contribute");
    }
    expect(await apiCalls()).toEqual([]);
  });

  it("call their own endpoint with the brain id in the path, signed as the caller", async () => {
    const t = await getToken({ scope: "secondary.read secondary.contribute" });
    const token = t.token as string;
    const page = await callTool(token, "propose_page", {
      brainId: "c_bid",
      title: "Pricing",
      markdown: "# Pricing\n- x",
      type: "method",
    });
    expect(JSON.parse(textOf(page))).toMatchObject({ status: "candidate", brainId: "c_bid" });
    await callTool(token, "propose_change", {
      brainId: "c_bid",
      pageId: "pricing",
      markdown: "# Pricing\n- y",
      rationale: "The fee changed",
    });
    const rep = await callTool(token, "write_session_report", {
      brainId: "c_bid",
      markdown: "Worked on the bid.",
      date: "2026-11-04",
    });
    expect(JSON.parse(textOf(rep)).folder).toEqual(["Sources", "Session reports", "Alice"]);
    const calls = await apiCalls();
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /v1/brains/c_bid/push/page",
      "POST /v1/brains/c_bid/push/change",
      "POST /v1/brains/c_bid/push/session-report",
    ]);
    expect(calls.map((c) => c.principal.tool)).toEqual([
      "propose_page",
      "propose_change",
      "write_session_report",
    ]);
    expect(calls[0]?.body).toEqual({
      title: "Pricing",
      markdown: "# Pricing\n- x",
      type: "method",
    });
    expect(calls[1]?.body).toEqual({
      pageId: "pricing",
      markdown: "# Pricing\n- y",
      rationale: "The fee changed",
    });
    expect(calls[2]?.body).toEqual({ markdown: "Worked on the bid.", date: "2026-11-04" });
    // None of them carries a way to publish: the body has no mode, no approval, no target state.
    for (const c of calls) expect(JSON.stringify(c.body)).not.toMatch(/publish|direct|approve/i);
    expect(calls.every((c) => !c.hasAuthorization)).toBe(true);
  });

  it("refuse a malformed id before the API, and a brain the API will not open reaches the host as a tool error", async () => {
    const t = await getToken({ scope: "secondary.read secondary.contribute" });
    const token = t.token as string;
    for (const [tool, args] of [
      ["propose_page", { brainId: "../x", title: "t", markdown: "m" }],
      ["propose_change", { brainId: "c_bid", pageId: "../x", markdown: "m" }],
      ["write_session_report", { brainId: "c_bid", markdown: "m", date: "yesterday" }],
      ["propose_page", { brainId: "c_bid", title: "t", markdown: "" }],
    ] as const) {
      const r = await callTool(token, tool, args);
      expect(r.json?.result?.isError ?? r.json?.error, tool).toBeTruthy();
    }
    expect(await apiCalls()).toEqual([]);

    const denied = await callTool(token, "propose_page", {
      brainId: "denied",
      title: "t",
      markdown: "m",
    });
    expect(denied.json.result.isError).toBe(true);
    const events = await auditEvents();
    expect(events.find((e) => e.action === "propose_page")).toMatchObject({ outcome: "denied" });
  });

  it("each successful call is audited once under its own tool name", async () => {
    const t = await getToken({ scope: "secondary.read secondary.contribute" });
    for (const [tool, args] of WRITE) await callTool(t.token as string, tool, args);
    const names = (await auditEvents())
      .filter((e) => e.kind === "mcp.tool_call")
      .map((e) => [e.action, e.outcome]);
    expect(names).toEqual([
      ["propose_page", "ok"],
      ["propose_change", "ok"],
      ["write_session_report", "ok"],
    ]);
  });

  it("the tool list has no approve, publish or delete tool next to them", async () => {
    const t = await getToken();
    const names = ((await rpc(t.token, "tools/list")).json.result.tools as Loose[]).map(
      (x) => x.name,
    );
    expect(names).toEqual(
      expect.arrayContaining([
        "list_brains",
        "propose_page",
        "propose_change",
        "write_session_report",
      ]),
    );
    expect(names.join(" ")).not.toMatch(/approve|publish|delete|remove|grant/);
  });
});
