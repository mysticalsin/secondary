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

## Loop 2 red output

Command: the same runner, pattern `exactly the admitted|cannot open|2499ms|late resolve|aborts a hung|import one fetch|clears its timer`.

Exit 1. 4 pass, 3 fail. Duration about 4.9s.

```
✖ the graph and the dashboard import one fetch bound
  Error: ENOENT: deploy/graph/fetch-bound.js.txt

✖ the shared fetch bound clears its timer on success and on timeout
  Error: ENOENT: deploy/graph/fetch-bound.js.txt

✖ the tree aborts a hung read
  AssertionError: actual false, expected true
```

That third name overclaimed. The SQL read is not cancelled. The test is now `the wait marks its signal aborted when a brain does not answer`.

`a brain at 2499ms is kept and a brain at 2501ms is degraded` passed on the 2500ms bound. The exact root list, the closed-brain check, and the late-page check passed. The wait did not yet end a read that ignores the signal, and the clients do not share a fetch module.

## Loop 3 red output

The listener that schedules `finish("miss")` was deleted, the file was not committed that way, and this command was run:

```
node --experimental-strip-types --test --test-reporter=spec --test-name-pattern "a read that ignores the signal" harness/tests/src-hardening.test.ts
```

Exit 1. 0 pass, 1 fail. `duration_ms` 1048.896085. The listener was then restored.

```
✖ a read that ignores the signal does not hold the tree (863.256016ms)
  AssertionError [ERR_ASSERTION]: Expected "actual" to be strictly unequal to:

  'hung'
    actual: 'hung'
    expected: 'hung'
    operator: 'notStrictEqual'
```

With the listener restored, the same command passed. The test double never settles and does not read the signal. `wikiPages` still runs to completion. The listener only ends the wait.

## Fix

- Bound each brain inside `brainTree` with `treeBoundMs`, default 2500. A miss becomes `{ access: "degraded" }` and the other brains are still returned.
- Bound `getJson` in the graph and the dashboard at 8000ms, or `dataset.fetchBound` in a test. A timeout sets the status to `Degraded`.
- When any root is `degraded`, the status is `Degraded` and the hung name is added to the brain picker.
