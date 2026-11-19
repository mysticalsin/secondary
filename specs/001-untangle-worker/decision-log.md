# Decision log: Worker untangle audit

**Head audited**: `0644553837eb3ea8d49cddc8a0954d12a6cb5364`

**Scope**: `src/state` (the decision modules the Worker imports) and `recovered-source/worker/src` (the Worker). `src/` contains only `src/state`. The HTTP Worker is not under `src/`. Those two trees change together, so the audit covers both. No code was changed.

**Not in this pass**: comment deletion and test deletion. The untangle skill lists both as optional additions. Phase 1 stops before any refactor, so neither was done.

## Problems

### Hidden links

- `src/state/actor.ts` `normalEmail` / `asciiLower` is the identity fold, but callers still fold on their own. `recovered-source/worker/src/auth/identity-store.ts:622` and `:665` run `asciiLower(trim)` and then `normalEmail` again. `recovered-source/worker/src/routes.ts:210-214` folds an id with `asciiLower` and an email with `normalEmail` in the same check. `recovered-source/worker/src/wiki/review.ts:21` and `recovered-source/worker/src/wiki/store.ts:1483-1484` each fold ids with `asciiLower`. Change the fold and all of these must move, and nothing ties them.
- `recovered-source/worker/src/wiki/review.ts:19` hard-codes `LEAD_ROLES` to `acme_lead`. The grants that make that role a lead live in `packages/policy` `roles.ts` (`a_acme` review and manage, `c_sales` edit). Change the role table and this set does not follow.
- `recovered-source/worker/src/ops-admin.ts:60-64` gates `contribute` only on `POST /v1/personal/items/:id/contribute`. `recovered-source/worker/src/routes.ts:229` checks `s.switches.contribute` again inside `submitCandidate`. A new contribute path has to be added in both places. The comment at `ops-admin.ts:65-67` says the same thing about `ai`: list the route in `GATES` and call `gate` in the handler.
- `recovered-source/worker/src/brains/open.ts:144` sets `can.decide` from `mayDecide`. `recovered-source/worker/src/brains/open.ts:188` then trusts `can.decide` for direct publish. The publish rule is not in `directPublish`.
- Deny-receipt warnings copy one JSON shape. `recovered-source/worker/src/admin/routes.ts:107`, `recovered-source/worker/src/routes.ts:256` and `:910`, and `recovered-source/worker/src/uxv2/questions.ts:341` each write `{ at: "audit_unavailable", action, decision: "deny" }`. Tests search that string. Change the fields and every copy and every test must change.
- The Worker lives in `recovered-source/worker/src` and imports decisions from `src/state` (for example `wiki/store.ts` imports `src/state/actor.ts`). A behavior change is split across those folders. The layout does not show that they are one system.

### Needless links

- Four `audit` functions know the receipt shape: `recovered-source/worker/src/routes.ts:152` returns `{ receiptId, ok }`, `recovered-source/worker/src/admin/routes.ts:81` returns `boolean`, `recovered-source/worker/src/ops-admin.ts:112` is a third copy, and `recovered-source/worker/src/ux/util.ts:48` is the shared one most routes already import. The private copies change whenever the receipt fields change.
- HTTP modules call the fold directly (`routes.ts:210`, `auth/oidc.ts` mail, `brains/agents.ts:27`, `ux/personal.ts:43`). The route changes when the fold changes, which is a different reason.
- `directPublish` (`brains/open.ts:178`) takes a `can.decide` boolean that another function computed. Its callers change when the lead rule changes, even though publish is the thing that should own that rule.

### Surplus

- SCIM create and patch (`identity-store.ts:622-623` and `:665-666`) lowercase with `asciiLower` and then reject when `normalEmail` is null. The second call is the real check. The first fold has no separate reason to change.
- `routes.ts` `audit` and `admin/routes.ts` `audit` wrap the same `appendReceipt` call that `ux/util.ts` `audit` already wraps.

### Special cases

