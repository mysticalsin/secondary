# Mantu Home ac41dfec: signed-out `GET /` returns 503 `auth_unconfigured`, but the script expects 401

## Status as of ad04f08

This note and the Historical markers are the only additions. The classification text is otherwise unchanged. It describes the ac41dfec home bundle, not `src/worker` on this commit.

That bundle's `worker/entry.js` answered 503 `auth_unconfigured` when issuer and audience were empty, before it looked at a session. Current `src/worker` has no `auth_unconfigured` guard and does not read `AUTH_ISSUER` or `AUTH_AUDIENCE`. `GET /` is the static shell. An API request with no Access token is 401 `{ error: "unauthorized" }`. A missing Access team domain or audience makes `verifyAccessJwt` return null, which is the same 401.

`docs/auth/mantu-503-repro.mjs` still drives `<bundle>/worker/entry.js`. `npm test` runs only `harness/tests/*.test.ts` and `harness/runtime/*.test.ts`. Neither typecheck includes `docs/`. The script is not part of the gates, and it was not rewritten to call `createApp`.

Classified by Devin (senior engineer), 2026-11-09 ~01:00 BRT (America/Sao_Paulo). I only read files and ran a box-local repro. I made no repo writes, used no real credentials and made no network calls.

## Verdict: a script expectation error combined with a harness gap. It is NOT a product defect.

The 503 is the guard doing what it was designed to do. The harness started the worker with the config that ships in `wrangler.jsonc`, where issuer and audience are empty. In that state the worker refuses every request before it looks at any session. Q09's 401 expectation only holds when auth is configured. The runner cannot produce "configured auth with no token" today: when a persona is set it injects a bearer, and when no persona is set auth is unconfigured.

## Evidence (exact tested artifact: bundle `worker/entry.js` sha256 ee70dc46…cedb, which matches MANIFEST.sha256 line 41)
- `worker/wrangler.jsonc` vars (sha256 5d8affa1…d1f6, MANIFEST line 42) are `RELEASE_MODE=protected-dev`, `AUTH_ISSUER=""`, `AUTH_AUDIENCE=""`, with no `AUTH_JWKS_URL` and no `LOCAL_JWKS`.
- `start.mjs:68-76` `baseEnv()` mirrors that config when `QA_PERSONA` is unset. This is the ":43133 persona none" run.
- `worker/entry.js:2127-2134` `configured(env)` is false unless issuer and audience are set and exactly one of `AUTH_JWKS_URL` / `LOCAL_JWKS` is set.
- Guard order in `worker/entry.js` `fetch`:
  - `:2271` `if (!configured(env)) return text("auth_unconfigured\n", 503);` runs FIRST, for every non-asset and non-MCP route.
  - `:2276` `identity()` runs only after that, and `presentedToken` (`:~840`) returns `reason:"unauthorized"` when there is no bearer, CF-Access assertion or CF_Authorization cookie.
  - `:2278` maps the reason to a status: `auth_unconfigured` / `jwks_unavailable` / `jwks_redirect` give 503, `tenant_not_admitted` gives 403, and everything else (including `unauthorized` and `invalid_token`) gives 401.
- So yes, a request with no identity hits the config check before the session check. This is deliberate fail-closed ordering. The ordering is the same in the nearest source copies on the box (not bound to ac41dfec):
  - `/workspace/run72-bodies-bru473cn/bodies/reconstruction/release/entry.ts:94` (configured), `:243` (503 guard), `:248` (identity), `:250` (status map).
  - `/workspace/relay-review-sb-e15589d/post/reconstruction/release/entry.ts:83/276/281/283`.
  - I found no git checkout of ac41dfec on the box, so I cited lines from the bundle.
