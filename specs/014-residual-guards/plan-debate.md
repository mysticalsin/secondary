# Plan debate: one ancestor walk

Status: OPEN. A non-author has not answered. This is not an agreement.

## Question

Who decides that a brain is restricted when the flag sits on an ancestor, and when the walk cannot finish?

## Options

### 1. Copy the walk into each reader

Leave `factsOf`, the missed-card walk, `directPublish`, and the `scope=all` badge as separate loops. Teach each one about contacts and about failing closed.

Risk: the copies drift. That already happened. The missed-card walk did not match the open card, and a bolt-on was rejected. The next reader can forget contacts or the hop cap.

### 2. One exported `restrictionOf`, called by every reader

`factsOf`, the missed card, `directPublish`, and the closed `scope=all` card call the same function. The policy view is unchanged. Contacts count as restricted. A walk that does not end on a null parent returns restricted.

Risk: this changes who waits for review and which closed card shows restricted. An unflagged page under a restricted or contacts ancestor no longer publishes directly. A closed department under a restricted parent shows `restricted: true`. A missing parent fails closed, so a broken link is treated as restricted instead of open. The twelve-hop cap does the same for a chain longer than the real org. The real org's longest chain is five, so the cap is a synthetic bound. This is the permission change, and it is why the pull request is high risk.

### 3. Mark the view node inside the policy engine

`underRestriction` already walks ancestors, but only to stop the everyone-open lift. Setting `restricted` on the view node would make every consumer see the ancestor.

Risk: admission, grants, and every reader of the view change together. A circle could drop out of the open set, not only change its badge. That is wider than the bug.

## Choice

Option 2. One function, four call sites, a test on each call site. The policy engine stays as it is. Fail closed is the safe side for a missing parent and for the hop cap.

## Devin round 1

Devin agrees with Option 2 on conditions C1–C8. This round does not close the debate. Sentinel has not answered.

- C1. Met in `plan.md`: repository-root `npm test`, and the first red names for T005 and T006 with sha `64f9a1d8a51eb23aab99b58b590cc8ce413d8424`.
- C2. Met in `plan.md` and in `twelve ancestors ending on null are open and thirteen are restricted`. Twelve ancestors that end on null are not restricted. Thirteen is the first length that is.
- C3. Met by `direct publish still publishes an unflagged chain that ends at the hop cap`. The test passed on the current walk. A depth-is-restricted mutant fails it.
- C4. Met by `a parent cycle and a self-parent are restricted by the hop cap`. The test passed. A cap that returns the accumulated flags fails it. The walk stops at 12 visits.
- C5. Met by `ad79dc4` (red, `synthetic lookup failed`) and `8717e88` (fix). `directPublish` then returns false, so the page stays in review. It is not a 5xx. `plan.md` says so.
- C6. Met by `erasure request drops a scope step that is not an anchored match` and `erasure scope matching does not use a prefix`. Request, `place`, and the runner all use `scopeIdOfStep`. The four forms are `scope:c_delivery!`, a 129-character id, `scopes:x`, and `scope:C_delivery`. The tests passed. `startsWith("scope:")` fails them.
- C7. Met by `ancestor walks stay inside restrictionOf and underRestriction`.
- C8. Met in `plan.md`. Rollback is an ordinary revert to main `9bdb364644f9a811a35032bec60e41a886a7650f`, with no data migration. A page already in review stays in review. Brains whose publish path changes: not measured. Contacts restrict descendants by the open card's rule, under the Sentinel X-2 / Y-1 residual input named in spec 014.

## Sentinel round 1

Sentinel endorses C1–C8 and would block on C2, C3, C4 and C7. Those are met at this head by the tests named above, including the planted second walk that `ancestor walks stay inside restrictionOf and underRestriction` rejects. Sentinel adds S1–S7. The original leak was low. The risk of this change is over-restriction. The unflagged controls stay green.

