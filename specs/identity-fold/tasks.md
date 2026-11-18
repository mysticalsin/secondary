# Tasks: Identity fold on the sign-in path

**Input**: `specs/identity-fold/plan.md`

## Phase 1

- [x] T001 Red: restore `sessionCreate` for U+212A and U+0130, and add SCIM create, SCIM patch, and OIDC callback assertions in `harness/tests/email-identity.test.ts` and `harness/tests/oidc-login.test.ts`
- [x] T002 Drop Unicode lowercase at the identity and account-key sites. `normalEmail` or ASCII A–Z owns the fold

## Phase 2

- [x] T003 Red: patch `@ascii.example` expects `invalid` in `harness/tests/email-identity.test.ts`
- [x] T004 `normalEmail` returns null for an empty local part, an empty domain, or more than one `@`

## Phase 3

- [x] T005 Red: Kelvin cohort member does not enable the flag for `k@` in `harness/tests/pilot-email.test.ts`
- [x] T006 `pilotSave`, `flagsFor`, `rememberAddress`, and `forgetPilotMember` use `normalEmail`

## Phase 4

- [x] T007 Red: a second tenant still logs a seen name, and 257 names log 256, in `harness/tests/kill-switch.test.ts`
- [x] T008 Per-instance set, cap 256, in `tenant-policy.ts`

## Phase 5

- [x] T009 Red: deny with a missing audit binding stays 403 and expects a warning in `harness/tests/deny-audit.test.ts`
- [x] T010 Log `{ at: "audit_unavailable", action, decision: "deny" }` and still return 403

## Phase 6

- [x] T011 Lock the 600 second boundary and a replay after a failed code exchange in `harness/tests/oidc-login.test.ts`
- [x] T012 Leave the `switch_disable` receipt after the write. Bound that call and log a warning with no address when it fails
- [x] T013 Red: an elevated CEO cannot decide a wiki release in `harness/tests/wiki-release.test.ts`
- [x] T014 `mayDecide` requires `approve_release`. Direct publish uses that same decision
- [x] T015 Red: a same-person prod re-enable is 409 in `harness/tests/switch-same-actor.test.ts`
- [x] T016 The switch route returns 409 when `sameActor` is true
- [x] T017 Red: a non-proposer withdraw has no allow receipt in `harness/tests/withdraw-receipt.test.ts`
- [x] T018 Write only the rejected receipt for that refusal

## Dependencies

T002 after T001. T004 after T003. T006 after T005. T008 after T007. T010 after T009. T011 and T012 have no production dependency.
