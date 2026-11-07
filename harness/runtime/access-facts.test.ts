import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet, jwtVerify } from "jose";
import { ACCESS_ISSUER, ACCESS_JWKS_URL, API_ACCESS_AUD, MCP_ACCESS_AUD, OBSERVED_PUBLIC_JWKS, assertAllowlistedJwksUrl, classifyPublicJwk, jwksCacheFresh, loadAllowlistedJwks } from "../../reconstruction/release/access-facts.mjs";
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

test("the observed public cert document is a format check, not an identity pin", () => {
  const bytes = readFileSync(new URL("../../reconstruction/release/observed-public-jwks.json", import.meta.url));
  assert.equal(bytes.length, OBSERVED_PUBLIC_JWKS.bytes);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), OBSERVED_PUBLIC_JWKS.sha256);
  const body = JSON.parse(bytes.toString("utf8"));
  assert.equal(body.keys.length, 2);
  assert.deepEqual(body.keys.map((key) => key.kid), OBSERVED_PUBLIC_JWKS.kids);
  for (const key of body.keys) {
    assert.equal(key.kty, "RSA");
    assert.equal(key.alg, "RS256");
    assert.equal(key.use, "sig");
    assert.equal(key.e, "AQAB");
    for (const name of ["d", "p", "q", "dp", "dq", "qi"]) assert.equal(Object.hasOwn(key, name), false);
  }
  const fetchedAt = Date.parse(OBSERVED_PUBLIC_JWKS.fetchedAt);
  assert.equal(jwksCacheFresh({
    fetchedAtMs: fetchedAt,
    nowMs: fetchedAt + 1000,
    maxAgeSeconds: OBSERVED_PUBLIC_JWKS.cache.maxAgeSeconds,
    mustRevalidate: true,
  }), true);
  assert.equal(jwksCacheFresh({
    fetchedAtMs: fetchedAt,
    nowMs: fetchedAt + 14400 * 1000,
    maxAgeSeconds: 14400,
    mustRevalidate: true,
  }), false);
  const keys = body.keys;
  assert.equal(classifyPublicJwk({ origin: ACCESS_JWKS_URL, keys, kid: keys[0].kid }).ok, true);
  assert.equal(classifyPublicJwk({ origin: ACCESS_JWKS_URL, keys, kid: "rotated-away" }).reason, "unknown_kid");
  assert.equal(classifyPublicJwk({ origin: "https://example.invalid/certs", keys, kid: keys[0].kid }).reason, "jwks_url_not_allowlisted");
  assert.equal(classifyPublicJwk({ origin: ACCESS_JWKS_URL, keys: [{ ...keys[0], d: "secret" }], kid: keys[0].kid }).reason, "private_key_field");
  const wrangler = readFileSync(new URL("../../reconstruction/release/wrangler.jsonc", import.meta.url), "utf8");
  assert.equal(wrangler.includes(keys[0].n), false);
  assert.equal(wrangler.includes('"AUTH_ISSUER": ""'), true);
  assert.equal(OBSERVED_PUBLIC_JWKS.identityAccepted, false);
});
