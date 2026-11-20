# Plan 019 — Brain tree in-flight cap

Ticket: SB-BRAIN-TREE-INFLIGHT-CAP

Risk: MEDIUM-HIGH. Server concurrency in `src/worker/uxv2/tree.ts`. A shared filtered tree would cross an ACL boundary. This phase is the plan and the red tests. The tree handler is not changed.

## Test command

From the repository root:

```
node --experimental-strip-types --test --test-reporter=spec --test-timeout=15000 --test-name-pattern "pending read|new read|different ACLs|rejected read|2499ms is kept|do not carry the principal|not admitted|does not collide|new page is present|late settle|65th scope|waitUntil" harness/tests/brain-tree-inflight-cap.test.ts harness/tests/brain-tree-inflight-runtime.test.ts harness/tests/src-hardening.test.ts
```

Timing cases use the mock clock, except the Miniflare proof, which uses workerd's own scheduler and a 1500ms join deadline. No real 2500ms sleep.

## a1. Raw read signatures

`wikiSchema` takes no arguments:

```436:439:src/worker/wiki/store.ts
  wikiSchema(): WikiSchema {
    const r = this.sql.exec("SELECT body FROM wiki_schema WHERE id = 1").toArray()[0];
    return r ? (JSON.parse(r.body as string) as WikiSchema) : DEFAULT_SCHEMA;
  }
```

`wikiPages` takes no arguments:

```816:825:src/worker/wiki/store.ts
  /** Published pages with their text. At most MAX_PAGES_LOADED are read into memory in one call (M-03). */
  wikiPages(): PageRow[] {
    return this.sql
      .exec(
        "SELECT * FROM wiki_pages WHERE status = 'published' ORDER BY id LIMIT ?",
        MAX_PAGES_LOADED,
      )
```

The SQL runs on `this`, the workspace Durable Object. The caller selects that object with `stubOf(c, scope)` before the call. The method list has no principal id, no user token, no row-level session, and no caller header. `brainTree` calls `readPages(signal)` and `stub.wikiSchema()` with the signal only on the test double. The production method ignores it.

`wikiPages and wikiSchema arguments do not carry the principal` records the arguments of an injected read for two principals and requires those argument lists to be identical and empty.

## a2. Admission before a join

`admittedWikis` drops a workspace the view does not open. A locked or absent brain is not passed to `wikiPages`. The join of a pending raw read has to sit after that check. A caller who fails it gets the locked or absent card and must not wait on the shared promise.

`a caller who is not admitted does not join the pending read` starts a hung `c_delivery` read, then requests the tree as a caller whose only membership is `c_eng`. The response returns while the hung read is still pending, and the `c_delivery` read count stays 1.

## a3. Structured key

The key is `JSON.stringify([tenantId, scope])`, or a nested `Map` of tenant then scope. It is not string concatenation. `"a:b" + ":" + "c"` and `"a" + ":" + "b:c"` are both `"a:b:c"`. `JSON.stringify(["a:b","c"])` and `JSON.stringify(["a","b:c"])` differ.

`structured inflight key does not collide` locks that difference. It also fails until `tree.ts` contains `JSON.stringify([tenantId, scope])`, because the handler does not have the key yet.

## a4. Read your writes

Any workspace write, and any change to the caller's admission, deletes the pending entry for that tenant and scope. The next request starts a new raw read. A write that lands in the workspace after a request has already read the old pages is visible on the next tree request.

`a workspace write drops the pending read and the new page is present` changes the stub's page list while a read is in flight and requires the following request to show `Written page`.

## b. Mutants the green guards kill

These three pass on the unchanged handler. Each one has a mutant the implementation must keep failing.

- `a rejected read is not reused`. Mutant: store the rejected promise and return it to the next request. The next `c_delivery` card stays `degraded` and the read count stays 1. The test requires `access: "full"` and a second read.
- `after the unsettled TTL a new read starts`. Mutant: a pending entry never expires. After 30_000ms the next request still joins the first promise, so the read count stays 1. The test requires 2.
- `a brain at 2499ms is kept and a brain at 2501ms is degraded`. Mutant: the bound is off by one, 2499 degraded or 2501 kept. The existing mock-clock test fails that.

Mutant: cache the filtered tree under the same tenant and scope key. `two users with different ACLs never receive each other's filtered pages` fails because the narrower caller receives `Secret page`, not because the read count is wrong. The content assertions run before the count assertion. On this handler the pages already differ and the count is `2 !== 1`.

## c1. Compare-and-delete

Settle deletes the map entry only when the entry is still this promise. A TTL expiry that already replaced it must keep the replacement.

`a late settle does not replace the read started after the TTL` is on the mock clock. A joiner before the TTL must not start a second read. After 30_000ms a new read starts and returns `Second page`. The first promise then resolves to `First page` and must not become the second response.

