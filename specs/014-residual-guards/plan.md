# Plan 014: Residual guards

Tests sit next to the routes they guard. Signed-call cases use `signOpsRequest` and the real `verifyOpsRequest` path through `createApp`. The connector case uses `connectorRoutes` and a real `Workspace` on sqlite. Candidate cases extend the existing directory harness and put the long node back when the test ends.

The missed-card restriction walk follows parent links already stored on the org, the same way an open card does. The erasure step check stays inside `knownErasureStep`, which is `scopeIdOfStep`: a full anchored match, not `startsWith` and not a prefix. The request drops a step that fails that match, `place` ranks a scope only when the same match succeeds, and the runner calls `scopeIdOfStep(step)`.

## Test command

Working directory: the repository root.

```
npm test
```

That runs `node --experimental-strip-types --test --test-reporter=spec harness/tests/*.test.ts harness/runtime/*.test.ts`.

T005, missed-card ancestor restriction, went red first as `a missed card under a restricted ancestor is restricted` in `64f9a1d8a51eb23aab99b58b590cc8ce413d8424`.

T006, erasure step form, went red first as `erasure request: only the exact step forms are readable` in the same commit `64f9a1d8a51eb23aab99b58b590cc8ce413d8424`.

The commands that showed those failures, from the repository root:

```
node --experimental-strip-types --test --test-name-pattern "missed card under a restricted ancestor" harness/tests/src-hardening.test.ts
node --experimental-strip-types --test --test-name-pattern "only the exact step forms" harness/tests/erasure-request.test.ts
```

## Hop cap

The cap visits 12 ancestors. N ancestors that end on a null parent, with N at most 12, are not restricted. The first N that exceeds the cap is 13: after 12 visits the next parent id is still set, so the card is restricted. The tests are `twelve ancestors ending on null are open and thirteen are restricted` and `twelve ancestors stay open and thirteen ancestors fail closed`.

A chain of unflagged ancestors that ends on null at that cap depth is not restricted, and `directPublish` still publishes directly. The test is `direct publish still publishes an unflagged chain that ends at the hop cap`. It already passed on the current walk. A mutant that treats depth itself as restricted (`hop >= 11` at the null parent) fails it: `true !== false` on the twelve-ancestor case, and `false !== true` on direct publish.

A parent cycle (`A` parent `B`, `B` parent `A`) and a self-parent both return restricted because the walk hits the cap. Neither loops without a bound. The test is `a parent cycle and a self-parent are restricted by the hop cap`. It already passed. A mutant that returns the accumulated flags at the cap, instead of restricted, fails it: `false !== true`.

## A lookup that throws

`restrictionOf` catches a throw from the node or from `nodes.get` and returns `restricted: true`. `directPublish` then returns false, so the page stays in the review queue. It does not become a 5xx. The red commit is `ad79dc4`. The test `a throwing parent lookup is restricted and direct publish does not throw` failed with `synthetic lookup failed` thrown out of `restrictionOf`. The fix is `8717e88`. A catch that returns unrestricted fails that test: `false !== true`.

## Scope steps

These are not scope steps, at the request, at `place`, and at the runner, because all three use `scopeIdOfStep`:

- `scope:` plus a valid id plus a trailing illegal character (`scope:c_delivery!`)
- `scope:` plus a 129-character id
- `scopes:x`
- an uppercase first character (`scope:C_delivery`)

The test `erasure request drops a scope step that is not an anchored match` already passed. Replacing the anchored match with `startsWith("scope:")` stores `scope:c_delivery!` and fails `erasure scope matching does not use a prefix` with `true !== false`.

## One walk

`ancestor walks stay inside restrictionOf and underRestriction` fails if another loop reassigns a parent id from `.parentId`, or a `for` header walks `parentId`, anywhere under `src/` or `packages/policy/src/` except `src/worker/brains/open.ts` and `packages/policy/src/engine.ts`.

## Rollback

Roll back to main `9bdb364644f9a811a35032bec60e41a886a7650f` by an ordinary revert. No data migration. A page already sitting in review because direct publish was refused stays in review. The revert does not publish it and does not delete the review row. Later publishes use the previous rule.

How many current brains change publish path: not measured. No private vault data was used.

Contacts restrict their descendants because the open card already counts `contacts` as restricted, and spec 014 takes Sentinel X-2 / Y-1 as the residual ruling that the other readers use that same rule instead of a second walk. The decision log states the result: a contacts ancestor does not skip review.

## Security & data

Wrong keys, replays, and tampered queries stay 401. A second tenant cannot read the first tenant's candidate. No live token or cookie is written.
