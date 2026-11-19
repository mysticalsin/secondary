# Spec 006: Worker beside state

**Feature Branch**: `cursor/sb-untangle-folder-b165`

**Input**: Tony approved the three larger untangle refactors ("A, all three"). This slice is the folder move. Observable HTTP answers stay as on main `e8e7ef63`.

## What changes

The Worker HTTP tree moves from `recovered-source/worker/src` to `src/worker`, beside `src/state`. Import paths that reached `src/state` or `packages` shorten by one `../`. The internal layout of the Worker stays the same.

These queued notes land in the same slice, without a new answer:

- The switch-table test no longer says the fixture was taken from main.
- The dot-segment assertion is labeled as one the URL parser already collapses.
- An encoded MCP path misses the allowlist.
- Lower case and a trailing slash have unit tests.
- `httpSwitch` requires the switch map. The first-match fallback is gone.
- A malformed percent-encoding that the gate answers 400 still carries `Cache-Control: no-store` when the routed path is under `/v1/`.

## What stays

Status codes, bodies, and who may pass a kill switch stay as on main `e8e7ef63`. The intake archive hash stays. Shared packages stay under `recovered-source/shared`. `internalRouteVerdict` and `isImport` still read the raw pathname.

## Independent test

`npm test` on the head, including the pin committed before the move. Removing the connector refusal turns that pin red.
