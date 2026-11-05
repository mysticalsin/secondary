import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { TOOL_NAMES, TOOL_SCOPES } from "../src/tools.ts";
import {
  ALICE,
  apiCalls,
  auditEvents,
  callTool,
  clearApiCalls,
  clearAudit,
  envWith,
  getToken,
  type Loose,
  rpc,
} from "./helpers.ts";

const CONTRACT_TOOLS = [
  "whoami",
  "search",
  "get_map",
  "get_node",
  "get_account",
  "list_review_queue",
  "personal_note_create",
  "contribute",
  "render_view",
  "wiki_search",
  "wiki_read",
  "wiki_propose",
  "lp_compose",
  "lp_compose_batch",
  "lp_list",
  "get_brain_guide",
  "coach_propose_structure",
];

beforeEach(async () => {
  await clearAudit();
  await clearApiCalls();
});

const textOf = (r: { json: Loose }) => r.json?.result?.content?.[0]?.text as string;

describe("tool list", () => {
  it("is exactly the contract list, with no write, approve, delete or membership tool", async () => {
    const t = await getToken();
    const { json } = await rpc(t.token, "tools/list");
    const names = (json.result.tools as { name: string }[]).map((x) => x.name).sort();
    expect(names).toEqual([...CONTRACT_TOOLS].sort());
    expect([...TOOL_NAMES].sort()).toEqual([...CONTRACT_TOOLS].sort());
    expect(names.join(" ")).not.toMatch(
      /approve|delete|remove|member|publish|grant|role|edit|update/,
    );
  });

  it("marks read tools read-only and draft tools as non-destructive", async () => {
    const t = await getToken();
    const { json } = await rpc(t.token, "tools/list");
    const by = Object.fromEntries(
      (json.result.tools as { name: string; annotations: Record<string, boolean> }[]).map((x) => [
        x.name,
        x.annotations,
      ]),
    );
    for (const n of [
      "whoami",
      "search",
      "get_map",
      "get_node",
      "get_account",
      "list_review_queue",
      "render_view",
    ]) {
      expect(by[n]?.readOnlyHint, n).toBe(true);
    }
    for (const n of ["personal_note_create", "contribute"]) {
      expect(by[n]).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    }
  });

  it("links render_view to the ui:// resource", async () => {
    const t = await getToken();
    const { json } = await rpc(t.token, "tools/list");
    const rv = (json.result.tools as { name: string; _meta?: Loose }[]).find(
      (x) => x.name === "render_view",
    );
    expect(rv?._meta?.ui?.resourceUri).toBe("ui://secondary/view");
    const res = await rpc(t.token, "resources/list");
    expect(res.json?.result.resources.map((r: { uri: string }) => r.uri)).toContain(
      "ui://secondary/view",
    );
  });
});

describe("scope enforcement", () => {
  it("needs the read baseline for any tool and each write scope for its tool", () => {
    for (const n of TOOL_NAMES) expect(TOOL_SCOPES[n]).toContain("secondary.read");
    expect(TOOL_SCOPES.personal_note_create).toContain("secondary.personal.write");
    expect(TOOL_SCOPES.contribute).toContain("secondary.contribute");
  });

  it("returns 403 insufficient_scope naming the missing scope, and never reaches the API", async () => {
    const t = await getToken({ scope: "secondary.read" });
    for (const [tool, args, missing] of [
      ["personal_note_create", { title: "a", body: "b" }, "secondary.personal.write"],
      [
        "contribute",
        { personalItemId: "pb:u1:n1", targetScopeId: "c_bid" },
        "secondary.contribute",
      ],
    ] as const) {
      const { res } = await callTool(t.token as string, tool, args);
      expect(res.status, tool).toBe(403);
      const challenge = res.headers.get("www-authenticate") ?? "";
      expect(challenge).toContain('error="insufficient_scope"');
      expect(challenge).toContain(missing);
      expect(challenge).toContain("resource_metadata=");
    }
    expect(await apiCalls()).toEqual([]);
  });

  it("lets a read-only token read", async () => {
    const t = await getToken({ scope: "secondary.read" });
    expect((await callTool(t.token as string, "whoami")).res.status).toBe(200);
  });

  it("allows write tools when the scopes were granted", async () => {
    const t = await getToken();
    const r = await callTool(t.token as string, "personal_note_create", { title: "t", body: "b" });
    expect(r.json?.result.isError).toBeUndefined();
    expect(JSON.parse(textOf(r))).toMatchObject({ ok: true });
  });
});

