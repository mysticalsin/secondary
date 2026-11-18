# Implementation Plan: In-brain lead decisions

**Branch**: `cursor/sb-full-fix-b165` | **Date**: 2026-11-18 | **Spec**: `specs/lead-decide/spec.md`

## Summary

`mayDecide` allows a standing `review`, `edit`, or `approve_release` grant on that node. A right that appears only under elevation does not count. The approve route passes the proposal author, and that author is denied.

## Technical Context

**Language/Version**: TypeScript 5.9.3, Node 22

**Primary Dependencies**: Existing packages. No new package.

**Storage**: None. No migration.

**Testing**: `npm test`

**Target Platform**: Recovered API Worker under the Node harness

**Project Type**: `wiki/review.ts`, `wiki/routes.ts`, one harness test

**Performance Goals**: None. One extra grant check per decision.

**Constraints**: No deploy, no force push, no push to `main`. Provenance stays as written.

**Scale/Scope**: The decision function and the approve call that passes the author.

## Constitution Check

- Principle I: one behavior.
- Principle V: the red test fails before the production edit.
- Principle VI: Security & data is below.
- Principle VII: `cursor/sb-full-fix-b165`. Fast-forward only.

## Security & data

**Read**: The caller's roles, the node id, and, on approve, the proposal's `authorId`.

**Written**: Nothing in this change. An allowed approve still follows the existing decide path.

**Forbidden**: No address, no proposal body, and no secret in a new log line. This change adds no log line.

## Complexity Tracking

No constitution violation.
