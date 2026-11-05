// v3 brains: agent connections (status and revoke) and pilot cohorts.

import { beforeAll, describe, expect, it } from "vitest";
import { signInternalRequest } from "../src/internal-auth.ts";
import { as, call, json, type Loose, rawEnv, seed } from "./helpers.ts";

const KEY = (rawEnv as unknown as Env).INTERNAL_HMAC_KEY as string;
const ME = "ag.me@example.invalid";
const OTHER = "ag.other@example.invalid";

async function mcp(
  email: string,
  grant: string | undefined,
  o: { host?: string; client?: string; tool?: string; scope?: string[]; path?: string } = {},
) {
  const path = o.path ?? "/v1/me";
  const url = `https://secondary.example.test${path}`;
  const headers = await signInternalRequest({
    secret: KEY,
    method: "GET",
    url,
    principal: {
      v: 1,
      iss: "secondary-mcp",
      aud: "secondary-api",
      sub: `sub-${email}`,
      email,
      persona: "consultant",
      client_id: o.client ?? "client-claude",
      scope: o.scope ?? ["secondary.read"],
      tool: o.tool ?? "whoami",
      ...(grant ? { grant_id: grant } : {}),
      ...(o.host ? { host: o.host } : {}),
    },
    now: Math.floor(Date.now() / 1000),
  });
  return call(path, { token: null, headers });
}

const agents = async (persona: string, email: string) =>
  json<Loose>(await as(persona, "/v1/agents", { email }));
const host = (a: Loose, id: string) => a.hosts.find((h: Loose) => h.id === id);

beforeAll(async () => {
  await seed();
});

