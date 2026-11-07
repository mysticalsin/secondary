import assert from "node:assert/strict";
import { test } from "node:test";
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet, jwtVerify } from "jose";
import { ACCESS_ISSUER, ACCESS_JWKS_URL, API_ACCESS_AUD, MCP_ACCESS_AUD, assertAllowlistedJwksUrl, loadAllowlistedJwks } from "../../reconstruction/release/access-facts.mjs";
import { verifyReleaseJwt } from "../../reconstruction/release/identity.mjs";

test("API and MCP audiences stay distinct and a JWKS failure stays closed", async () => {
  assert.notEqual(API_ACCESS_AUD, MCP_ACCESS_AUD);
  assert.equal(ACCESS_JWKS_URL, `${ACCESS_ISSUER}/cdn-cgi/access/certs`);
  assert.throws(() => assertAllowlistedJwksUrl("https://example.invalid/jwks"), /not_allowlisted/);
  await assert.rejects(loadAllowlistedJwks(ACCESS_JWKS_URL, async () => { throw new Error("offline"); }), /jwks_unavailable/);
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = await exportJWK(publicKey);
  jwk.alg = "RS256";
  jwk.kid = "local-only";
  const token = await new SignJWT({ email: "ada@tenant-a.test" })
    .setProtectedHeader({ alg: "RS256", kid: "local-only" })
    .setIssuer(ACCESS_ISSUER)
    .setAudience(API_ACCESS_AUD)
    .setSubject("synthetic")
    .setExpirationTime("2m")
    .sign(privateKey);
  const keys = createLocalJWKSet({ keys: [jwk] });
  const api = await jwtVerify(token, keys, { issuer: ACCESS_ISSUER, audience: API_ACCESS_AUD, algorithms: ["RS256"] });
  assert.equal(api.payload.email, "ada@tenant-a.test");
  await assert.rejects(jwtVerify(token, keys, { issuer: ACCESS_ISSUER, audience: MCP_ACCESS_AUD, algorithms: ["RS256"] }));
  await assert.rejects(jwtVerify(token, keys, { issuer: "https://other.example", audience: API_ACCESS_AUD, algorithms: ["RS256"] }));
  const privateKeySet = await verifyReleaseJwt(token, {
    AUTH_ISSUER: ACCESS_ISSUER,
    AUTH_AUDIENCE: API_ACCESS_AUD,
    LOCAL_JWKS: JSON.stringify({ keys: [{ ...jwk, d: "not-a-private-key" }] }),
  });
  assert.equal(privateKeySet.ok, false);
  assert.equal(privateKeySet.reason, "auth_unconfigured");
  const unknownKid = await verifyReleaseJwt(token, {
    AUTH_ISSUER: ACCESS_ISSUER,
    AUTH_AUDIENCE: API_ACCESS_AUD,
    LOCAL_JWKS: JSON.stringify({ keys: [{ ...jwk, kid: "rotated-away" }] }),
  });
  assert.equal(unknownKid.ok, false);
  assert.equal(unknownKid.reason, "invalid_token");
});
