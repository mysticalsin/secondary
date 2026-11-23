# Plan: dashboard edges stay in the open brain

SB-DASH-EDGE-FILTER-FOLLOWUP. The account link set, the mention count, and the Risks card use `sameBrainEdges`. `fillBrainPicker` is the same function in the graph and the dashboard, and it keeps only `Option` nodes. Changing the graph brain calls `select(null)`.

## Security and data

The dashboard reads pages the caller can already open. A `global:` link to another brain is not counted and is not drawn on the account row, the mention count, or the Risks card. The picker stores a brain id the directory or the tree already returned. Nothing is written. No principal id, page body, or claim key is added to a log.

## Test

```
node --experimental-strip-types --test --test-reporter=spec --test-timeout=15000 harness/tests/dash-edge-filter.test.ts
```

Red commit `288967228e5a8d2908872dc3ee3f6413b7cff7f8`. The account filter was missing, and `fillBrainPicker` was missing.