- S1. Met. `restrictionOf(null)` is restricted unless the caller says the brain is personal. Readers pass the tenant org map. `each reader uses the tenant org, and another tenant's org does not apply`.
- S2. Recorded, not changed. `underRestriction` does not treat contacts. `packages/policy/src/engine.ts` is intake bytes, so editing it would be a pin, and adding contacts there would also block the Everyone-open lift. `a contacts ancestor does not block the everyone-open lift` locks that divergence. C7 names `underRestriction` as the only allowed second walk.
- S3. Met by `a new direct flag read is listed before it lands` and `harness/tests/flag-reads.txt`. Brain config at `routes.ts` reads `effectivePublication(b.facts)`, which is the walk's result, not a raw flag. Export, search and ops read flags on directory rows for two-person rules. Those reads are in the inventory.
- S4. Met by `proposing under a restricted ancestor stays a candidate and an unflagged brain publishes` (201 candidate, then 201 published) and by the closed card's six keys: `canOpen`, `canRequestAccess`, `id`, `name`, `restricted`, `type`.
- S5. The mutant table is in the report for this head. Each guard names its test in `plan.md`.
- S6. Round 1 left the refuse-not-drop work split. Round 2 below brings the three silent drops back. The ledger rewrite and the old-row repair stay split.
- S7. `a stored direct publication publishes again when the ancestor flag is cleared` locks the flip back. A repair path for old erasure rows with bad scope steps is a stored-ledger migration. Not built here. Split with S6.

## Devin advisory mutants

Not a verdict and not a gate loop. V1 is killed by `a parent cycle and a self-parent are restricted by the hop cap`. V2 is killed by `a throwing parent lookup is restricted and direct publish does not throw`. V3 is killed by `the runner refuses a prefix and a scope the tenant did not plan`. V4 is killed by `a 129-character candidate id is not found and a 128-character id is`. V5 is killed by `the author of a candidate on a node they cannot view gets 404`.

The named runner cases are `a planned scope runs`, `an unplanned scope is refused`, and `a prefix is refused`. An omitted company scope still runs. That is `erasure append T010: a pending scope the current plan omits stays and runs, and directory is last`.

## Devin round 2

CONSENSUS (Devin): AGREED

His notes: the S6/S7 split is OK as its own HIGH-risk PR; #24 must not worsen today's drop behaviour; the gate re-runs the named mutants for C2/C3/C4-V1/C6/V3/V4/V5; the S2 residual is accepted; C8 not measured is accepted.

## Sentinel round 2

OBJECTIONS on S6 refuse-not-drop only. S1, S3, S4, S5 and C7 are closed. S2 is an accepted residual. The S7 repair splits once fixes 1-3 land. The ledger rewrite and old-row repair stay out of this pull request.

- Fix 1. `erasurePlan` refuses a company scope the grammar rejects, and `POST /v1/admin/rights/erase` returns 422 `invalid_scope` before a ledger row or a side effect. Red `a0bb4de6b93d88411df2fa8ce3e942413078d108`: `Missing expected exception` and `202 !== 422`. Fix `9e5450709315c1161a089bc62577294e99a4a40b`. Mutant `filter-instead-of-refuse` fails the same two assertions. Restored.
- Fix 2. A restore scope the grammar rejects is listed in `skipped`. An empty step list is not treated as done. Red `9219ba14d5ada1105e68aef0ed11f1f876b2a764`: `skipped: []` against `skipped: [subject-1]`. Fix `57aecd180cf7838127121aff51955cee1b660a3f`. Mutant `return-empty` fails the same assertion. Restored.
- Fix 3. `requestedFrom` refuses a step the grammar rejects. The transition reason is `unknown_step`. A grant built from those steps is unreadable. Red `355e9efbc7acdbc870aa9b732beadbd50e76d3f2`: `true !== false`. Fix `003338085e04569d5952757f807eb5de5948f074`. Mutant `filter-and-shorten` fails the same assertion. Restored.

CONSENSUS: OPEN