describe("landing page tools", () => {
  it("compose and batch create drafts through compose only, and list reads", async () => {
    const t = await getToken({ scope: "secondary.read secondary.contribute" });
    const token = t.token as string;
    const row = { role: "CIO", company: "Globex", angle: "cloud migration" };
    const one = await callTool(token, "lp_compose", row);
    expect(JSON.parse(textOf(one))).toMatchObject({ status: "draft" });
    const batch = await callTool(token, "lp_compose_batch", {
      rows: [row, { ...row, role: "CFO" }],
    });
    expect(JSON.parse(textOf(batch))).toMatchObject({ drafts: 2, failed: 0 });
    expect(JSON.parse(textOf(await callTool(token, "lp_list", {})))).toHaveLength(1);
    const calls = (await apiCalls()).filter((c) => c.path.startsWith("/v1/lp"));
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /v1/lp/compose",
      "POST /v1/lp/compose",
      "POST /v1/lp/compose",
      "GET /v1/lp",
    ]);
    const names = (await rpc(token, "tools/list")).json.result.tools.map(
      (x: { name: string }) => x.name,
    );
    expect(names.filter((n: string) => n.startsWith("lp_")).sort()).toEqual([
      "lp_compose",
      "lp_compose_batch",
      "lp_list",
    ]);
  });

  it("compose needs the contribute scope, list only read", async () => {
    const t = await getToken({ scope: "secondary.read" });
    const token = t.token as string;
    expect(
      (await callTool(token, "lp_compose", { role: "CIO", company: "Globex", angle: "ai" })).res
        .status,
    ).toBe(403);
    expect(
      (
        await callTool(token, "lp_compose_batch", {
          rows: [{ role: "CIO", company: "Globex", angle: "ai" }],
        })
      ).res.status,
    ).toBe(403);
    expect((await callTool(token, "lp_list", {})).res.status).toBe(200);
  });
});

describe("wiki tools", () => {
  it("search and read use the caller's own reads; propose needs the contribute scope and only creates a proposal", async () => {
    const t = await getToken({ scope: "secondary.read secondary.contribute" });
    const token = t.token as string;
    const s = await callTool(token, "wiki_search", { q: "fixed fee" });
    expect(JSON.parse(textOf(s)).results[0]).toMatchObject({ pageId: "decision-log" });
    const all = await callTool(token, "wiki_search", { q: "fee", workspace: "a_acme" });
    expect(all.json?.result.isError).toBeUndefined();
    const r = await callTool(token, "wiki_read", { workspace: "a_acme", page: "decision-log" });
    expect(JSON.parse(textOf(r))).toMatchObject({ id: "decision-log" });
    const p = await callTool(token, "wiki_propose", {
      workspace: "me",
      title: "Pricing",
      markdown: "# P\n- x",
    });
    expect(JSON.parse(textOf(p))).toMatchObject({ status: "candidate" });
    expect((await apiCalls()).map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /v1/wiki/all/search?q=fixed%20fee",
      "GET /v1/wiki/a_acme/search?q=fee",
      "GET /v1/wiki/a_acme/pages/decision-log",
      "POST /v1/wiki/me/propose",
    ]);
    expect((await apiCalls())[3]?.body).toEqual({ title: "Pricing", markdown: "# P\n- x" });
    expect((await apiCalls()).map((c) => c.principal.tool)).toEqual([
      "wiki_search",
      "wiki_search",
      "wiki_read",
      "wiki_propose",
    ]);
  });

  it("wiki_propose is refused without the contribute scope and never reaches the API", async () => {
    const t = await getToken({ scope: "secondary.read" });
    const { res } = await callTool(t.token as string, "wiki_propose", {
      workspace: "me",
      title: "x",
      markdown: "y",
    });
    expect(res.status).toBe(403);
    expect(res.headers.get("www-authenticate") ?? "").toContain("secondary.contribute");
    expect(await apiCalls()).toEqual([]);
    expect(
      (await callTool(t.token as string, "wiki_read", { workspace: "a_acme", page: "../x" })).json
        ?.result?.isError,
    ).toBeTruthy();
  });

  it("an API refusal is a tool error, audited as denied", async () => {
    const t = await getToken();
    const r = await callTool(t.token as string, "wiki_read", {
      workspace: "a_acme",
      page: "denied",
    });
    expect(r.json?.result.isError).toBe(true);
    expect((await auditEvents()).find((e) => e.action === "wiki_read")).toMatchObject({
      outcome: "denied",
    });
  });
});

