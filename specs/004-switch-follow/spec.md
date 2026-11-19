# Spec 004: Switch follow-up

**Input**: After PR #9 merged, Inspector L-1 and Sentinel asked for three additions. Observable answers for today's disjoint rows stay as on main `8c2ede3`.

## What changes

- `switchGate` refuses when any matching HTTP row's switch is off, including a row that sits after one that is on.
- Each HTTP row carries the probes the disjoint test walks. A probe matches exactly that row.
- Every handler key (`submitCandidate`, `routineRun`, `routineIngest`, `briefSave`, `aiCall`, `sourceSearch`, `wikiSource`, `sharepoint`) resolves to a table row.
- Extra fixture paths pin the current matcher: trailing slash, letter case, percent-encoding, a double slash, a query string, HEAD, OPTIONS, `/v1x`, and `/v10`. Those matchers do not change in this slice.

## What stays

The 228 rows from main `8d8ab548` keep the same status and body. Search still omits connector hits. Sharepoint still returns `{ error: "switched_off" }` without a switch name. Routine ingest still returns the reason string. `gate()` still returns `ai_disabled`. Wiki ingest still reads the tenant switch with no session.

## Independent test

`harness/tests/switch-handler.test.ts` and `harness/tests/switch-table.test.ts`. Removing `sharepoint` from its row fails only the handler-key test. Making the `ai` matcher also match `/v1/sources/` fails only the disjoint test.