- `wiki/review.ts:19` allows in-brain decide only for the role id `acme_lead`. Every other role needs `approve_release` (`wiki/review.ts:36-43`).
- `wiki/review.ts:28` allows every decision on the caller's personal root, before the lead check.
- `ops-admin.ts:60-64` is one path for the `contribute` switch. Wiki propose and import are not in that list.
- `ops-admin.ts` bounds and classifies only the switch-off audit call (`boundedAudit`). Enable still waits and fails closed (`ops-admin.ts` enable branch returns `audit_unavailable` 503).
- `tenant-policy.ts` seed skips a principal when `normalEmail` is null (`tenant-policy.ts:284-285`). Other identity sites return 401 or `invalid` instead of skipping a row.
- `security.ts:81-87` treats import bodies as a different content-type allow-list from every other mutation.
- `wiki/store.ts:1483` folds author ids for self-approval, including reject, while `mayDecide` folds them again for the HTTP check. Two policies for one rule.

## Fixes, above the problems they would solve

These are recommendations. Phase 1 does not apply them. A larger refactor is for the owner to approve before anyone builds it.

- One receipt-failure warning, called by the deny sites, so the JSON fields exist once. Do not change which calls stay 403 and which fail closed with 503. Leave the switch-off outcome log (`succeeded` / `refused` / `timed_out`) as its own record.
  - `admin/routes.ts:107`, `routes.ts:256`, `routes.ts:910`, `uxv2/questions.ts:341` copy the deny warning.
  - `routes.ts:152`, `admin/routes.ts:81`, and `ops-admin.ts:112` each wrap `appendReceipt` beside `ux/util.ts:48`.
- One id-and-email compare in `src/state/actor.ts`, and stop folding at the call site when that compare already did it.
  - `wiki/review.ts:21` and `wiki/store.ts:1483-1484` both fold ids.
  - `identity-store.ts:622-623` and `:665-666` fold twice.
  - `routes.ts:210-214` folds id and email in the handler.
- Read "who may decide in this brain" from the role grant, not from a role-id set, and have direct publish ask that same question instead of trusting `can.decide`.
  - `wiki/review.ts:19` names `acme_lead` only.
  - `brains/open.ts:144` and `:188` split the decision from the publish check.
- One switch table: a route declares the switch it needs, and both the middleware and the handler read that declaration.
  - `ops-admin.ts:60-64` lists one contribute path.
  - `routes.ts:229` checks `contribute` again by hand.
  - `ops-admin.ts:65-67` documents the same double entry for `ai`.

## Rank

| Cause | Payoff | Risk | Size |
|---|---|---|---|
| Copied deny-receipt warning | High for the next audit-field change. Low product risk if status codes stay. | Low | Small and local. First slice. |
| Id fold copied at call sites | High. A fold change has already been missed once (session create). | Medium. Easy to change a match by accident. | Small if limited to `wikiAuthored` and `mayDecide` sharing one compare. Larger if every `normalEmail` call site is moved. |
| Lead rule is a role-id set | High for the next lead. | High. It changes who may approve. | Larger refactor. Owner first. |
| Switch routes listed by hand | Medium. New routes skip the gate. | Medium. A wrong list turns a feature off. | Larger. Owner first. |
| Worker split across `recovered-source/worker/src` and `src/state` | High for every future change. | High. Moves import paths and the intake byte check. | Larger refactor. Owner first. |

## First slice

The deny-receipt warning only. One function, the four call sites, the same 403, no new status, no change to switch-off. The other rows wait for the owner.

## Slice result

`routes.ts` imports `warnAuditDenied` from `ux/util.ts`. That file imports `audit.ts` and `types.ts` only. Neither imports `routes.ts`, so the import does not cycle. The four deny sites call that one function. Status codes are unchanged.

The four `audit` wrappers stay. They are not the same function:

- `ux/util.ts` `audit` uses the wall clock (`new Date().toISOString()`), defaults `decision` to `allow` and `reason` to `owner`, returns a boolean, and writes the receipt fields by name.
- `admin/routes.ts` `audit` uses the session clock (`new Date(s.ctx.now).toISOString()`), spreads the whole intent (the caller supplies `decision` and `reason`; there is no `owner` default), and returns a boolean.
- `routes.ts` `audit` uses the wall clock, spreads the whole intent, and returns `{ receiptId, ok }`. Callers read `.ok`, and some also read `receiptId`.
- `ops-admin.ts` `audit` takes `(c, session, action, reason)`, stamps `deps.now()`, always writes `decision: "allow"`, and always writes `nodeId` and `scopeId` as null. Enable still waits and answers 503 when the receipt fails. Switch-off still uses `boundedAudit` and logs `{ at: "switch_disable", audit, switch }` with `succeeded`, `refused`, or `timed_out`.

