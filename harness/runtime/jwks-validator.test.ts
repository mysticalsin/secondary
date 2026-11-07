import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { PRODUCTION_ISSUER, PRODUCTION_JWKS_URL, admittedTenant, boundedMaxAge, resetJwksCache, resolveJwksTarget, verifyRemoteJwt } from "../../reconstruction/release/jwks-validator.mjs";

test("remote JWKS checks are allowlisted, bounded, and fail closed", async () => {
  assert.equal(boundedMaxAge("public, max-age=999999"), 14400);
  assert.equal(boundedMaxAge("max-age=30"), 30);
  assert.equal(boundedMaxAge(""), 60);
  assert.throws(() => resolveJwksTarget({ AUTH_ISSUER: PRODUCTION_ISSUER, AUTH_JWKS_URL: "https://evil.invalid/jwks" }), /not_allowlisted/);
  assert.throws(() => resolveJwksTarget({ AUTH_ISSUER: "https://issuer.test", AUTH_JWKS_URL: "http://127.0.0.1/jwks" }), /not_allowlisted/);
  assert.equal(resolveJwksTarget({
    AUTH_ISSUER: "https://issuer.test",
    AUTH_JWKS_URL: "http://127.0.0.1/jwks",
    AUTH_ALLOW_LOOPBACK_JWKS: "local-test",
  }).url, "http://127.0.0.1/jwks");
  assert.equal(resolveJwksTarget({ AUTH_ISSUER: PRODUCTION_ISSUER, AUTH_JWKS_URL: PRODUCTION_JWKS_URL }).url, PRODUCTION_JWKS_URL);
  assert.equal(admittedTenant("ada@tenant-a.test", '{"tenant-a.test":"tenant_alpha"}'), "tenant_alpha");
  assert.equal(admittedTenant("ceo@tenant-a.test", "{}"), null);
  assert.equal(admittedTenant("ada@unknown.test", '{"tenant-a.test":"tenant_alpha"}'), null);

  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = await exportJWK(publicKey);
  jwk.alg = "RS256";
  jwk.use = "sig";
  jwk.kid = "kid-a";
  const env = {
    AUTH_ISSUER: "https://issuer.test",
    AUTH_JWKS_URL: "http://127.0.0.1/jwks",
    AUTH_ALLOW_LOOPBACK_JWKS: "local-test",
  };
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 2) return new Response(null, { status: 302, headers: { location: "https://evil.invalid/jwks" } });
    return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { "cache-control": "max-age=0" } });
  };
  resetJwksCache();
  const now = Date.now();
  const token = await new SignJWT({ email: "ada@tenant-a.test" })
    .setProtectedHeader({ alg: "RS256", kid: "kid-a" })
    .setIssuer("https://issuer.test")
    .setAudience("aud-browser")
    .setSubject("sub-ada")
    .setNotBefore(Math.floor(now / 1000) - 10)
    .setExpirationTime(Math.floor(now / 1000) + 600)
    .sign(privateKey);
  const ok = await verifyRemoteJwt(token, env, "aud-browser", fetchImpl, now);
  assert.equal(ok.ok, true);
  const redirected = await verifyRemoteJwt(token, env, "aud-browser", fetchImpl, now + 1000);
  assert.equal(redirected.ok, false);
  assert.equal(redirected.reason, "jwks_redirect");
  assert.equal(calls, 2);
  const wrangler = readFileSync("reconstruction/release/wrangler.jsonc", "utf8");
  assert.equal(wrangler.includes("AUTH_JWKS_URL"), false);
  assert.equal(wrangler.includes("LOCAL_JWKS"), false);
  assert.equal(wrangler.includes("LOCAL_DO_SHIM"), false);
  assert.equal(wrangler.includes("AUTH_ALLOW_LOOPBACK_JWKS"), false);
});
