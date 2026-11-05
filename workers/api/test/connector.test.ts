import { beforeAll, describe, expect, it } from "vitest";
import {
  type InternalPrincipal,
  signInternalRequest,
  verifyInternalRequest,
} from "../src/internal-auth.ts";
import { ALPHA, as, call, json, type Loose, seed } from "./helpers.ts";

const KEY = "test-connector-hmac-key-0123456789abcdef";
const ORIGIN = "https://secondary.example.test";
const SOURCE = "srcbid01";
const hex = (n: number) => n.toString(16).padStart(24, "0");
const id = (n: number) => `src:${SOURCE}:${hex(n)}`;

const connectorPrincipal: InternalPrincipal = {
  v: 1,
  iss: "secondary-mcp",
  grant_id: "g_test",
  aud: "secondary-api",
  sub: "secondary-connector",
  email: "connector@service.invalid",
  client_id: "secondary-connector",
  scope: [],
  tool: "connector.sync",
};

/** A request from the connector to the api, signed like workers/connector signs it. */
async function fromConnector(
  path: string,
  body: unknown,
  o: { key?: string; principal?: InternalPrincipal } = {},
) {
  const raw = JSON.stringify(body);
  const headers = await signInternalRequest({
    secret: o.key ?? KEY,
    method: "POST",
    url: `${ORIGIN}${path}`,
    body: raw,
    principal: o.principal ?? connectorPrincipal,
  });
  return call(path, { token: null, headers, rawBody: raw, method: "POST" });
}

const item = (n: number, over: Record<string, unknown> = {}) => ({
  id: id(n),
  title: `Pricing playbook ${n}`,
  body: `Quarterly pricing guardrails marker${n} for bids`,
  webUrl: `https://contoso.example.invalid/sites/bid/doc${n}.md`,
  mime: "text/markdown",
  size: 60,
  eTag: `"e${n},1"`,
  syncedAt: 1_700_000_000_000,
  ...over,
});

const upsert = (items: unknown[], over: Record<string, unknown> = {}) =>
  fromConnector("/internal/connector/upsert", {
    tenantId: ALPHA,
    sourceId: SOURCE,
    scopeId: "c_bid",
    gateNodeId: "c_bid",
    plane: "TEAM_RESTRICTED",
    items,
    ...over,
  });

/** A stand-in connector. `allow` decides per user email and item id. */
function connectorStub(allow: (email: string, itemId: string) => boolean) {
  const calls: { sub: string; email: string; itemIds: string[] }[] = [];
  return {
    calls,
    env: {
      CONNECTOR: {
        fetch: async (url: string, init: RequestInit) => {
          const req = new Request(url, init);
          const v = await verifyInternalRequest(req, KEY);
          if (!v.ok) return Response.json({ error: "unauthorized" }, { status: 401 });
          const { itemIds } = (await req.json()) as { itemIds: string[] };
          calls.push({ sub: v.principal.sub, email: v.principal.email, itemIds });
          return Response.json({
            results: Object.fromEntries(
              itemIds.map((i) => [
                i,
                allow(v.principal.email, i)
                  ? { allowed: true }
                  : { allowed: false, reason: "source permission could not be confirmed" },
              ]),
            ),
          });
        },
      },
    },
  };
}

const search = (persona: string, q: string, env?: Record<string, unknown>) =>
  as(persona, `/v1/search?q=${encodeURIComponent(q)}`, { env });
const ids = (j: Loose) => (j.results as { id: string }[]).map((r) => r.id);

beforeAll(async () => {
  await seed();
});

describe("connector -> api writes", () => {
  it("refuses unsigned, wrong-key and wrong-principal calls", async () => {
    expect((await call("/internal/connector/upsert", { token: null, body: {} })).status).toBe(401);
    const wrongKey = await fromConnector(
      "/internal/connector/upsert",
      {},
      { key: "wrong-key-0123456789abcdef0123456789" },
    );
    expect(wrongKey.status).toBe(401);
    // The MCP worker signs with the same helper; it is not the connector.
    const mcp = await fromConnector(
      "/internal/connector/upsert",
      {},
      { principal: { ...connectorPrincipal, sub: "u1", client_id: "claude" } },
    );
    expect(mcp.status).toBe(401);
  });

  it("validates items and is idempotent per eTag", async () => {
    for (const bad of [
      item(2, { webUrl: "http://plain.example.invalid/x" }),
      item(2, { body: "x".repeat(32_001) }),
      item(2, { id: "src:other_source:000000000000000000000002" }),
      item(2, { title: "" }),
    ])
      expect((await upsert([bad])).status).toBe(400);
    expect(await json(await upsert([item(2)]))).toMatchObject({ changed: 1 });
    expect(await json(await upsert([item(2)]))).toMatchObject({ changed: 0 });
    expect(await json(await upsert([item(2, { eTag: '"e2,2"' })]))).toMatchObject({ changed: 1 });
  });
});