## c2. Lazy TTL and the cap

TTL is checked when a request looks up the key. There is no `setTimeout` per entry.

The map holds at most 64 unsettled entries. The 65th scope evicts the oldest. The evicted promise is not handed out again. A later request for that scope starts a new read.

`the 65th scope evicts the oldest unsettled read` admits 65 hung circles across two callers, because one tree read stops at the fanout of 40. It requires the pending `c_cap_*` count to be at most 64.

## c3. Runtime

The runtime is workerd, via Cloudflare Workers. Wrangler 4.158.0 and Miniflare 5.20261104.0-beta are the local runtime. `src/worker/index.ts` is the worker entry. `c.executionCtx.waitUntil` is already used in `src/worker/agent/index.ts`.

A promise that performs cache I/O does not finish for a second request if the first request returned without `waitUntil`. The joiner waits until the test deadline. The same promise, passed to `ctx.waitUntil` before the first response, resolves for the joiner after the first response has already been returned: `200 joined:read`. A second Miniflare instance does not see the first instance's promise (`missing`).

The raw read therefore has to be registered with `c.executionCtx.waitUntil` before `GET /v1/brain/tree` returns the 2500ms `degraded` card. The joiner awaits that promise for its value. The I/O stays on the originator's context.

The map is module state in one isolate. Isolates do not share memory. L-1 protection is one pending raw read per tenant and scope per isolate. A reload loop that stays on that isolate collapses onto one read. A different isolate, or a different machine, starts its own read. This does not cap the fleet.

`a joiner sees the raw read after the originator returns only when waitUntil holds it` is the local Miniflare proof. It uses `dispatchFetch` only. It does not open a public URL and it does not deploy.

## c4. Mock clock

The 2499ms bound, the TTL, the settle, and the late-settle cases advance `t.mock.timers`. They are run 50 times at the default node test workers. The Miniflare proof is the exception: workerd's scheduler is the clock, and the negative case is a 1500ms deadline so a cancelled read cannot hang the suite.

## d. Red on this head

Recorded below for the rebased head. The handler is still one read per request.

## Approach

Share one in-flight raw read per tenant and scope. The raw read is `wikiPages` plus `wikiSchema`, held with `waitUntil`. Each request still runs `readableMany`, `pageVisible`, and `filterMarkdown` on its own view. A 2500ms miss is still `degraded` for that request only.

## Alternatives

- Cap concurrent tree requests per user. One reload loop stops. Many users on one hung workspace do not. Rejected as the answer to L-1.
- Cache the filtered tree. A wrong key shows one person another person's pages. Rejected. The ACL test kills it on `Secret page`.

## Rollback

Revert this branch. No data migration. The route goes back to one read per request.

## Decision record draft

Choice: share the raw workspace read, not the filtered tree. Key: `JSON.stringify([tenantId, scope])`. Delete on settle only if the map still holds that promise. Lazy TTL of 30_000ms. Cap 64 unsettled entries, oldest evicted and never reused. Hold the raw read with `waitUntil`. The cap is per isolate. L-1 then means one pending read per workspace on that isolate, not one pending read for the whole service.

Not chosen: a per-user semaphore, a filtered-tree cache, and a concatenated string key.

This draft is not an agreement. A non-author reviews it before any handler change.

## Red output

Command: the test command above, on this head, handler unchanged. Exit 1. 7 pass, 6 fail. `duration_ms` 3582.093329.

```
✖ n concurrent tree requests for one hung brain share one pending read
  4 !== 1

✖ after settle a new read starts
  2 !== 1

✔ after the unsettled TTL a new read starts

✖ two users with different ACLs never receive each other's filtered pages
  2 !== 1
  The Secret page assertions pass first. The narrower caller does not receive Secret page.

✔ a rejected read is not reused

✔ wikiPages and wikiSchema arguments do not carry the principal

✔ a caller who is not admitted does not join the pending read

✖ structured inflight key does not collide
  JSON.stringify(["a:b","c"]) differs and colon concatenation collides.
  tree.ts does not yet contain JSON.stringify([tenantId, scope]): false !== true

✔ a workspace write drops the pending read and the new page is present

✖ a late settle does not replace the read started after the TTL
  2 !== 1

✖ the 65th scope evicts the oldest unsettled read
  pending 65 is not capped

✔ a joiner sees the raw read after the originator returns only when waitUntil holds it
  without waitUntil the joiner hits the 1500ms deadline
  with waitUntil the joiner gets 200 joined:read after the first response
  a second Miniflare isolate gets missing

✔ a brain at 2499ms is kept and a brain at 2501ms is degraded
```

Mock-clock timing cases `2499ms is kept` and `unsettled TTL`, 50 of 50 at the default node test workers.

A local stand-in that served the first caller's body to the second caller failed `two users with different ACLs` on `Secret page`: actual true, expected false. That stand-in was not committed.
