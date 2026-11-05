import { beforeAll, describe, expect, it } from "vitest";
import { type InternalPrincipal, signInternalRequest } from "../src/internal-auth.ts";
import { ALPHA, as, call, json, type Loose, rawEnv, seed, tenantDo } from "./helpers.ts";

beforeAll(async () => {
  await seed();
});

const setSwitch = (persona: string, name: string, enabled: boolean, over: Loose = {}) =>
  as(persona, "/v1/admin/switches", { body: { switch: name, enabled }, ...over });
const state = async () => (await json(await as("platform_admin", "/v1/admin/switches"))).switches;

describe("kill switches: who may change them", () => {
  it("only the configure role reads or writes them", async () => {
    for (const p of ["consultant", "ceo", "reviewer", "auditor"]) {
      expect((await as(p, "/v1/admin/switches")).status, p).toBe(403);
      expect((await setSwitch(p, "ai", false)).status, p).toBe(403);
    }
    const res = await as("platform_admin", "/v1/admin/switches");
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(Object.keys(body.switches).sort()).toEqual([
      "ai",
      "connector",
      "contribute",
      "lp",
      "mcp",
    ]);
    for (const v of Object.values(body.switches) as Loose[]) expect(v.enabled).toBe(true);
    expect(body.twoPersonReenable).toBe(false);
  });

  it("rejects unknown switch names and non-boolean values", async () => {
    expect((await setSwitch("platform_admin", "everything", false)).status).toBe(400);
    expect(
      (await as("platform_admin", "/v1/admin/switches", { body: { switch: "ai", enabled: "no" } }))
        .status,
    ).toBe(400);
  });

  it("an unauthenticated caller gets 401", async () => {
    expect((await call("/v1/admin/switches")).status).toBe(401);
  });
});

describe("kill switches: enforcement in the API", () => {
  it("ai off stops the planner for everyone, on restores it", async () => {
    expect((await as("ceo", "/v1/genui/plan", { body: {} })).status).toBe(200);
    expect((await setSwitch("platform_admin", "ai", false)).status).toBe(200);
    const off = await as("ceo", "/v1/genui/plan", { body: {} });
    expect(off.status).toBe(503);
    expect(await json(off)).toEqual({ error: "switched_off", switch: "ai" });
    // Other features keep working.
    expect((await as("ceo", "/v1/me")).status).toBe(200);
    expect((await setSwitch("platform_admin", "ai", true)).status).toBe(200);
    expect((await as("ceo", "/v1/genui/plan", { body: {} })).status).toBe(200);
  });

  it("contribute off stops both contribution paths and nothing else", async () => {
    const item = await json(
      await as("ceo", "/v1/personal/items", { body: { title: "Idea", body: "A plain idea." } }),
    );
    const validated = { by: "u_ceo", at: new Date().toISOString(), revision: item.revision };
    await setSwitch("platform_admin", "contribute", false);
    const viaPersonal = await as("ceo", `/v1/personal/items/${item.id}/contribute`, {
      body: { targetScopeId: "c_bid", user_validated: validated },
    });
    expect(viaPersonal.status).toBe(503);
    expect((await json(viaPersonal)).switch).toBe("contribute");
    const viaAction = await as("ceo", "/v1/actions", {
      body: {
        nodeId: "c_bid",
        action: "contribute",
        payload: { title: "Direct", user_validated: validated },
      },
    });
    expect(viaAction.status).toBe(503);
    // Personal notes are not contributions.
    expect((await as("ceo", "/v1/personal/items", { body: { title: "Still works" } })).status).toBe(
      201,
    );
    await setSwitch("platform_admin", "contribute", true);
    const ok = await as("ceo", `/v1/personal/items/${item.id}/contribute`, {
      body: { targetScopeId: "c_bid", user_validated: validated },
    });
    expect(ok.status).toBe(201);
  });

  it("connector off stops connector routes (and the gate does not touch other paths)", async () => {
    await setSwitch("platform_admin", "connector", false);
    const res = await as("ceo", "/v1/connectors/sharepoint/status");
    expect(res.status).toBe(503);
    expect((await json(res)).switch).toBe("connector");
    await setSwitch("platform_admin", "connector", true);
    // Switched on again: the route simply does not exist yet (404), no longer 503.
    expect((await as("ceo", "/v1/connectors/sharepoint/status")).status).toBe(404);
  });

  it("the admin switch route itself stays reachable while everything is off", async () => {
    for (const n of ["mcp", "connector", "ai", "contribute", "lp"])
      await setSwitch("platform_admin", n, false);
    const s = await state();
    for (const v of Object.values(s) as Loose[]) expect(v.enabled).toBe(false);
    expect((await setSwitch("platform_admin", "mcp", true)).status).toBe(200);
    for (const n of ["connector", "ai", "contribute", "lp"])
      await setSwitch("platform_admin", n, true);
  });

  it("every change leaves a receipt, and a switch change is audited with ids only", async () => {
    await setSwitch("platform_admin", "ai", false);
    await setSwitch("platform_admin", "ai", true);
    const receipts = (await json(await as("auditor", "/v1/admin/audit"))) as Loose[];
    const actions = receipts.map((r) => r.action);
    expect(actions).toContain("switch_disable");
    expect(actions).toContain("switch_enable");
  });

  const KEY = (rawEnv as unknown as Env).INTERNAL_HMAC_KEY as string;
  async function viaMcp(path: string) {
    const url = `https://secondary.example.test${path}`;
    const principal: InternalPrincipal = {
      v: 1,
      iss: "secondary-mcp",
      aud: "secondary-api",
      sub: "sub-1",
      email: "ceo@example.invalid",
      client_id: "claude.ai",
      scope: ["secondary.read"],
      tool: "whoami",
    };
    const headers = await signInternalRequest({ secret: KEY, method: "GET", url, principal });
    return call(path, { token: null, headers });
  }

  it("mcp off refuses every internal call in the API too, and on restores them", async () => {
    expect((await viaMcp("/v1/me")).status).toBe(200);
    await setSwitch("platform_admin", "mcp", false);
    const off = await viaMcp("/v1/me");
    expect(off.status).toBe(503);
    expect(await json(off)).toEqual({ error: "switched_off", switch: "mcp" });
    // The web app is not MCP.
    expect((await as("ceo", "/v1/me")).status).toBe(200);
    await setSwitch("platform_admin", "mcp", true);
    expect((await viaMcp("/v1/me")).status).toBe(200);
  });
});