describe("read path: search and open", () => {
  beforeAll(async () => {
    await upsert([item(10), item(11)]);
  });

  it("an allowed user finds the file by title and body; the connector sees the user, not a token", async () => {
    const stub = connectorStub(() => true);
    const r = await json(await search("head_bid", "marker10", stub.env));
    expect(ids(r)).toEqual([id(10)]);
    expect(r.results[0]).toMatchObject({ kind: "source", plane: "TEAM_RESTRICTED" });
    expect(stub.calls[0]).toMatchObject({ email: "head_bid@example.invalid" });
    expect(stub.calls[0]?.sub).toMatch(/^u_head_bid/);
  });

  it("source permission revoked: the item is hidden on the next read (search and open)", async () => {
    let revoked = false;
    const stub = connectorStub((_e, i) => !(revoked && i === id(10)));
    expect(ids(await json(await search("head_bid", "marker10", stub.env)))).toEqual([id(10)]);
    expect((await as("head_bid", `/v1/sources/${id(10)}`, { env: stub.env })).status).toBe(200);
    revoked = true;
    expect(ids(await json(await search("head_bid", "marker10", stub.env)))).toEqual([]);
    const open = await as("head_bid", `/v1/sources/${id(10)}`, { env: stub.env });
    expect(open.status).toBe(403);
    expect(await json(open)).toEqual({
      error: "forbidden",
      reason: "source permission could not be confirmed",
    });
  });

  it("fails closed when the connector is down, errors, lies, or is not bound", async () => {
    const broken: Record<string, unknown>[] = [
      {
        CONNECTOR: {
          fetch: async () => {
            throw new Error("down");
          },
        },
      },
      { CONNECTOR: { fetch: async () => Response.json({ error: "x" }, { status: 500 }) } },
      { CONNECTOR: { fetch: async () => new Response("not json", { status: 200 }) } },
      {
        CONNECTOR: {
          fetch: async () => Response.json({ results: { [id(10)]: { allowed: "yes" } } }),
        },
      },
      { CONNECTOR: { fetch: async () => Response.json({ results: {} }) } },
      { CONNECTOR: undefined },
      { CONNECTOR_HMAC_KEY: undefined, ...connectorStub(() => true).env },
    ];
    for (const env of broken) {
      expect(ids(await json(await search("head_bid", "marker10", env)))).toEqual([]);
      expect((await as("head_bid", `/v1/sources/${id(10)}`, { env })).status).toBe(403);
    }
  });

  it("a caller without content access to the gate node never reaches the connector", async () => {
    const stub = connectorStub(() => true);
    expect(ids(await json(await search("consultant", "marker10", stub.env)))).toEqual([]);
    expect((await as("consultant", `/v1/sources/${id(10)}`, { env: stub.env })).status).toBe(404);
    expect(stub.calls).toEqual([]);
  });

  it("body is returned only by the open call, never by search", async () => {
    const stub = connectorStub(() => true);
    const r = await json(await search("head_bid", "marker11", stub.env));
    expect(JSON.stringify(r)).not.toContain("guardrails");
    const open = await json(await as("head_bid", `/v1/sources/${id(11)}`, { env: stub.env }));
    expect(open.body).toContain("guardrails");
  });
});

describe("deletion propagation", () => {
  it("a deleted source file leaves the Workspace and search", async () => {
    await upsert([item(20), item(21)]);
    const stub = connectorStub(() => true);
    expect(ids(await json(await search("head_bid", "marker20", stub.env)))).toEqual([id(20)]);
    const del = await fromConnector("/internal/connector/delete", {
      tenantId: ALPHA,
      scopeId: "c_bid",
      ids: [id(20)],
    });
    expect(await json(del)).toMatchObject({ removed: 1 });
    expect(ids(await json(await search("head_bid", "marker20", stub.env)))).toEqual([]);
    expect((await as("head_bid", `/v1/sources/${id(20)}`, { env: stub.env })).status).toBe(404);
    // The sibling stays; deleting again is a no-op.
    expect(ids(await json(await search("head_bid", "marker21", stub.env)))).toEqual([id(21)]);
    expect(
      await json(
        await fromConnector("/internal/connector/delete", {
          tenantId: ALPHA,
          scopeId: "c_bid",
          ids: [id(20)],
        }),
      ),
    ).toMatchObject({ removed: 0 });
  });

  it("purge removes everything one source wrote", async () => {
    await upsert([item(30), item(31)]);
    const stub = connectorStub(() => true);
    const purge = await fromConnector("/internal/connector/purge", {
      tenantId: ALPHA,
      scopeId: "c_bid",
      sourceId: SOURCE,
    });
    expect((await json(purge)).removed).toBeGreaterThanOrEqual(2);
    expect(ids(await json(await search("head_bid", "marker30", stub.env)))).toEqual([]);
    expect(ids(await json(await search("head_bid", "marker31", stub.env)))).toEqual([]);
  });
});

describe("M-04: the connector kill switch stops source reads", () => {
  const setConnector = (enabled: boolean) =>
    as("platform_admin", "/v1/admin/switches", { body: { switch: "connector", enabled } });

  it("search hides source hits and /v1/sources/:id answers 503 while the switch is off", async () => {
    await upsert([item(40)]);
    const stub = connectorStub(() => true);
    expect(ids(await json(await search("head_bid", "marker40", stub.env)))).toEqual([id(40)]);
    expect((await setConnector(false)).status).toBe(200);
    try {
      expect(ids(await json(await search("head_bid", "marker40", stub.env)))).toEqual([]);
      const open = await as("head_bid", `/v1/sources/${id(40)}`, { env: stub.env });
      expect(open.status).toBe(503);
      expect(await json(open)).toEqual({ error: "switched_off", switch: "connector" });
    } finally {
      expect((await setConnector(true)).status).toBe(200);
    }
    expect((await as("head_bid", `/v1/sources/${id(40)}`, { env: stub.env })).status).toBe(200);
  });
});
