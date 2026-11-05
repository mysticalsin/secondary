// L-01 (key id and nonce replay cache on every signed service call) and M-01 (the ops key is its own
// secret, never held by the MCP worker), as seen from the API.

import { beforeAll, describe, expect, it } from "vitest";
import { signOpsRequest, verifyOpsRequest } from "../../../packages/contracts/src/ops-auth.ts";
import type { ReplayStore } from "../../../packages/contracts/src/signed-call.ts";
import {
  HEADER_KID,
  HEADER_NONCE,
  type InternalPrincipal,
  signInternalRequest,
  verifyInternalRequest,
} from "../src/internal-auth.ts";
import { call, json, rawEnv, seed } from "./helpers.ts";

const INTERNAL = (rawEnv as unknown as Env).INTERNAL_HMAC_KEY as string;
const OPS = (rawEnv as unknown as Env).OPS_HMAC_KEY as string;
const CONNECTOR = (rawEnv as unknown as Env).CONNECTOR_HMAC_KEY as string;
const ORIGIN = "https://secondary.example.test";

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

const memory = (): ReplayStore => {
  const seen = new Set<string>();
  return {
    first: async (k) => {
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    },
  };
};

const signed = async (o: { secret?: string; kid?: string; path?: string } = {}) => {
  const url = `${ORIGIN}${o.path ?? "/v1/me"}`;
  const headers = await signInternalRequest({
    secret: o.secret ?? INTERNAL,
    ...(o.kid ? { kid: o.kid } : {}),
    method: "GET",
    url,
    principal,
  });
  return new Request(url, { headers });
};

beforeAll(async () => {
  await seed();
});

