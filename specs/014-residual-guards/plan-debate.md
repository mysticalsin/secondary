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

CONSENSUS: OPEN
