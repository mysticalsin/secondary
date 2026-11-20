# Plan 018 — Degraded brain picker

Client scripts only. `deploy/graph/dashboard.js.txt` and `deploy/graph/app.js.txt`.

Expected end-to-end: 2500ms. The two requests overlap, so a hung brain is bounded by one 2500ms server wait. The 8000ms `boundFetch` stays and is not the bound that ends this case. Inspector's sequential measurement was 5.1–5.2s.

## Red

TEST COMMAND:

```
node --experimental-strip-types --test --test-reporter=spec --test-name-pattern "exactly once|one server bound|no empty-state copy" harness/tests/brain-tree-degraded-ux.test.ts
```

Exit 1. 0 pass, 3 fail. `duration_ms` 273.185939.

```
✖ a degraded brain is listed exactly once when the directory already has it
  actual: [ 'me', 'c_delivery', 'c_delivery' ]
  expected: [ 'me', 'c_delivery' ]

✖ tree and brains overlap so Degraded lands on one server bound
  AssertionError: dashboard 5000

✖ a degraded brain shows no empty-state copy
  true !== false
```

The directory double lists Delivery as `unavailable: true`, and the picker appends it again. The fake clock, repeated 50 times, reaches `Degraded` at 5000ms because the two 2500ms waits run one after the other. Choosing Delivery still renders the empty-state sentence.

## Green

The same fake clock, 50 runs on each client, reaches `Degraded` at 2500ms. That is one server bound. The 8000ms `boundFetch` is unchanged.
