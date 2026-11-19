# Implementation Plan: Open low fixes

**Branch**: `cursor/sb-full-fix-b165` | **Date**: 2026-11-18 | **Spec**: `specs/open-low-fixes/spec.md`

**Input**: Feature specification from `/specs/open-low-fixes/spec.md`

## Summary

Three local edits. The login callback takes only the cookie state's row. SCIM user-name reads and the create/patch uniqueness check use `normalizedEmailSql` and `normalEmail`, and create checks that before `ensurePrincipal`. `switchState` logs one `unknown_name` when a stored name is not a switch. Each edit is a red test commit, then a code commit.

## Technical Context

**Language/Version**: TypeScript 5.9.3, Node 22.18 or newer

**Primary Dependencies**: Existing `hono`, `jose`, `zod`, `@openuidev/lang-core`. No new package.

**Storage**: Existing SQLite tables `login_state`, `scim_users`, `principals`, `switches`. No migration.

**Testing**: `node --experimental-strip-types --test` via `npm test`

**Target Platform**: The recovered API Worker, exercised in the Node harness

**Project Type**: Recovered Worker plus `src/state` and `harness/tests`

**Performance Goals**: None. These paths already run once per callback, create, list, patch, or switch read.

**Constraints**: No deploy, no force push, no hook bypass, no push to `main`, no secret values in git or logs, no edit under `deploy/assets` (that tree is not on this branch). Recovered files stay in `PATCHED_RECOVERED`. `candidate-manifest.json` stays byte-identical.

**Scale/Scope**: Three recovered files. Three test files. The state-machine table rows for machines 33, 34, and 36.

## Constitution Check

*GATE: Must pass before implementation. Re-check after implementation.*

- Principle I: each commit is one of the three behaviors, or the spec, or the status record. No new framework.
- Principle II: no helper text in the product. The log line is the existing `illegal_transition` object.
- Principle III: the fold stays `normalEmail` / `normalizedEmailSql` in `src/state/actor.ts`. No second copy.
- Principle IV: no shim, no `any`, no `@ts-ignore`. Items that need a refactor are not in this plan.
- Principle V: each behavior starts as a failing test on the parent.
- Principle VI: the Security & data section below is present.
- Principle VII: branch `cursor/sb-full-fix-b165`. Fast-forward push only. Not `main`.
- Principle VIII: the writer runs the gates and does not grade an independent QA pass. `qa/FULL-QA-PLAN.md` is the handoff.
- Principle IX: no CI file is added. Main has no CI to extend.
- Principle X: no merge and no deploy.
- Spec Kit v1.4.0 templates are the ones already in `.specify/templates/`. The analyze definition was fetched from tag `v1.4.0`.
- Passing tests are not deleted. Parent count is 416.

## Project Structure

### Documentation

```text
specs/open-low-fixes/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/identity-boundary.md
├── checklists/requirements.md
└── tasks.md
```

### Source

```text
recovered-source/worker/src/auth/routes.ts          # FR-001..FR-004
recovered-source/worker/src/auth/identity-store.ts  # FR-005..FR-009
recovered-source/worker/src/tenant-policy.ts        # FR-010
harness/tests/oidc-login.test.ts
harness/tests/email-identity.test.ts
harness/tests/kill-switch.test.ts
docs/state-machines.md
```

**Structure Decision**: The behavior stays in the recovered modules that already own it. Tests stay in the harness files that already drive those modules.

## Implementation phases

1. Spec and this plan, before any test or recovered edit.
2. Login red test, then the callback edit.
3. SCIM red test, then the identity-store edit.
4. Switch red test, then the `switchState` edit.
5. Mark machines 33, 34, and 36 fixed in `docs/state-machines.md`. Point `RECOVERY.md`'s next-step paragraph at the typecheck closeout so the intake's 119 count is not read as an open gate.
6. Gates on the final head: `npm test`, both typechecks, `npm run verify:provenance`.

## Complexity Tracking

No constitution violation requires a justification table. The three edits are the smallest change that meets the spec.

## Security & data

**Read**

- Login callback reads the cookie state and the query (`state`, `code`, `error`). It hashes the cookie state to select one `login_state` row. It does not hash the query state.
- SCIM create, patch, list, and managed sign-in read `user_name` through `normalizedEmailSql` and the caller's user name through `normalEmail`.
- `switchState` reads `switches.name` and `switches.enabled`. The enabled value is used only for known names.

**Written**

- The callback deletes the cookie's login row when the cookie is present and the login-record effect is `take`. It does not delete any other login row.
- Create inserts a principal only after the folded user name is free. A conflicting create writes nothing.
- A refused patch writes neither `user_name` nor `email`. An allowed case-only rename of the same row writes the trimmed lowercase user name, which is the write create and patch already perform.
- Managed sign-in may set `principals.subject` on the matched principal. It does not insert a principal on the matched path or on `not_provisioned`.
- `switchState` writes nothing. It logs one reason code.

**Forbidden**

- Secret values, the pseudonym key, the cookie state, the query state, the code, the nonce, the verifier, a switch name, and an enabled value are not written into the new or changed log lines.
- No live Cloudflare Access call, no tunnel, no deploy, no `deploy/assets` edit.
- Stored emails are not rewritten by the compare. Machine 35 is not given a second fold.