## Request coverage and intake

`harness/tests/intake.test.ts` gained one allowlist line, `recovered-source/worker/src/ux/util.ts`, so the intake byte check accepts the edited helper. No assertion in that test changed.

The contribute deny (`routes.ts` `warnAuditDenied("contribute")`) and the question deny (`uxv2/questions.ts` `warnAuditDenied(action)`) now have request tests. Each expects 403 and `{ at: "audit_unavailable", action, decision: "deny" }` with action `contribute` or `question.ingest`. On `3656037a` those tests already passed. Removing each call, and not committing that removal, failed only its own test: the warning line was absent. Restoring both calls made both tests pass again. The production calls did not need a change.

## Owner, 01:16 BRT

Tony, via Jarvis: the three larger refactors are approved ("A, all three"). Comments that only restate the code, and tests that cannot fail, are approved to delete ("Yes, delete them"). Each larger refactor is its own slice. The lead slice is `specs/002-lead-from-grants/`. The switch table and the folder move are not that slice. Restating comments in the lead check are part of that slice. A repo-wide deletion is not.

## Lead slice

`LEAD_ROLES` is no longer a hand-written id list. `isBuiltInLeadRole` reads the built-in role table: a role is a lead when a grant can edit, review, or manage members, and that grant is not `approve_release` and not `own_drafts`. For every seeded role that is `acme_lead` and no other role, the same answer as the old set. `mayDecide` then uses that role id the way main did: any node where a standing edit, review, or manage-members check passes, including a stored `acme_lead` whose grants were edited later. The lookup is `Object.hasOwn` on the built-in table, so letter case does not widen it. Elevation still does not count, and `approve_release` is still absent from elevation actions.

The lead mark is not a grant condition. Resending the built-in grants through governance succeeds, as it did on main. Governance still rejects an unknown condition.

`directPublish` keeps `can.decide` exactly as on main. It does not call `mayDecide`. Devin's pre-merge check on `d9ad3ab1` showed that gating publish on `mayDecide` both blocked a non-lead with `can.decide` true and let `acme_lead` publish with `can.decide` false. Whether publish should ask `mayDecide` is deferred until Tony decides. The stored edit check at the end of `directPublish` stays.

Inspector's review of `a30305a7` is the same decide gap: an `acme_lead` with an extra edit, review, or manage-members grant, or a second role that carries one, was denied, and so was `pb:<id>:n`. Main allows those because the role id is a lead and the standing action check passes. `cc3a0864` restored that loop. The truth table from main `2d61c473` now names the governance-edit grants, the second role, and `pb:u_acme_lead:1`, `:2`, and `:3`.

## Switch table

The HTTP kill switches are declared twice. `ops-admin.ts` `GATES` matches `POST /v1/personal/items/:id/contribute` for `contribute`, `/v1/ai/*`, `/v1/genui/plan`, and `/v1/briefs` for `ai`, and `/v1/connectors` and `/v1/sources` for `connector`. Handlers then re-check the same names: `submitCandidate` and routine runs for `contribute`, `gate()` and brief save for `ai`, and search, wiki sources, and sharepoint for `connector`. An internal call checks `mcp` before any path.

This slice puts those names, path matchers, and handler keys in one table. `switchGate` and the handlers read it. The matchers stay, including the `/v1` prefix and the `POST`-only contribute matcher. An internal `mcp` off still wins.

These answers are not the middleware 503, so they stay at the call site: search and wiki sources omit connector hits, a sharepoint routine returns `{ error: "switched_off" }` and the route returns 409, a routine ingest returns a reason string, a personal routine target is not blocked, `gate()` returns `ai_disabled`, and the wiki ingest job reads the tenant switch with no session and fails closed when that read throws. Folding those into the 503 would change behaviour. The publish-rule question from the lead slice is still deferred.

Comments removed because they only repeated the code:

- The note on `leadOf` in `wiki/review.ts` said a `lead` grant must still allow a standing decision action. The function checks `conditions.lead` and `canDoInView`.
- The `directPublish` note said the mode must be direct and the caller must be allowed to edit. Those are the `publication` and `can.edit` checks. It also said publish asks the stored brain role, which this function does not do.

