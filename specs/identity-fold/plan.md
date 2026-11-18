# Implementation Plan: Identity fold on the sign-in path

**Branch**: `cursor/sb-full-fix-b165` | **Date**: 2026-11-18 | **Spec**: `specs/identity-fold/spec.md`

## Summary

Stop Unicode lowercase on email and account-key match sites. `normalEmail` owns the fold, and it returns null when an address has no local part, no domain, or more than one `@`. Pilot lookups use that fold. Unknown switch names are remembered on the Durable Object, capped at 256. A failed deny receipt stays 403 and logs a structured warning with no personal data. Switch off stays after the write.

## Technical Context

**Language/Version**: TypeScript 5.9.3, Node 22.18 or newer

**Primary Dependencies**: Existing packages. No new package.

**Storage**: Existing SQLite. No migration. Stored addresses are not rewritten.

**Testing**: `npm test`

**Target Platform**: Recovered API Worker under the Node harness

**Project Type**: Recovered Worker plus `src/state` and harness tests

**Performance Goals**: None. The set cap is 256 names per object.

**Constraints**: No deploy, no force push, no push to `main`. Provenance check stays as written. `switch_disable` HTTP behavior stays.

**Scale/Scope**: Identity fold sites listed in the spec, `tenant-policy.ts` switch memory, `admin/routes.ts` deny log, harness tests.

## Constitution Check

- Principle I: one behavior per code commit.
- Principle IV: no shim and no `any`.
- Principle V: each behavior starts with a failing assertion.
- Principle VI: Security & data is below.
- Principle VII: `cursor/sb-full-fix-b165`. Fast-forward only.
- Principle X: no merge and no deploy.

## Project Structure

```text
src/state/actor.ts
src/state/pilot-member.ts
recovered-source/worker/src/tenant-policy.ts
recovered-source/worker/src/auth/oidc.ts
recovered-source/worker/src/auth/identity-store.ts
recovered-source/worker/src/auth/config.ts
recovered-source/worker/src/auth.ts
recovered-source/worker/src/admin/routes.ts
recovered-source/worker/src/admin/store.ts
recovered-source/worker/src/ops-rights.ts
recovered-source/worker/src/org.ts
recovered-source/worker/src/routes.ts
recovered-source/worker/src/brains/agents.ts
recovered-source/worker/src/ux/personal.ts
harness/tests/email-identity.test.ts
harness/tests/oidc-login.test.ts
harness/tests/pilot-email.test.ts
harness/tests/kill-switch.test.ts
harness/tests/deny-audit.test.ts
```

## Security & data

**Read**: Sign-in address, SCIM user name, OIDC preferred username, cohort member list, switch name, the caller's role on a deny.

**Written**: A non-matching sign-in may insert a principal whose address is the original claim. An invalid patch writes nothing. Unknown-switch memory is process state on the object, not a new table. The deny warning and the switch-off warning write `at`, `action`, and `decision` only. A non-proposer withdraw writes one `rejected` receipt and no `allow` receipt.

**Forbidden**: The warning does not contain an address, a reason string, a cookie, or a secret. The switch log does not contain the name or the enabled value. No live Access call. Provenance still requires the source commits.

## Complexity Tracking

No constitution violation.
