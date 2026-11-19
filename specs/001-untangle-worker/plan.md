# Implementation Plan: One deny-receipt warning

**Branch**: `cursor/sb-untangle-b165` | **Date**: 2026-11-19 | **Spec**: `specs/001-untangle-worker/spec.md`

**Input**: Recommended first slice in `specs/001-untangle-worker/decision-log.md`. Not started.

## Summary

Replace the four copied deny warnings with one function. Keep 403. Leave switch-off, fail-closed 503, lead checks, and the email fold alone.

## Technical Context

**Language/Version**: TypeScript 5.9, Node 22

**Primary Dependencies**: Existing Worker and `src/state`. No new package.

**Storage**: None. No migration.

**Testing**: `npm test`

**Target Platform**: Recovered API Worker under the Node harness

**Project Type**: Worker plus `src/state`

**Performance Goals**: None. One log line on a failed deny.

**Constraints**: No deploy. No force push. No behavior change beyond sharing the warning. Provenance stays an online check and still exits 1 when the source commits are absent.

**Scale/Scope**: Four call sites and the tests that already search the warning string.

## Constitution Check

- Principle I: one warning function. No new framework.
- Principle IV: no shim and no `any`.
- Principle V: a later implementation starts with a failing test. This commit is docs only.
- Principle VI: Security & data is below.
- Principle VII: `cursor/sb-untangle-b165` only. Not `main`. Not `cursor/recover-v24-deploy-1c66`.
- Principle X: this plan does not merge or deploy.

No unjustified violation. Re-check after implementation, which is not this phase.

## Project Structure

```text
specs/001-untangle-worker/decision-log.md
specs/001-untangle-worker/spec.md
specs/001-untangle-worker/plan.md
specs/001-untangle-worker/tasks.md
recovered-source/worker/src/ux/util.ts
recovered-source/worker/src/admin/routes.ts
recovered-source/worker/src/routes.ts
recovered-source/worker/src/uxv2/questions.ts
```

`ux/util.ts` already exports `audit`. The warning belongs next to it only if that does not force `routes.ts` to import a module it does not already reach. [NEEDS CLARIFICATION: home of the function if `routes.ts` cannot import `ux/util.ts` without a cycle.]

## Security & data

**Read**: The action name already passed into the deny. No new read.

**Written**: The same warning the four sites write today, from one function.

**Forbidden**: No address, no reason text, no cookie, no secret, no switch status in this warning. No change to who is denied.

## What this plan does not do

Lead-role data, switch route lists, moving the Worker next to `src/state`, comment deletion, and test deletion. Those are owner decisions in the decision log.

## Complexity Tracking

No constitution violation.
