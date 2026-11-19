# Implementation Plan: One switch table

**Branch**: `cursor/sb-untangle-switch-b165` | **Date**: 2026-11-19 | **Spec**: `specs/003-switch-table/spec.md`

**Input**: Tony, via Jarvis: the three larger refactors, "A, all three". This plan is the switch table only.

## Summary

Move the kill-switch route list into one table. `switchGate` and the handlers that re-check a switch read that table. Path matchers, status codes, and response bodies stay as they are.

## Technical Context

**Language/Version**: TypeScript 5.9, Node 22

**Primary Dependencies**: Existing Worker. No new package.

**Storage**: None. No migration.

**Testing**: `npm test`. A matrix generated from main `8d8ab548`.

**Target Platform**: Recovered API Worker under the Node harness

**Project Type**: Worker

**Performance Goals**: None. The table is a short list walked once per request.

**Constraints**: No deploy. No force push. No behaviour change. Provenance stays an online check.

**Scale/Scope**: The four switches, the current middleware matchers, and the handler re-checks that already use those names.

## Constitution Check

- Principle I: one table in the existing switch module. No new framework.
- Principle IV: no shim and no `any`.
- Principle V: the matrix is pinned to main before the table moves.
- Principle VI: Security & data is below.
- Principle VII: `cursor/sb-untangle-switch-b165` only. Not `main`.
- Principle X: this plan does not merge or deploy.

No unjustified violation.

## Project Structure

```text
specs/003-switch-table/spec.md
specs/003-switch-table/plan.md
specs/003-switch-table/tasks.md
recovered-source/worker/src/switches.ts
recovered-source/worker/src/ops-admin.ts
```

Handlers that re-check a switch import the table's handler key. `wiki/engine.ts` stays, because the ingest job has no session.

## Security & data

**Read**: The session's switch flags, the request method, and the request path. The wiki job still reads the tenant switch record.

**Written**: Nothing. The off response stays `{ error: "switched_off", switch }` where that body is already used. No address, no secret, and no switch value other than the name.

**Forbidden**: No change to which path is blocked, which status is returned, or which body is returned. No change to the personal-target exemption. No change to `ai_disabled` versus `switched_off`.

## What this plan does not do

It does not turn search omissions, routine reason strings, or `gate()` refusals into the middleware 503. Those are different answers. It does not move the Worker next to `src/state`.

## Complexity Tracking

No constitution violation.