## Switch follow-up

PR #9 merged as `8c2ede3`. The table still matches the first HTTP row, so a later overlapping row that is off would be skipped. This follow-up refuses when any matching row is off. Today's rows are disjoint, so the 228 answers from main `8d8ab548` stay.

The disjoint test now walks a probe list stored on every HTTP row. A row with no probe fails. A probe that another row also matches fails. The eight handler keys each resolve to a row; removing `sharepoint` fails that test and no other test in the file.

These paths were pinned on that head to the matcher as it stood: a trailing slash on contribute is not that row, a trailing slash on `/v1/sources/s1/` is the connector row, `/v1/Sources/s1` and `/V1/sources/s1` are not, `/v1//sources/s1` is not, a query string on `/v1/sources/s1` is the connector row, HEAD and OPTIONS on that path are the connector row, and `/v1x/sources/s1` and `/v10/sources/s1` are not. `/v1/%73ources/s1` was not a connector row there, because the gate read the encoded pathname. After this branch merges that main, the same row is 503 when the connector switch is off.

## Encoded source path

`switchGate` used to read `new URL(c.req.url).pathname`. On Hono `4.13.17` that pathname keeps `%73`, so `/v1/%73ources/s1` did not match the connector row, while Hono routed it to `GET /sources/:id`. The gate now matches `c.req.path`, the path Hono already used to choose the route. An encoded path for a switched-off route is 503. A percent sequence `decodeURI` rejects (`%`, `%ZZ`, `%C0%80`) is 400 `{ error: "bad_request" }` and does not continue. A valid encoding of a path that is not a kill-switch row still continues: `/v1/%6dap` reaches `/v1/map`.

`GET /v1/%2573ources/s1` stays `/v1/%2573ources/s1`. Hono does not decode `%25` a second time, so the connector row does not match and the catch-all runs. `GET /v1/sources/%25s1` is a real sources route that still contains `%25`: with the connector switch on, the handler runs and the id is `%s1`; with it off, the answer is 503. That is the same answer as main, whose raw pathname for that URL already starts with `/v1/sources/`. `%2F` is not a slash (`/v1/sources%2Fs1` is the catch-all). Uppercase hex `%6F` is `o`, so `/v1/s%6Furces/s1` is the connector row. An encoded `/v1` prefix (`/%76%31/sources/s1`) and an encoded trailing slash (`/v1/%73ources/s1/`) are the connector row too.

`/v1/map/%2e%2e/sources/s1` is already `/v1/sources/s1` in `new URL().pathname` before the gate reads it, and Hono routes it to `GET /sources/:id`. The old pathname gate and `c.req.path` give the same 503. That test does not separate them. Replacing `c.req.path` with the raw pathname left it green and turned the encoded name, the uppercase hex, the encoded `/v1` prefix, and the encoded trailing slash red.

These paths are not matched, on main `8c2ede3` and here: `/v1/ai` with no further slash, `/v1/sources` with no id, and a trailing slash on `/v1/personal/items/:id/contribute`. Whether they should be matched is a question for Tony. This slice does not change the matchers.

`securityHeaders` now reads `c.req.path`, so `/%76%31/health` and `/%69nternal/ping` get `Cache-Control: no-store`. Two checks stay on the raw pathname because each fails closed (Sentinel R-2 and R-3, Info). This slice does not change them:

- `auth.ts` `internalRouteVerdict` matches the MCP allowlist against `new URL(c.req.url).pathname`. An encoded path misses the allowlist and is 403.
- `security.ts` `isImport` uses that same pathname, so an encoded `/v1/brains/:id/import` gets the 32 KB JSON limit instead of the 5 MB import limit.

`observe.ts` already reads `c.req.path`. `internal-auth.ts` `pathAndQuery` uses the raw pathname as the signed string, not as a route gate. `brains/unzip.ts` checks archive entry names, not the request URL.

PR #10's `httpSwitch` still has an optional switches argument and, without it, returns the first match. Sentinel R-1 on that PR asks for the argument to be required. That waits for refactor 3, the move of the Worker HTTP code next to `src/state`. This PR does not change that signature.

