# Spec 020 — Erasure ledger repair

Ticket: SB-ERASURE-LEDGER-REPAIR

Follow-up to Inspector's hands-on review of #24 (`a2021846`) and Sentinel's #24 residuals. Loop 1 of the plan debate is recorded. No production change until loop 2 agrees.

## Ticket

Done when:

- [ ] `POST /v1/admin/rights/erase` still refuses the whole tenant when any company scope fails the grammar. The 422 body is exactly `{ error: "invalid_scope", scopes: <count> }`. The count is an integer. The body, logs, headers, and audit reasons contain no scope id. A caller without configure gets 403 and no count. The runbook line is in `docs/state-machines.md`.
- [ ] `SCOPE_ID` is exported once from `src/state/erasure-request.ts`. `scopeIdOfStep` uses that export and has no regex of its own. `src/worker/ops-internal.ts` imports it. No other file under `src/` contains the grammar.
- [ ] `transitionErasure` refuses a request step it cannot place, including on a completed ledger. A restore with an unknown step is not `ok: true`. `addSteps` and `reopen` do not skip an unknown step and continue.
- [ ] On a readable row, `erasureWithGrant` does not merge a step that is not a plan step and does not mutate the row in place. `recordErasureGrant` does not spend the second approval: the result is `refused`, the pending ask stays, and the ledger bytes stay.
- [ ] `GET /v1/admin/rights/erasure-ledgers` is configure-only. A caller without configure gets 403 and an empty body. The default body is a count of unreadable rows and a count of principal ids, with a limit, a cap, and `truncated`. An id list is opt-in. The audit receipt is counts only. The read does not change the ledger directory.
- [ ] Legacy ledgers are never migrated and never deleted.
- [ ] Each new scenario uses its own sqlite `TenantPolicy` and its own principal id.

## N-2

A signed workspace restore of `bad id` or `C_x` returns 400 `invalid_target` and does not import a snapshot. `reapplyErasures` with `bad id` leaves the mark bytes unchanged. A tenant restore ignores the scope query and reopens `directory`. There is no CLI or cron caller, and this slice does not add a quorum or HMAC replay test.

## Out of scope

Sentinel R-3, the unwrapped second `erasurePlan` in `ops-rights.ts`, stays out. No deploy. No secrets. Synthetic data only.
