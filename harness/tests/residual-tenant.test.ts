import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const { openSqlite, sqliteStorage } = await import("../runtime/sqlite-storage.ts");

const CANDIDATE = "cand:c_delivery:abcd1234";
const AUTHOR = "u_consultant";

async function directory(file: string, tenantId: string, email: string) {
  const db = openSqlite(file);
  let ready: Promise<void> = Promise.resolve();
  const ctx = {
    storage: {
      sql: sqliteStorage(db),
      transactionSync<T>(fn: () => T): T {
        return fn();
      },
    },
    blockConcurrencyWhile(fn: () => Promise<void>) {
      ready = fn();
      return ready;
    },
  };
  const policyUrl = new URL("../../src/worker/tenant-policy.ts", import.meta.url).href;
  const Policy = (await import(policyUrl)).TenantPolicy;
  const object = new Policy(ctx, {});
  await ready;
  object.seed(
    { tenantId, seed: 20261104, personalOwners: [AUTHOR] },
    [
      {
        id: AUTHOR,
        email,
        roleIds: ["consultant"],
        memberships: [
          { scope_type: "circle", scope_id: "c_delivery" },
          { scope_type: "circle", scope_id: "c_eng" },
        ],
      },
    ],
    1_700_000_000_000,
  );
  return object;
}

test("a user of tenant B gets 404 for tenant A's candidate", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "residual-tenant-"));
  const home = await directory(path.join(dir, "a.sqlite"), "synthetic", "consultant@synthetic.example");
  const away = await directory(path.join(dir, "b.sqlite"), "other", "consultant@other.example");
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.alg = "RS256";
  const jwks = createLocalJWKSet({ keys: [jwk] });
  const token = async (email: string) =>
    new SignJWT({ email })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer("https://synthetic.example")
      .setAudience("synthetic-aud")
      .setIssuedAt()
      .setExpirationTime("2h")
      .sign(privateKey);
  const homeJwt = await token("consultant@synthetic.example");
  const awayJwt = await token("consultant@other.example");
  const binding = {
    jurisdiction() {
      return binding;
    },
    idFromName: (name: string) => name,
    get: (id: string) => {
      const key = String(id);
      if (key.startsWith("ws:")) {
        return {
          get: async (itemId: string) =>
            key.includes("synthetic:c_delivery") && itemId === CANDIDATE
              ? {
                  id: itemId,
                  kind: "candidate",
                  label: "Synthetic note",
                  body: "Plain note",
                  status: "candidate",
                  revision: 1,
                  authorId: AUTHOR,
                  updatedAt: 1,
                }
              : null,
        };
      }
      return key === "other" ? away : home;
    },
  };
  const appUrl = new URL("../../src/worker/index.ts", import.meta.url).href;
  const { createApp } = (await import(appUrl)) as {
    createApp: (deps: { jwks: () => unknown }) => {
      request: (input: string, init: RequestInit | undefined, env: unknown) => Promise<Response>;
    };
  };
  const api = createApp({ jwks: () => jwks });
  const env = {
    ENVIRONMENT: "dev",
    AUTH_MODE: "access",
    ACCESS_TEAM_DOMAIN: "synthetic.example",
    ACCESS_AUD: "synthetic-aud",
    DEFAULT_TENANT_ID: "synthetic",
    TENANT_DOMAINS: JSON.stringify({
      "synthetic.example": "synthetic",
      "other.example": "other",
    }),
    DO_JURISDICTION: "off",
    WIKI_SEED: "off",
    TENANT_POLICY: binding,
    WORKSPACE: {
      jurisdiction() {
        return this;
      },
      idFromName: (name: string) => `ws:${name}`,
      get: (id: string) => binding.get(id),
    },
  };
  try {
    const own = await api.request(
      `http://127.0.0.1/v1/ux/candidates/${CANDIDATE}`,
      { headers: { "Cf-Access-Jwt-Assertion": homeJwt } },
      env,
    );
    assert.equal(own.status, 200);
    const foreign = await api.request(
      `http://127.0.0.1/v1/ux/candidates/${CANDIDATE}`,
      { headers: { "Cf-Access-Jwt-Assertion": awayJwt } },
      env,
    );
    assert.equal(foreign.status, 404);
    assert.deepEqual(await foreign.json(), { error: "not_found" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
