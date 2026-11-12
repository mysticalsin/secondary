# Research: Erasure partial-failed append

## Decision: the required end state is not chosen here

**Decision**: Record Accept, Replace, and Resume. Select none.

**Rationale**: The backlog says the path is fixed or explicitly accepted. The reducer today appends. Choosing a replacement would guess a product outcome.

**Alternatives considered**: Selecting Accept because the code already does it. Selecting Replace because a fresh plan is what an absent row gets. Selecting Resume because an in-progress grant was only for the stored order. Each alternative is a product choice. None is taken.

## Decision: the absent-subject path stays outside the behavior change

**Decision**: Document it. Do not include it in the behavior change until Devin or Tony says it is in scope.

**Rationale**: That path creates the canonical plan. It does not append onto a stored order. The backlog wording is "the full plan appended."

**Alternatives considered**: Treating every `partial_failed` after a refused key as this item. That would include a path the reproduction showed is not an append.

## Findings

Parent commit `565bff6a2ba3153f11347482cdee3555b257f87f`.

A pure run of `erasureWithGrant` then `runErasure` on a `requested` row whose order is `directory` and whose grant covers `directory`:

- After the grant helper, the order is still `["directory"]` and the grant steps are the full plan.
- The request persists order `["directory","receipts","tombstone","scope:acme","personal","connector"]` while the status is still `requested`.
- The runner continues from the first step that is not done, in that appended order.
- The connector step returning false ends `partial_failed` with `connector` marked `failed` and that appended order.
- Every step returning true ends `completed` with that same appended order.
- An absent start with the connector step returning false ends `partial_failed` with order `["receipts","tombstone","scope:acme","personal","connector","directory"]`.

The no-key refusal does not call the runner. `ops-admin.ts:180` returns before quorum. `ops-rights.ts:153` returns before `applyLedger`. The stored step stays `pending`.

The false connector step is `ops-rights.ts:187` when `emailOfPrincipal` (`tenant-policy.ts:1085`) returns an email and `forgetSourceAccess` (`connector.ts:222`) returns false because the connector is absent. Any other step that returns false uses the same `step_failed` rule at `erasure-request.ts:389`.