describe("agent connections", () => {
  it("lists every host, with the last call and the scopes of each connection", async () => {
    const before = await agents("consultant", ME);
    expect(before.hosts.map((h: Loose) => h.id)).toEqual([
      "claude_code",
      "claude_ai",
      "chatgpt",
      "codex",
      "dust",
      "copilot_studio",
      "other",
    ]);
    expect(before.hosts.every((h: Loose) => h.connected === false && h.lastCallAt === null)).toBe(
      true,
    );

    expect(
      (await mcp(ME, "grant-claude-1", { host: "claude_ai", tool: "wiki_search" })).status,
    ).toBe(200);
    expect(
      (
        await mcp(ME, "grant-claude-1", {
          host: "claude_ai",
          tool: "get_brain_guide",
          scope: ["secondary.read", "secondary.contribute"],
        })
      ).status,
    ).toBe(200);
    expect((await mcp(ME, "grant-gpt-1", { host: "chatgpt", client: "client-gpt" })).status).toBe(
      200,
    );

    const a = await agents("consultant", ME);
    const claude = host(a, "claude_ai");
    expect(claude).toMatchObject({ connected: true, calls: 2 });
    expect(claude.scopes).toEqual(["secondary.contribute", "secondary.read"]);
    expect(claude.connections).toHaveLength(1);
    expect(claude.connections[0]).toMatchObject({
      id: "grant-claude-1",
      lastTool: "get_brain_guide",
      state: "active",
      scopes: ["secondary.read", "secondary.contribute"],
    });
    expect(new Date(claude.lastCallAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(host(a, "chatgpt")).toMatchObject({ connected: true, calls: 1 });
    expect(host(a, "dust")).toMatchObject({ connected: false, calls: 0 });
  });

  it("shows only the caller's own connections", async () => {
    const other = await agents("consultant", OTHER);
    expect(other.hosts.every((h: Loose) => h.connected === false)).toBe(true);
    expect(JSON.stringify(other)).not.toContain("grant-claude-1");
  });

  it("revoking kills the token: the next call is refused, and nothing else of the person changes", async () => {
    const r = await as("consultant", "/v1/agents/connections/grant-claude-1/revoke", {
      email: ME,
      method: "POST",
    });
    expect(r.status).toBe(200);
    expect(await json(r)).toEqual({ ok: true, revoked: 1 });

    const after = await mcp(ME, "grant-claude-1", { host: "claude_ai" });
    expect(after.status).toBe(403);
    expect(await json(after)).toEqual({ error: "connection_revoked" });
    // A revoked call is not counted, and the host shows the connection as revoked.
    const a = await agents("consultant", ME);
    expect(host(a, "claude_ai")).toMatchObject({ connected: false, calls: 2 });
    expect(host(a, "claude_ai").connections[0].state).toBe("revoked");
    // The other host still works, and the person can still use the web app.
    expect((await mcp(ME, "grant-gpt-1", { host: "chatgpt", client: "client-gpt" })).status).toBe(
      200,
    );
    expect((await as("consultant", "/v1/me", { email: ME })).status).toBe(200);
    // Connecting again creates a new grant, which works.
    expect((await mcp(ME, "grant-claude-2", { host: "claude_ai" })).status).toBe(200);
    // A second revoke of the same grant is a no-op, not an error.
    const again = await as("consultant", "/v1/agents/connections/grant-claude-1/revoke", {
      email: ME,
      method: "POST",
    });
    expect(await json(again)).toEqual({ ok: true, revoked: 0 });
  });

  it("nobody revokes someone else's connection", async () => {
    const r = await as("consultant", "/v1/agents/connections/grant-gpt-1/revoke", {
      email: OTHER,
      method: "POST",
    });
    expect(r.status).toBe(404);
    expect((await mcp(ME, "grant-gpt-1", { host: "chatgpt", client: "client-gpt" })).status).toBe(
      200,
    );
    expect(
      (
        await as("consultant", "/v1/agents/connections/bad id!/revoke", {
          email: ME,
          method: "POST",
        })
      ).status,
    ).toBe(404);
    expect(
      (await as("consultant", "/v1/agents/hosts/nowhere/revoke", { email: ME, method: "POST" }))
        .status,
    ).toBe(404);
  });

  it("revoking a host revokes every connection of that host", async () => {
    expect((await mcp(ME, "grant-claude-3", { host: "claude_ai" })).status).toBe(200);
    const r = await as("consultant", "/v1/agents/hosts/claude_ai/revoke", {
      email: ME,
      method: "POST",
    });
    expect(await json(r)).toEqual({ ok: true, revoked: 2 });
    for (const g of ["grant-claude-2", "grant-claude-3"])
      expect((await mcp(ME, g, { host: "claude_ai" })).status, g).toBe(403);
    expect((await mcp(ME, "grant-gpt-1", { host: "chatgpt", client: "client-gpt" })).status).toBe(
      200,
    );
  });

  it("a call without a grant id is unaffected (older callers), and holds no token", async () => {
    expect((await mcp("ag.old@example.invalid", undefined)).status).toBe(200);
    const a = await agents("consultant", "ag.old@example.invalid");
    expect(a.hosts.every((h: Loose) => h.connected === false)).toBe(true);
  });
});

describe("pilot cohorts", () => {
  const ADMIN = "pilot.admin@example.invalid";
  const IN = "pilot.in@example.invalid";
  const OUT = "pilot.out@example.invalid";
  const admin = (path: string, o: Loose = {}) =>
    as("platform_admin", `/v1/admin/pilot${path}`, { email: ADMIN, ...o });

  it("is for an admin only", async () => {
    for (const persona of ["ceo", "head_bid", "consultant", "auditor"]) {
      expect(
        (await as(persona, "/v1/admin/pilot", { email: `p.${persona}@example.invalid` })).status,
        persona,
      ).toBe(403);
      expect(
        (
          await as(persona, "/v1/admin/pilot", {
            email: `p.${persona}@example.invalid`,
            body: { name: "x", members: [] },
          })
        ).status,
        persona,
      ).toBe(403);
    }
    const list = await json<Loose>(await admin(""));
    expect(list.flagKeys).toEqual(["brains_v3", "imports", "coach", "batch_review", "journal"]);
  });

  it("everything is on until a cohort mentions a flag", async () => {
    const f = await json<Loose>(await as("consultant", "/v1/me/flags", { email: OUT }));
    expect(f.flags).toEqual({
      brains_v3: true,
      imports: true,
      coach: true,
      batch_review: true,
      journal: true,
    });
  });

  it("a cohort turns a managed flag on for its members only, and the API enforces it", async () => {
    const bad = await admin("", { body: { name: "Bad", members: ["not-an-email"] } });
    expect(bad.status).toBe(400);
    expect(
      (await admin("", { body: { name: "Bad", members: [], flags: { nope: true } } })).status,
    ).toBe(400);
    const made = await admin("", {
      body: {
        name: "Wave one",
        members: [IN.toUpperCase()],
        flags: { imports: true, coach: false },
      },
    });
    expect(made.status).toBe(201);
    const id = (await json<Loose>(made)).id as string;

    const list = await json<Loose>(await admin(""));
    expect(list.cohorts).toHaveLength(1);
    expect(list.cohorts[0]).toMatchObject({
      id,
      name: "Wave one",
      members: [IN],
      flags: { imports: true, coach: false },
    });

    const inFlags = (await json<Loose>(await as("consultant", "/v1/me/flags", { email: IN })))
      .flags;
    const outFlags = (await json<Loose>(await as("consultant", "/v1/me/flags", { email: OUT })))
      .flags;
    expect(inFlags).toMatchObject({ imports: true, coach: false, brains_v3: true });
    expect(outFlags).toMatchObject({ imports: false, coach: false, brains_v3: true });

    // Enforced: the person outside the cohort cannot import, the one inside can reach the route.
    const post = (email: string) =>
      as("consultant", "/v1/brains/me/import?format=okf", {
        email,
        method: "POST",
        rawBody: "x",
        headers: { "Content-Type": "application/zip" },
      });
    const refused = await post(OUT);
    expect(refused.status).toBe(403);
    expect(await json(refused)).toEqual({ error: "not_in_pilot", flag: "imports" });
    expect([200, 422, 413]).toContain((await post(IN)).status);
    // Coach is switched off for everyone (a cohort sets it false).
    const coach = await as("consultant", "/v1/brains/me/coach", { email: IN });
    expect(coach.status).toBe(403);
    expect(await json(coach)).toEqual({ error: "not_in_pilot", flag: "coach" });

    // Update and delete (audited, admin only), and the flag opens again for everyone.
    expect(
      (
        await admin(`/${id}`, {
          method: "PUT",
          body: { name: "Wave one", members: [IN, OUT], flags: { imports: true } },
        })
      ).status,
    ).toBe(200);
    expect(
      (await json<Loose>(await as("consultant", "/v1/me/flags", { email: OUT }))).flags.imports,
    ).toBe(true);
    expect(
      (
        await as("ceo", `/v1/admin/pilot/${id}`, {
          email: "p.ceo@example.invalid",
          method: "DELETE",
        })
      ).status,
    ).toBe(403);
    expect((await admin(`/${id}`, { method: "DELETE" })).status).toBe(200);
    expect((await admin(`/${id}`, { method: "DELETE" })).status).toBe(404);
    expect(
      (await json<Loose>(await as("consultant", "/v1/me/flags", { email: OUT }))).flags.coach,
    ).toBe(true);
  });

  it("the brains family itself can be limited to a cohort", async () => {
    const made = await admin("", {
      body: { name: "Brains pilot", members: [IN], flags: { brains_v3: true } },
    });
    const id = (await json<Loose>(made)).id as string;
    expect((await as("consultant", "/v1/brains", { email: OUT })).status).toBe(403);
    expect((await as("consultant", "/v1/brains", { email: IN })).status).toBe(200);
    await admin(`/${id}`, { method: "DELETE" });
    expect((await as("consultant", "/v1/brains", { email: OUT })).status).toBe(200);
  });
});