Mutations, restored before commit:

- `decodeURI(decodeURI(pathname))` in `routedPath`: `switch-decode.test.ts` exit 1, 4 pass, 1 fail, duration_ms 236.565992. `GET /v1/%2573ources/s1` was `503 !== 200`. The same mutation answered 400 for `GET /v1/sources/%25s1` with the connector switch on and off. Main reaches the handler when the switch is on (200, id `%s1`) and returns 503 when it is off.
- The 400 removed, so a bad percent sequence continues on `c.req.path`: exit 1, 4 pass, 1 fail, duration_ms 242.127086. `/v1/%ZZ` was `200 !== 400`.
- `routedPath` returned `new URL().pathname`: exit 1, 3 pass, 2 fail, duration_ms 240.904142. `/v1/%73ources/s1` was `200 !== 503`, and `/%76%31/sources/s1` was `200 !== 503`. Under that same mutation `/v1/s%6Furces/s1` was 200, `/v1/%73ources/s1/` was 200, `/v1/sources%2Fs1` stayed the catch-all, and the dot segment stayed 503.
- `decodeURIComponent` in place of `c.req.path`: exit 1, 4 pass, 1 fail, duration_ms 251.618101. `/v1/sources%2Fs1` was `503 !== 200`.
- `securityHeaders` put back on the raw pathname: `switch-cache.test.ts` exit 1, 0 pass, 1 fail, duration_ms 121.291043, `null !== 'no-store'`. The red commit before the fix failed the same way, duration_ms 132.272536.

## Folder move

The Worker HTTP code lived in `recovered-source/worker/src` and the decisions it calls live in `src/state`. Tony approved this move ("A, all three"). The tree is now `src/worker`, beside `src/state`. HTTP answers stay as on main `e8e7ef63`. The pin in `harness/tests/worker-pin.test.ts` passed on that main (exit 0, 1 pass). Skipping the off-switch return made `GET /v1/sources/s1` with the connector switch off `200 !== 503` (exit 1, 0 pass, 1 fail, duration_ms 249.61952). That edit was restored.

Queued with that move, and not a behaviour change:

- Inspector I-1: the switch-table test must not say the fixture was taken from main.
- Inspector I-2: label the dot-segment assertion. `new URL().pathname` already collapses it, so it does not separate the two path readers.
- Inspector I-4: an encoded path fails the MCP allowlist.
- Inspector I-5: unit tests for a different letter case and a trailing slash.
- PR #10 R-1: `httpSwitch` requires the switch map. The first-match fallback goes away.
- Sentinel Info: a malformed percent-encoding that is 400 still gets `Cache-Control: no-store` when the routed path is under `/v1/`.

`internalRouteVerdict` and `isImport` stay on the raw pathname. Publish still reads `can.decide`. Those are not this slice.

Comment removed because it only repeated the code: the note on `blockingSwitch` said it returns the first matching row whose switch is off. The function walks the rows and returns that row.

## Docs and tests after the move

The intake archive is still 99 Worker files plus 18 shared-package files, 117 in all. That split stays in `candidate-manifest.json`. It is not the live tree. `src/worker` now holds 102 files: 101 `.ts`, including 2 `.d.ts`, and 1 `.js`. `recovered-source/shared/packages` now holds 20 `.ts` files. `RECOVERY.md` and `docs/state-machines.md` name those current counts. The intake 99 and 18 stay labeled as the archive split.

Nothing in those notes was deleted. The sentences that pointed the old 99 at `src/worker` were rewritten.

The MCP allowlist call site still passes `new URL(c.req.url).pathname`. The pin now also rejects `decodeURI`, `unescape`, `toLowerCase`, `c.req.path`, and `replace(` in that call. A signed-request test of `authenticate` is deferred. Reaching that line needs a signed internal principal, a replay store, and a tenant session. That is a later test, not this docs pass. The allowlist function itself is already pinned: an encoded path is `no`.

## Switch path variants

Tony, via Jarvis: "A, make the switches catch those variants too." The unmatched forms recorded here are `/v1/ai` with no further slash, `/v1/sources` with no id, and a trailing slash on `/v1/personal/items/:id/contribute`. The same rule covers `/v1/connectors`, because a prefix row matches the prefix or `prefix/…` with no extra case for one name. Percent-encoding and letter case go through that one path. `%2F`, a double slash, `/v1x`, and `/v10` stay unmatched. Publish and the Backlog folder download stay as they are. `auth.ts` and `isImport` stay on the raw pathname.

