// Stand-ins for the two service bindings, running in the Vitest host process.
// The API stub verifies the internal HMAC exactly as workers/api must (shared helper), then answers
// with small synthetic payloads shaped like docs/API-CONTRACT.md. Synthetic data only.

import { parseReceipt } from "../../../packages/contracts/src/audit-receipt.ts";
import { verifyOpsRequest } from "../../../packages/contracts/src/ops-auth.ts";
import { type InternalPrincipal, verifyInternalRequest } from "../src/internal-auth.ts";

export const TEST_HMAC_KEY = "test-only-internal-hmac-key-0123456789abcdef";

interface Call {
  method: string;
  path: string;
  principal: InternalPrincipal | null;
  body: unknown;
  hasAuthorization: boolean;
}
const calls: Call[] = [];
export const TEST_AUDIT_KEY = "test-audit-key-mcp-0123456789abcdef0123";
const audit: Record<string, unknown>[] = [];
let auditDown = false;
let mcpSwitchOn = true;

const hub = (id: string, label: string, access: "full" | "partial" | "locked") => ({
  id,
  label,
  kind: "department",
  access,
  counts: access === "locked" ? null : { items: 12, topics: 4, open: 2, gaps: 1, stars: 3 },
  children: [],
});

const node = (id: string) => ({
  node: {
    id,
    label: id === "a_acme" ? "Acme" : "Pricing models",
    kind: id === "a_acme" ? "account" : "topic",
    plane: id === "a_acme" ? "ACCOUNT_RESTRICTED" : "TEAM_RESTRICTED",
    access: "full",
    counts: { items: 2, topics: 1, open: 1, gaps: 0, stars: 1 },
    freshnessDays: 9,
    signals: { open: true, star: false, gap: false },
    facts: { owner: "Bid desk" },
    badges: ["reviewed"],
    children: [
      {
        id: "c_bid:pricing-models:1",
        label: "Rate cards",
        kind: "topic",
        plane: "TEAM_RESTRICTED",
        access: "full",
        counts: { items: 5, open: 0, gaps: 1 },
        freshnessDays: 3,
      },
      {
        id: "c_bid:pricing-models:2",
        label: "Discount rules",
        kind: "topic",
        plane: "TEAM_RESTRICTED",
        access: "locked",
        counts: null,
        freshnessDays: null,
      },
    ],
  },
  items: [
    {
      title: "Rate card 2026",
      source: "synthetic",
      ownerRole: "Bid desk",
      revision: 3,
      evidence: "supported",
      plane: "TEAM_RESTRICTED",
      reviewedBy2: true,
    },
    {
      title: "Margin floor note",
      source: "synthetic",
      ownerRole: "Bid desk",
      revision: 1,
      evidence: "partial",
      plane: "TEAM_RESTRICTED",
      reviewedBy2: false,
    },
  ],
  backlinks: [],
  actions: [],
});

function route(method: string, path: string, query: URLSearchParams): Response {
  const j = (data: unknown, status = 200) => Response.json(data, { status });
  if (method === "GET") {
    if (path === "/v1/me") {
      return j({
        principal: { id: "u1", email: "alice@example.invalid", roleIds: ["consultant"] },
        persona: "consultant",
        describe: { see: ["x"], do: ["y"], never: ["z"] },
        env: "dev",
      });
    }
    if (path === "/v1/search") {
      return j({
        results: [
          {
            id: "c_bid:pricing-models",
            label: `Pricing models (${query.get("q")})`,
            kind: "topic",
            plane: "TEAM_RESTRICTED",
          },
        ],
      });
    }
    if (path === "/v1/map") {
      return j({
        lens: query.get("lens"),
        viewerScopeHash: "h",
        core: { id: "core", label: "Secondary", topicCount: 3 },
        hubs: [hub("d_bid", "Bid & Pre-sales", "full"), hub("d_hr", "People", "locked")],
        links: [],
      });
    }
    const m = /^\/v1\/(nodes|accounts)\/(.+)$/.exec(path);
    if (m?.[2]) {
      const id = decodeURIComponent(m[2]);
      if (id === "denied") return j({ reason: "not admitted" }, 403);
      if (id === "missing") return j({ reason: "not found" }, 404);
      if (m[1] === "accounts")
        return j({
          label: "Acme",
          sections: [
            { title: "Relationship", items: [{ title: "Exec sponsor" }, { title: "QBR cadence" }] },
            { title: "Use cases", count: 4, items: [] },
          ],
        });
      return j(node(id));
    }
    if (path === "/v1/governances") {
      return j({
        governances: [
          { id: "g1", label: "Data & AI", stages: { idea: 3, pilot: 2, scaled: 1 } },
          { id: "g2", label: "Cyber", stages: [{ stage: "idea", count: 1 }] },
        ],
      });
    }
    if (path === "/v1/review") return j({ candidates: [{ id: "cand1", title: "Pricing FAQ" }] });
  }
  if (method === "POST") {
    if (path === "/v1/personal/items") return j({ ok: true, id: "pb:u1:n1" });
    if (/^\/v1\/personal\/items\/[^/]+\/contribute$/.test(path))
      return j({ ok: true, receiptId: "r1" });
  }
  return j({ reason: "no such route" }, 404);
}

export async function apiStub(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/__calls") {
    if (request.method === "DELETE") calls.length = 0;
    return Response.json(calls);
  }
  // Kill switch state, as workers/api answers it to workers/mcp (signed with the ops scheme).
  if (url.pathname === "/__switch") {
    mcpSwitchOn = request.method !== "PUT";
    return Response.json({ mcpSwitchOn });
  }
  if (url.pathname === "/v1/internal/ops/switches") {
    if (!(await verifyOpsRequest(request, TEST_HMAC_KEY)))
      return Response.json({ error: "unauthorized" }, { status: 401 });
    return Response.json({
      switches: { mcp: mcpSwitchOn, connector: true, ai: true, contribute: true },
    });
  }
  const bodyText = await request.clone().text();
  const verified = await verifyInternalRequest(request, TEST_HMAC_KEY);
  if (!verified.ok) {
    calls.push({
      method: request.method,
      path: url.pathname,
      principal: null,
      body: { rejected: verified.reason },
      hasAuthorization: request.headers.has("authorization"),
    });
    return Response.json({ reason: verified.reason }, { status: 401 });
  }
  calls.push({
    method: request.method,
    path: url.pathname + url.search,
    principal: verified.principal,
    body: bodyText ? JSON.parse(bodyText) : null,
    hasAuthorization: request.headers.has("authorization"),
  });
  return route(request.method, url.pathname, url.searchParams);
}

export async function auditStub(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/events") {
    if (request.method === "DELETE") audit.length = 0;
    return Response.json(audit);
  }
  if (url.pathname === "/down") {
    auditDown = request.method === "PUT";
    return Response.json({ auditDown });
  }
  if (auditDown) return new Response("down", { status: 503 });
  // Behave like workers/audit: it needs the MCP append key and parses with the real shared parser,
  // so a receipt it would refuse (400) is refused here too.
  if (request.headers.get("x-audit-key") !== TEST_AUDIT_KEY)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  const receipt = parseReceipt(await request.json(), "mcp");
  if (!receipt) return Response.json({ error: "invalid_receipt" }, { status: 400 });
  audit.push(receipt as unknown as Record<string, unknown>);
  return Response.json({ ok: true }, { status: 202 });
}
