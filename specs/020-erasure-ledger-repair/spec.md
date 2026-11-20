# Spec 020 — Erasure ledger repair

Ticket: SB-ERASURE-LEDGER-REPAIR

Follow-up to Inspector's hands-on review of #24 (`a2021846`) and Sentinel's #24 residuals. This run is the plan and the red tests. No production change until the plan debate agrees.

## Ticket

Done when:

- [ ] `POST /v1/admin/rights/erase` still refuses the whole tenant when any company scope fails the grammar. The 422 body names the rejected scope count and does not contain a scope id. A runbook line says what the operator does. Refuse-not-drop stays.
- [ ] The scope grammar is one exported value. `scopeIdOfStep`, `erasurePlan`, `stepsForRestore`, and the ops restore target all use it. A second copy of the grammar fails the pin test.
- [ ] `transitionErasure` refuses a pending step it cannot place. It does not drop that step and continue.
- [ ] `erasureWithGrant` does not replace the caller's row when a step is not a plan step. `recordErasureGrant` does not write that result over the stored ledger.
- [ ] A read-only report counts unreadable legacy ledgers and names the principal ids. It does not echo the ledger text, delete a row, or rewrite one. No migration runs unless this debate approves it.
- [ ] Each new scenario uses its own sqlite `TenantPolicy` and its own principal id.

## Dropped

N-2 is already fixed. `reapplyErasures` still skips a restore scope the grammar rejects (`src/worker/ops-rights.ts` catch of `invalid_scope`). The HTTP restore never reaches that catch: `target` requires the grammar and the route returns 400 `invalid_target` first (`src/worker/ops-internal.ts`). The direct call is already tested by `a non-conforming restore scope is skipped instead of treated as done` in `harness/tests/erasure-request.test.ts`.

## Out of scope

Sentinel R-2 (`addSteps` and `reopen` skip an unknown step) and R-3 (the second `erasurePlan` in `ops-rights.ts` is not wrapped) are not in this ticket. No deploy. No secrets. Synthetic data only.
