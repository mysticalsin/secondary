# Plan 004: Switch follow-up

`httpSwitch(method, path, switches)` requires the switch map and calls `blockingSwitch`, which returns the first matching row whose switch is off. There is no first-match fallback. `switchGate` passes the session switches.

Probes live on the HTTP rows in `SWITCH_TABLE`. The disjoint test walks those probes. The handler-key test names all eight keys.

The matrix gains the extra paths and records whatever `switchGate` answers today. The original 228 rows are compared against the fixture from `8c2ede3` and none of them change.

Full `npm test`, both typechecks, and provenance wait until this branch is asked to run them.