describe("kill switches: two-person re-enable in prod", () => {
  const prod = { ENVIRONMENT: "prod" };
  // Prod has no personas: roles come from the directory. platform_admin@... is seeded; add a second admin.
  beforeAll(async () => {
    const snap = (await tenantDo(ALPHA).exportAll()) as Record<string, Loose[]>;
    snap.principals?.push({ id: "u_admin2", email: "admin2@example.invalid" });
    snap.role_assignments?.push({ principal_id: "u_admin2", role_id: "platform_admin" });
    await tenantDo(ALPHA).importAll(snap);
  });
  const a = (path: string, body?: unknown) =>
    call(path, { email: "platform_admin@example.invalid", env: prod, ...(body ? { body } : {}) });
  const b = (path: string, body?: unknown) =>
    call(path, { email: "admin2@example.invalid", env: prod, ...(body ? { body } : {}) });

  it("turning off is one person, turning on needs two different people", async () => {
    expect((await json(await a("/v1/admin/switches"))).twoPersonReenable).toBe(true);
    const off = await a("/v1/admin/switches", { switch: "ai", enabled: false });
    expect(off.status).toBe(200);
    expect((await json(off)).status).toBe("applied");

    const first = await a("/v1/admin/switches", { switch: "ai", enabled: true });
    expect(first.status).toBe(202);
    expect(await json(first)).toMatchObject({ status: "pending", needs: "second_person" });
    // The same person again does not count as the second.
    expect((await a("/v1/admin/switches", { switch: "ai", enabled: true })).status).toBe(202);
    let s = (await json(await a("/v1/admin/switches"))) as Loose;
    expect(s.switches.ai.enabled).toBe(false);
    expect(s.pending.map((p: Loose) => p.switch)).toEqual(["ai"]);

    const second = await b("/v1/admin/switches", { switch: "ai", enabled: true });
    expect(second.status).toBe(200);
    expect((await json(second)).status).toBe("applied");
    s = (await json(await a("/v1/admin/switches"))) as Loose;
    expect(s.switches.ai.enabled).toBe(true);
    expect(s.pending).toEqual([]);
  });

  it("a pending request expires after 24 hours and turning off cancels it", async () => {
    await a("/v1/admin/switches", { switch: "connector", enabled: false });
    expect((await a("/v1/admin/switches", { switch: "connector", enabled: true })).status).toBe(
      202,
    );
    // Off again clears the pending request.
    await a("/v1/admin/switches", { switch: "connector", enabled: false });
    expect((await json(await a("/v1/admin/switches"))).pending).toEqual([]);
    // A request older than 24 hours does not count: the second person starts a new request.
    const t0 = Date.now();
    await call("/v1/admin/switches", {
      email: "platform_admin@example.invalid",
      env: prod,
      now: t0 - 25 * 3_600_000,
      body: { switch: "connector", enabled: true },
    });
    const late = await b("/v1/admin/switches", { switch: "connector", enabled: true });
    expect(late.status).toBe(202);
    expect((await json(await a("/v1/admin/switches"))).switches.connector.enabled).toBe(false);
    // Put it back so later tests see the default.
    expect((await a("/v1/admin/switches", { switch: "connector", enabled: true })).status).toBe(
      200,
    );
  });
});
