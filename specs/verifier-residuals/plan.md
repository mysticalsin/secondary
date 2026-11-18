# Implementation Plan: Verifier residuals

**Branch**: `cursor/sb-full-fix-b165` | **Date**: 2026-11-18 | **Spec**: `specs/verifier-residuals/spec.md`

## Summary

ASCII-only lowercase in `normalEmail`. The patch fold guard matches create. Readiness catches a missing binding and the route stays 503. Unknown switch names log once per name per isolate. A login past 600 seconds is rejected and deleted. The QA shell moves to `cursor/sb-full-fix-qa-b165`.

## Technical Context

**Language/Version**: TypeScript 5.9.3, Node 22.18 or newer

**Primary Dependencies**: Existing packages. No new package.

**Storage**: Existing SQLite. No migration.

**Testing**: `npm test`

**Target Platform**: Recovered API Worker under the Node harness

**Project Type**: Recovered Worker plus `src/state` and harness tests

**Performance Goals**: None. These paths already run once per sign-in, patch, ready check, or switch read.

**Constraints**: No deploy, no force push, no push to `main`. Provenance check stays as written. L2 is not edited.

**Scale/Scope**: `src/state/actor.ts`, `auth/identity-store.ts` patch guard, `observe.ts` readiness, `tenant-policy.ts` switch log, harness tests, README. QA files leave this branch.

## Constitution Check

- Principle I: one behavior per code commit.
- Principle IV: no shim and no `any`.
- Principle V: F-1, D3, and F-5 start red. L1 is committed on its own.
- Principle VI: Security & data is below.
- Principle VII: fix branch `cursor/sb-full-fix-b165`. QA branch `cursor/sb-full-fix-qa-b165`. Fast-forward only.
- Principle X: no merge and no deploy.

## Project Structure

```text
src/state/actor.ts
recovered-source/worker/src/auth/identity-store.ts
recovered-source/worker/src/observe.ts
recovered-source/worker/src/tenant-policy.ts
harness/tests/email-identity.test.ts
harness/tests/kill-switch.test.ts
harness/tests/local-boot.test.ts
harness/tests/oidc-login.test.ts
README.md
```

## Security & data

**Read**: Sign-in address, stored email, switch name and enabled flag, login row expiry, binding presence.

**Written**: A non-matching sign-in may insert a new principal with the original address. An invalid patch writes nothing. An expired login row is deleted. Switch read writes nothing. Readiness writes nothing.

**Forbidden**: The log line does not contain the switch name, the enabled value, the address, the cookie state, or a secret. No live Access call. Provenance still requires the source commits and is not stubbed for offline use.

## Complexity Tracking

No constitution exception. The QA file move is a branch split, not a product refactor.