Tracked, and not this change: a signed `authenticate` request that proves the MCP call site. The string pin cannot see a rewrite that avoids those spellings. Inspector's evasion list for that call is `decodeURI`, `decodeURIComponent`, `unescape`, `toLowerCase`, `toUpperCase`, a trailing-slash `replace` or `slice`, and reading `c.req.path` instead of the raw pathname. A helper with another name would slip the string pin. The signed request is what would catch that helper.

The prefix check is `path === prefix || path.startsWith(prefix + "/")`. Replacing that with `startsWith(prefix)` would treat `/v1/aix` as `/v1/ai`. The normalizer drops every trailing slash, so `/v1/genui/plan//` and `/contribute//` are the same row as the path without those slashes. An interior `//`, `%2F`, `%2f`, `%2573`, `/v1x`, and `/v10` stay off the rows. A bad percent sequence stays 400.

## Real router, extra slashes, and HEAD

These are tests, not a new matcher. The app under test sets a session, runs `switchGate`, then the same paths the Worker registers: `aiRoutes`, `GET /sources/:id`, and `POST /personal/items/:id/contribute`. There is no catch-all.

`/v1//sources/s1` is 404 with the connector switch off or on. The router has no such route, and the path is not the connector prefix. `/v1/sources/s1//x` is 503 when the connector switch is off, because the path still starts with `/v1/sources/`, and 404 when the switch is on, because no route matches. That 503 is the current gate. It is not a defect to remove from `switches.ts`.

Four and five trailing slashes stay on the row. HEAD `GET /v1/ai/status` is 503 when the ai switch is off and 200 when it is on, the same status as GET. A strip loop capped at three slashes, a catch-all in place of the router, and a HEAD skip in the gate each turn their own test red. Those edits are restored.

## Real v1 wiring

The public routes are reached through `createApp`: `authenticate`, then `switchGate`, then the handler. The token is a synthetic Access JWT. `verifyAccessJwt` checks it with a test JWKS passed in `deps.jwks`. The switch flags come from `TenantPolicy.switchState` on a temporary sqlite file.

`/v1/internal/ops` and `/v1/internal/mcp` do not go through `switchGate`. `createApp` mounts them before `v1Routes` so a machine call skips Access auth and the body limit, and each route checks its own HMAC. `GET /v1/internal/mcp/switches` is how the MCP worker reads the flags, including when one is off, so a 503 from `switchGate` there would hide the state it is meant to report. That bypass stays. The `mcp` flag still refuses an internal *user* session on the public router. The signed MCP allowlist test named above is still deferred: this JWT is an Access token, not an MCP principal signature.

## The ac41dfec 503 note

`docs/auth/mantu-503-classification.md` and `docs/auth/mantu-503-repro.mjs` come from `578de37a` and stay as a record of that bundle. The classification's body is not rewritten. A status note at the top says current `src/worker` does not use `auth_unconfigured`. The repro is not a test.

## Route test gaps

These are tests on the app that is already on main. A bad ops signature, a stale or missing timestamp, and a body that does not match the signature are 401. Restore without a signature is 401, restore while it is turned off is 403, and a dev restore of the tenant's own snapshot is 200. A missing workspace binding is 500 `internal_error`. A connector that says the file is not allowed is 403. The contribution test reads the status stored by `create`, not only the JSON. `GET /v1/internal//ops/targets` with no credentials is 401 from `authenticate`. The same path with a valid Access token is 404 from the v1 catch-all, whatever the HMAC, because it never reaches the ops middleware. The HMAC 401 is proved on `/v1/internal/ops/targets` with that same token and a bad signature.

## Source hardening

The contributor and a configure holder can read one candidate by id. Everyone else gets the same 404 as a missing id. `GET /v1/nodes` is not that door. The brain directory gives each workspace its own bound. A miss is a name-only card with `unavailable: true`. The others still return. Health answers `{ ok: true }` only. The 503 repro script refuses a path outside the repo. The personal wiki seed is unchanged.