describe("calls into workers/api", () => {
  it("maps each tool to its endpoint, signed as the caller, without forwarding the OAuth token", async () => {
    const t = await getToken({
      scope: "secondary.read secondary.personal.write secondary.contribute",
    });
    const token = t.token as string;
    await callTool(token, "whoami");
    await callTool(token, "search", { q: "pricing & rates" });
    await callTool(token, "get_map", { lens: "accounts" });
    await callTool(token, "get_node", { id: "c_bid:pricing-models" });
    await callTool(token, "get_account", { id: "a_acme" });
    await callTool(token, "list_review_queue");
    await callTool(token, "personal_note_create", { title: "My note", body: "Body text" });
    await callTool(token, "contribute", { personalItemId: "pb:u1:n1", targetScopeId: "c_bid" });
    const calls = await apiCalls();
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /v1/me",
      "GET /v1/search?q=pricing%20%26%20rates",
      "GET /v1/map?lens=accounts",
      "GET /v1/nodes/c_bid%3Apricing-models",
      "GET /v1/accounts/a_acme",
      "GET /v1/review",
      "POST /v1/personal/items",
      "POST /v1/personal/items/pb%3Au1%3An1/contribute",
    ]);
    expect(calls[6]?.body).toEqual({ kind: "note", title: "My note", body: "Body text" });
    expect(calls[7]?.body).toEqual({ targetScopeId: "c_bid" });
    for (const c of calls) {
      expect(c.principal, c.path).not.toBeNull();
      expect(c.principal.email).toBe(ALICE);
      expect(c.principal.client_id).toBe(t.clientId);
      expect(c.principal.scope.sort()).toEqual([
        "secondary.contribute",
        "secondary.personal.write",
        "secondary.read",
      ]);
      expect(c.hasAuthorization).toBe(false); // no token passthrough
    }
    expect(calls.map((c) => c.principal.tool)).toEqual([
      "whoami",
      "search",
      "get_map",
      "get_node",
      "get_account",
      "list_review_queue",
      "personal_note_create",
      "contribute",
    ]);
  });

  it("forwards the dev persona only from the dev test mode", async () => {
    const t = await getToken({ persona: "ceo" });
    await callTool(t.token as string, "whoami");
    expect((await apiCalls())[0]?.principal.persona).toBe("ceo");
  });

  it("validates tool input before calling the API", async () => {
    const t = await getToken();
    const bad = await callTool(t.token as string, "get_node", { id: "../../etc/passwd" });
    expect(bad.json?.error ?? bad.json?.result?.isError).toBeTruthy();
    const bad2 = await callTool(t.token as string, "get_map", { lens: "everything" });
    expect(bad2.json?.error ?? bad2.json?.result?.isError).toBeTruthy();
    expect(await apiCalls()).toEqual([]);
  });

  it("surfaces an API refusal as a tool error and audits it as denied", async () => {
    const t = await getToken();
    const r = await callTool(t.token as string, "get_node", { id: "denied" });
    expect(r.json?.result.isError).toBe(true);
    expect(textOf(r)).toContain("not admitted");
    expect((await auditEvents()).find((e) => e.action === "get_node")).toMatchObject({
      outcome: "denied",
      scope_ids: ["denied"],
    });
  });

  it("reports a refused service signature generically, without leaking details", async () => {
    const t = await getToken({
      e: envWith({ INTERNAL_HMAC_KEY: "a-different-key-0123456789abcdef-0123456789" }),
    });
    const r = await callTool(
      t.token as string,
      "whoami",
      {},
      envWith({ INTERNAL_HMAC_KEY: "a-different-key-0123456789abcdef-0123456789" }),
    );
    expect(r.json?.result.isError).toBe(true);
    expect(textOf(r)).toContain("service_auth_failed");
    expect(textOf(r)).not.toContain("bad_signature");
    expect((await apiCalls()).every((c) => c.principal === null)).toBe(true);
  });

  it("fails closed without a configured service key", async () => {
    const e = envWith({ INTERNAL_HMAC_KEY: "" });
    const t = await getToken({ e });
    const r = await callTool(t.token as string, "whoami", {}, e);
    expect(textOf(r)).toContain("service_auth_unconfigured");
    expect(await apiCalls()).toEqual([]);
  });
});

describe("audit", () => {
  it("writes one receipt per call with who, client, tool, scope ids and result count, and no content", async () => {
    const t = await getToken();
    const token = t.token as string;
    await callTool(token, "search", { q: "very sensitive search words" });
    await callTool(token, "get_node", { id: "c_bid:pricing-models" });
    await callTool(token, "personal_note_create", { title: "Private title", body: "Private body" });
    const ev = (await auditEvents()).filter((e) => e.kind === "mcp.tool_call");
    expect(ev.map((e) => e.action)).toEqual(["search", "get_node", "personal_note_create"]);
    expect(ev[0]).toMatchObject({
      outcome: "ok",
      client_id: t.clientId,
      result_count: 1,
      who: expect.stringMatching(/^dev-/),
    });
    expect(ev[1]).toMatchObject({ scope_ids: ["c_bid:pricing-models"], result_count: 2 });
    expect(ev[0]?.oauth_scopes).toEqual(expect.arrayContaining(["secondary.read"]));
    const all = JSON.stringify(ev);
    for (const secret of [
      "very sensitive",
      "Private title",
      "Private body",
      ALICE,
      "Pricing models",
      token,
    ]) {
      expect(all).not.toContain(secret);
    }
  });

  it("fails closed when the audit service is down", async () => {
    const t = await getToken();
    await env.AUDIT.fetch("https://audit.internal/down", { method: "PUT" });
    try {
      const r = await callTool(t.token as string, "whoami");
      expect(r.json?.result.isError).toBe(true);
      expect(textOf(r)).toContain("audit_unavailable");
      expect(textOf(r)).not.toContain("alice");
    } finally {
      await env.AUDIT.fetch("https://audit.internal/down", { method: "DELETE" });
    }
  });
});
