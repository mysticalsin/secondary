# Implementation Plan: Lead from the role grant

**Branch**: `cursor/sb-untangle-lead-b165` | **Date**: 2026-11-19 | **Spec**: `specs/002-lead-from-grants/spec.md`

**Input**: Tony, via Jarvis, 01:16 BRT: the three larger refactors, "A, all three". This plan is the lead slice only.

## Summary

Mark the two `acme_lead` grants that already confer a decision with `conditions.lead`. `mayDecide` allows a lead when one of those grants covers the node and a standing `edit`, `review`, or `manage_members` check passes. Delete `LEAD_ROLES`. `directPublish` calls `mayDecide` and stops reading `can.decide`. The stored edit check at the end of `directPublish` stays.

## Technical Context

**Language/Version**: TypeScript 5.9, Node 22

**Primary Dependencies**: Existing policy role table and `mayDecide`. No new package.

**Storage**: None. No migration.

**Testing**: `npm test`

**Target Platform**: Recovered API Worker under the Node harness

**Project Type**: Worker plus `packages/policy` role data

**Performance Goals**: None. The lead check walks the caller's own grants.

**Constraints**: No deploy. No force push. No behaviour change for the pinned cases. Provenance stays an online check.

**Scale/Scope**: `roles.ts` two grants, `wiki/review.ts` `mayDecide`, `brains/open.ts` `directPublish`, one new test. `can.decide` stays on the brain object for the screen.

## Constitution Check

- Principle I: one condition on the grants that already decide. No new framework.
- Principle IV: no shim and no `any`. `conditions.lead` is the grant's existing condition map. The engine ignores unknown keys.
- Principle V: a failing test before the production edit.
- Principle VI: Security & data is below.
- Principle VII: `cursor/sb-untangle-lead-b165` only. Not `main`. Not `cursor/sb-untangle-b165` after the branch point.
- Principle X: this plan does not merge or deploy.

No unjustified violation.

## Project Structure

```text
specs/002-lead-from-grants/spec.md
specs/002-lead-from-grants/plan.md
specs/002-lead-from-grants/tasks.md
packages/policy/src/roles.ts
recovered-source/worker/src/wiki/review.ts
recovered-source/worker/src/brains/open.ts
harness/tests/lead-from-grants.test.ts
```

`packages` is the symlink to `recovered-source/shared/packages`. The role file's intake path is `recovered-source/shared/packages/policy/src/roles.ts`. It joins `PATCHED_RECOVERED` when the grants change.

## Security & data

**Read**: The caller's role ids and the tenant role grants already on the admitted view. The proposal author id and alias ids already passed into `mayDecide`. The stored brain role already loaded for that brain.

**Written**: Nothing. No receipt field changes. The decision reason stays "Lead of this brain" or the existing refusal text.

**Forbidden**: No address, no proposal body, and no secret in the decision. Elevation is not a lead. The author is not a lead of their own proposal. `can.decide` is not a second authority for publish.

## What this plan does not do

The switch route table, the `recovered-source` / `src/state` move, and deleting restate-only comments or tests that cannot fail. Tony approved those as their own slices.

## Complexity Tracking

No constitution violation.
