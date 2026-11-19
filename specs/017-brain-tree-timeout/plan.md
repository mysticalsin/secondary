# Plan 017 — Brain tree timeout

## Test command

```
node --experimental-strip-types --test --test-reporter=spec --test-name-pattern "hung brain|hung tree|degraded brain" harness/tests/brain-tree-timeout.test.ts harness/tests/src-hardening.test.ts
```

## Red output

Exit 1. 3 fail, 0 pass. Duration 960.778045ms.

```
✖ a hung tree fetch leaves the graph and the dashboard degraded (841.527684ms)
✖ a degraded brain is visible and the loading line is gone (31.49456ms)
✖ one hung brain does not stall the tree (820.478875ms)

test at harness/tests/brain-tree-timeout.test.ts:171:1
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + 'Loading your second brain…'
  - 'Degraded'

test at harness/tests/brain-tree-timeout.test.ts:193:1
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + 'Ready.'
  - 'Degraded'

test at harness/tests/src-hardening.test.ts:386:1
  AssertionError [ERR_ASSERTION]: Expected "actual" to be strictly unequal to: 'hung'
```

The tree handler never returns while one workspace's `wikiPages` is pending. The graph stays on `Loading your second brain…` when that fetch does not return. A tree that already marks a brain `degraded` is rendered as `Ready.`

## Fix

- Bound each brain inside `brainTree` with `treeBoundMs`, default 2500. A miss becomes `{ access: "degraded" }` and the other brains are still returned.
- Bound `getJson` in the graph and the dashboard at 8000ms, or `dataset.fetchBound` in a test. A timeout sets the status to `Degraded`.
- When any root is `degraded`, the status is `Degraded` and the hung name is added to the brain picker.
