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

## Owner, 01:16 BRT

Tony, via Jarvis: the three larger refactors are approved ("A, all three"). Comments that only restate the code, and tests that cannot fail, are approved to delete ("Yes, delete them"). Each is its own slice. The lead slice is `specs/002-lead-from-grants/`. The switch table, the folder move, and the comment and test deletion are not that slice.