describe("L-01: key id and nonce on internal calls (unit)", () => {
  it("every signed call carries a key id and a fresh nonce", async () => {
    const a = await signed();
    const b = await signed();
    expect(a.headers.get(HEADER_KID)).toBe("k1");
    expect(a.headers.get(HEADER_NONCE)).not.toBe(b.headers.get(HEADER_NONCE));
  });

  it("accepts once and refuses an identical replay inside the window", async () => {
    const replay = memory();
    const req = await signed();
    expect((await verifyInternalRequest(req.clone(), INTERNAL, { replay })).ok).toBe(true);
    expect(await verifyInternalRequest(req.clone(), INTERNAL, { replay })).toEqual({
      ok: false,
      reason: "replayed",
    });
  });

  it("an invalid signature never spends a nonce", async () => {
    const replay = memory();
    const bad = await signed({ secret: `${INTERNAL}x` });
    expect((await verifyInternalRequest(bad.clone(), INTERNAL, { replay })).ok).toBe(false);
    const good = new Request(bad.url, { headers: (await signed()).headers });
    expect((await verifyInternalRequest(good, INTERNAL, { replay })).ok).toBe(true);
  });

  it("rotation: a ring holds the current and the previous key, an unknown key id is refused", async () => {
    const OLD = "old-internal-hmac-key-0123456789abcdef0123";
    const ring = { k2: INTERNAL, k1: OLD };
    // A sender still on the old key (id k1) and one on the new key (id k2) both verify.
    expect((await verifyInternalRequest(await signed({ secret: OLD }), ring)).ok).toBe(true);
    expect(
      (await verifyInternalRequest(await signed({ secret: INTERNAL, kid: "k2" }), ring)).ok,
    ).toBe(true);
    // A kid that is not in the ring is refused, and so is a kid paired with the wrong secret.
    expect(await verifyInternalRequest(await signed({ kid: "k9" }), ring)).toEqual({
      ok: false,
      reason: "unknown_kid",
    });
    expect((await verifyInternalRequest(await signed({ secret: OLD, kid: "k2" }), ring)).ok).toBe(
      false,
    );
  });

  it("a request without a key id or a nonce is refused", async () => {
    for (const drop of [HEADER_KID, HEADER_NONCE]) {
      const r = await signed();
      const h = new Headers(r.headers);
      h.delete(drop);
      expect((await verifyInternalRequest(new Request(r.url, { headers: h }), INTERNAL)).ok).toBe(
        false,
      );
    }
  });

  it("the nonce and key id are signed: swapping the nonce breaks the signature", async () => {
    const r = await signed();
    const h = new Headers(r.headers);
    h.set(HEADER_NONCE, "AAAAAAAAAAAAAAAAAAAAAA");
    expect(await verifyInternalRequest(new Request(r.url, { headers: h }), INTERNAL)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });
});

describe("L-01: replay on each channel into the API", () => {
  it("MCP: the same signed request is accepted once", async () => {
    const r = await signed();
    const send = () =>
      call("/v1/me", { token: null, headers: Object.fromEntries(r.headers.entries()) });
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(401);
  });

  it("connector: the same signed request is accepted once", async () => {
    const url = `${ORIGIN}/internal/connector/purge`;
    const body = JSON.stringify({ tenantId: "tenant_mantu_synthetic", sourceId: "srcnone01" });
    const headers = await signInternalRequest({
      secret: CONNECTOR,
      method: "POST",
      url,
      body,
      principal: {
        ...principal,
        sub: "secondary-connector",
        client_id: "secondary-connector",
        email: "connector@service.invalid",
      },
    });
    const send = () =>
      call("/internal/connector/purge", { token: null, headers, rawBody: body, method: "POST" });
    expect((await send()).status).not.toBe(401);
    expect((await send()).status).toBe(401);
  });

  it("ops: the same signed request is accepted once", async () => {
    const url = `${ORIGIN}/v1/internal/ops/targets`;
    const headers = await signOpsRequest({ secret: OPS, method: "GET", url });
    const send = () => call("/v1/internal/ops/targets", { token: null, headers });
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(401);
  });

  it("ops verifier: replay and an unknown key id fail", async () => {
    const replay = memory();
    const url = `${ORIGIN}/x`;
    const req = new Request(url, {
      headers: await signOpsRequest({ secret: OPS, method: "GET", url }),
    });
    expect(await verifyOpsRequest(req.clone(), OPS, { replay })).toBe(true);
    expect(await verifyOpsRequest(req.clone(), OPS, { replay })).toBe(false);
    const other = new Request(url, {
      headers: await signOpsRequest({ secret: OPS, kid: "k7", method: "GET", url }),
    });
    expect(await verifyOpsRequest(other, OPS)).toBe(false);
    expect(await verifyOpsRequest(other.clone(), { k7: OPS })).toBe(true);
  });
});

describe("M-01: the MCP key cannot reach the ops routes", () => {
  const sendOps = async (secret: string, path: string, method = "GET") => {
    const url = `${ORIGIN}${path}`;
    const headers = await signOpsRequest({ secret, method, url });
    return call(path, { token: null, headers, method });
  };

  it("a request signed with INTERNAL_HMAC_KEY is refused by every /v1/internal/ops route", async () => {
    for (const [p, m] of [
      ["/v1/internal/ops/targets", "GET"],
      [`/v1/internal/ops/export?tenant=tenant_mantu_synthetic&kind=tenant`, "GET"],
      [`/v1/internal/ops/restore?tenant=tenant_mantu_synthetic&kind=tenant`, "POST"],
      ["/v1/internal/ops/retention", "POST"],
    ] as const)
      expect((await sendOps(INTERNAL, p, m)).status, p).toBe(401);
    expect((await sendOps(OPS, "/v1/internal/ops/targets")).status).toBe(200);
  });

  it("the MCP kill switch pre-check has its own read-only route that the ops key cannot use", async () => {
    const path = "/v1/internal/mcp/switches?tenant=tenant_mantu_synthetic";
    const ok = await sendOps(INTERNAL, path);
    expect(ok.status).toBe(200);
    expect((await json(ok)).switches).toMatchObject({ mcp: true });
    expect((await sendOps(OPS, path)).status).toBe(401);
    // The old location is gone for the MCP key.
    expect(
      (await sendOps(INTERNAL, "/v1/internal/ops/switches?tenant=tenant_mantu_synthetic")).status,
    ).toBe(401);
  });
});
