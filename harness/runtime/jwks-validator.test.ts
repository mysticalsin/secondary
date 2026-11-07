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

test("a labelled cache clock expires the JWKS cache without expiring the JWT", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const other = await generateKeyPair("RS256", { extractable: true });
  const keyA = await exportJWK(publicKey);
  keyA.alg = "RS256";
  keyA.use = "sig";
  keyA.kid = "kid-a";
  const keyB = await exportJWK(other.publicKey);
  keyB.alg = "RS256";
  keyB.use = "sig";
  keyB.kid = "kid-b";
  const env = {
    AUTH_ISSUER: "https://issuer.test",
    AUTH_JWKS_URL: "http://127.0.0.1/jwks",
    AUTH_ALLOW_LOOPBACK_JWKS: "local-test",
  };
  const clock = Date.now();
  const sign = (key, kid, claims = {}) => new SignJWT({ email: "ada@tenant-a.test", ...claims })
    .setProtectedHeader({ alg: "RS256", kid })
    .setIssuer("https://issuer.test")
    .setAudience("aud-browser")
    .setSubject("sub-ada")
    .setNotBefore(Math.floor(clock / 1000) - 10)
    .setExpirationTime(Math.floor(clock / 1000) + 600)
    .sign(key);
  const tokenA = await sign(privateKey, "kid-a");
  const tokenB = await sign(other.privateKey, "kid-b");
  let keys = [keyA, keyB];
  let mode = "ok";
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (mode === "outage") return new Response("unavailable", { status: 503 });
    if (mode === "private") return new Response(JSON.stringify({ keys: [{ ...keyA, d: "not-a-private-key" }] }), { status: 200 });
    if (mode === "duplicate") return new Response(JSON.stringify({ keys: [keyA, { ...keyA }] }), { status: 200 });
    if (mode === "oversize") return new Response(JSON.stringify({ keys: [keyA, keyA, keyA, keyA, keyA] }), { status: 200 });
    return new Response(JSON.stringify({ keys }), { status: 200, headers: { "cache-control": "max-age=1" } });
  };
  resetJwksCache();
  assert.equal((await verifyRemoteJwt(tokenA, env, "aud-browser", fetchImpl, clock)).ok, true);
  mode = "outage";
  assert.equal((await verifyRemoteJwt(tokenA, env, "aud-browser", fetchImpl, clock + 500)).ok, true);
  assert.equal(calls, 1);
  const stale = await verifyRemoteJwt(tokenA, env, "aud-browser", fetchImpl, clock + 1500);
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, "jwks_unavailable");
  mode = "private";
  assert.equal((await verifyRemoteJwt(tokenA, env, "aud-browser", fetchImpl, clock + 1500)).reason, "jwks_unavailable");
  mode = "duplicate";
  assert.equal((await verifyRemoteJwt(tokenA, env, "aud-browser", fetchImpl, clock + 1500)).reason, "jwks_unavailable");
  mode = "oversize";
  assert.equal((await verifyRemoteJwt(tokenA, env, "aud-browser", fetchImpl, clock + 1500)).reason, "jwks_unavailable");
  mode = "ok";
  keys = [keyB];
  assert.equal((await verifyRemoteJwt(tokenA, env, "aud-browser", fetchImpl, clock + 1500)).reason, "unknown_kid");
  assert.equal((await verifyRemoteJwt(tokenB, env, "aud-browser", fetchImpl, clock + 1500)).ok, true);
  const none = `${Buffer.from(JSON.stringify({ alg: "none", kid: "kid-b" })).toString("base64url")}.${Buffer.from(JSON.stringify({ iss: "https://issuer.test", aud: "aud-browser", sub: "sub-ada", email: "ada@tenant-a.test", exp: Math.floor(clock / 1000) + 600, nbf: Math.floor(clock / 1000) - 10 })).toString("base64url")}.`;
  assert.equal((await verifyRemoteJwt(none, env, "aud-browser", fetchImpl, clock + 1500)).reason, "invalid_token");
  const missingExp = await new SignJWT({ email: "ada@tenant-a.test" })
    .setProtectedHeader({ alg: "RS256", kid: "kid-b" })
    .setIssuer("https://issuer.test")
    .setAudience("aud-browser")
    .setSubject("sub-ada")
    .setNotBefore(Math.floor(clock / 1000) - 10)
    .sign(other.privateKey);
  assert.equal((await verifyRemoteJwt(missingExp, env, "aud-browser", fetchImpl, clock + 1500)).reason, "invalid_token");
  const badEmail = await sign(other.privateKey, "kid-b", { email: "not-an-email" });
  assert.equal((await verifyRemoteJwt(badEmail, env, "aud-browser", fetchImpl, clock + 1500)).reason, "invalid_token");
  const numericEmail = await sign(other.privateKey, "kid-b", { email: 12 });
  assert.equal((await verifyRemoteJwt(numericEmail, env, "aud-browser", fetchImpl, clock + 1500)).reason, "invalid_token");
});