- Where the script's 401 comes from: Q09 (`HOME-AC41DFEC-QA-SCRIPT.md:194-204`) cites Run76 `GET / without a token is 401`. That check is `/workspace/run69-static-ce0tp4z8/evidence/harness/root.mjs:74`, and it runs with a CONFIGURED env (`root.mjs:37-41`: `AUTH_ISSUER https://issuer.synthetic.test`, `LOCAL_JWKS` set). The expectation therefore assumes configured issuer and audience. Q09's own note even says "503/403 only for specific auth-config/tenant reasons".
- The bundle README already documents `GET /` → 503 `auth_unconfigured` for the default runner ("Empty issuer and audience fail closed before the shell is returned").
- The bad-bearer receipt (`receipts/persona-a-bad-bearer-root.txt`, 401) was captured under the persona env, which is configured. It is not the same state as the no-identity run.

## Box repro (`/workspace/senior-eng/mantu-503-repro.mjs`, Node 24, in-memory throwaway RSA public key, fake bindings, no network)
```
node /workspace/senior-eng/mantu-503-repro.mjs /workspace/mantu-second-brain-staging/home-premerge-qa/run/home-ac41dfec-qa-bundle
unconfigured (wrangler.jsonc vars) | no identity | GET / -> 503 auth_unconfigured
unconfigured (wrangler.jsonc vars) | bad bearer  | GET / -> 503 auth_unconfigured
configured LOCAL_JWKS             | no identity | GET / -> 401 unauthorized
configured LOCAL_JWKS             | bad bearer  | GET / -> 401 invalid_token
configured remote AUTH_JWKS_URL    | no identity | GET / -> 401 unauthorized   (JWKS is never fetched without a token)
```
A correctly configured deploy, using either the local or the remote JWKS path, returns **401 `unauthorized`** to a user with no identity. That is the product behavior Q09 wants.

Historical: describes the ac41dfec bundle only, not current main.

## Fixes (no ac41dfec product change needed)
1. **Harness:** the owner is the bundle builder (bc-97be2a5b, build-only) or the Mantu QA owner. Add a signed-out-but-configured mode to `start.mjs`, for example `QA_SIGNED_OUT=1`. It would use `personaEnv(...)` (issuer, audience, public-only `LOCAL_JWKS`) and skip bearer injection at `start.mjs:229` (`if (token && !presented(headers)) ...`). Add a receipt `signed-out-configured-root.txt` that expects 401 `unauthorized`. This is a harness-only change, so the worker bytes stay unchanged.
2. **Script:** the owner is the Mantu QA script author. Amend Q09:
   - Precondition: run in the configured signed-out mode, and expect `401 unauthorized`.
   - Add Q09b: with the default unconfigured runner, expect `503 auth_unconfigured` for both no-identity and bad-bearer requests. This documents the fail-closed behavior.
   - Re-hash the script, because sha256 9534840a… changes.
3. **Regression tests:** the owner is the Mantu writer, on its existing branch, as the next batched fix. This is optional because the behavior is already correct. Add to the release harness (next to `root.mjs:74`):
   - unconfigured env with no token gives 503 `auth_unconfigured`;
   - unconfigured env with a bad bearer gives 503, which pins config-before-session;
   - configured env with no token gives 401 `unauthorized`, which exists today;
   - configured env with a bad bearer gives 401 `invalid_token`.
Historical: describes the ac41dfec bundle only, not current main.

4. **Product note:** this is informational, not a defect. The shipped `wrangler.jsonc` has empty issuer and audience, so a deploy that does not supply vars or secrets would return 503 to all users. That is safe, because it fails closed and exposes no shell. The file says it is local-only and that `npm run deploy` does not upload it. Before any real deploy, the deploy gate must check that the issuer, audience and JWKS vars are set.

## Separate blocker (the main reason the hands-on gate did not run)
Hands-on Q01–Q15 were NOT RUN because the box Chrome managed policy `/etc/opt/chrome/policies/managed/zz-sand-loopback-network.json` sets `LoopbackNetworkBlockedForUrls ["*"]`. Atlas hit the same block. This is a platform-wide blocker for box-loopback hands-on Q&A and is not related to the 503.
