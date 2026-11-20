# Plan 019 — Brain tree in-flight cap

Ticket: SB-BRAIN-TREE-INFLIGHT-CAP

Risk: HIGH. Server concurrency in `src/worker/uxv2/tree.ts`. A shared filtered tree would cross an ACL boundary. A log of `err.message` would leak a page title. The handler shares one raw read per tenant and scope. `inflightKey` is the exported key builder.

## Plan debate

"Devin: AGREED, conditional. (1) a2 'not admitted' and a4 'new page is present' are regression guards, not red-first tests, and the plan must label them that way. The build commit must kill two named mutants: join-before-admission, where a request over the cap joins anyway, and no-delete-on-write, where a write leaves the in-flight entry. (2) The a3 source-text check is not accepted. Replace it with a behavioral collision test against the real exported key builder: tenant 'a:b' with scope 'c' versus tenant 'a' with scope 'b:c', plus scope '[\"x\"]' cases, must give distinct keys and distinct in-flight entries. The concat-key mutant must fail. (3) Section (b) lists every mutant by name, each with the test that kills it and the build commit that kills it. Add: drop ctx.waitUntil (the joiner misses the 1500ms deadline), share the filtered body instead of the raw read, cap off by one (64 or 66), TTL never expires, and the key without tenantId. (4) ACL: since wikiSchema and wikiPages take no principal, the raw read may be shared only if ACL filtering runs per request after the join. You need a test where two principals in the same tenant with different ACLs join one read and each gets only its own pages ('Secret page' absent for the low principal). The filtered-body-leak stand-in becomes a named mutant. (5) The waitUntil read is bounded: one timeout, and a rejection is caught and logged with no unhandled rejection, tested in Miniflare. The workerd/Miniflare join test (200 joined:read) and the per-isolate result are in the TEST COMMAND, not just the mock clock. (6) The decision record states that the cap is per isolate and does not protect the whole fleet, and rollback is a revert. (7) Every timing test (2499/2500ms, unsettled TTL, the Miniflare join) runs 50/50 at the default worker count on the build head. The final AGREED binds to my exact-head verifier PASS on the build head that carries (1) through (7), plus Sentinel's line and Inspector's."

Sentinel: AGREED with conditions C-A to C-G. Not merge approval.

## Test command

From the repository root:

```
node --experimental-strip-types --test --test-reporter=spec --test-timeout=15000 --test-name-pattern "pending read|new read|different ACLs|rejected read|2499ms is kept|do not carry the principal|not admitted|does not collide|new page is present|late settle|65th scope|waitUntil|frozen|error string|executionCtx|drops the in-flight" harness/tests/brain-tree-inflight-cap.test.ts harness/tests/brain-tree-inflight-runtime.test.ts harness/tests/src-hardening.test.ts
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

Regression guard, not a red-first test. The handler already skips a workspace the view does not open, so this passes before the cap exists.

`admittedWikis` drops a workspace the view does not open. A locked or absent brain is not passed to `wikiPages`. The join of a pending raw read has to sit after that check. A caller who fails it returns while the pending read is still open, and the read count does not change.

`a caller who is not admitted does not join the pending read` hangs `c_private` for a member, then requests the tree as a caller who is not a member. The response returns, and the `c_private` read count stays 1.

The build commit `share the raw tree read` must kill the mutant `join-before-admission`: a request that is over the cap, or not admitted, joins the pending entry anyway. This guard fails that mutant.

## a3. Structured key

`inflightKey(tenantId, scope)` is exported from `src/worker/uxv2/tree.ts` and returns `JSON.stringify([tenantId, scope])`. The test calls that function. It does not read the source file.

`structured inflight key does not collide` checks tenant `a:b` with scope `c` against tenant `a` with scope `b:c`, and the scope `["x"]` cases against scope `x` and tenant `["x"]`. The four keys are distinct Map entries. The mutant `concat-key`, `tenantId + ":" + scope`, makes the first pair one entry. The build commit `export the structured inflight key` is this function. A key that omits `tenantId` is the mutant `key-without-tenant`.

`two users with different ACLs never receive each other's filtered pages` also asserts the two response bodies are not equal.

## a4. Read your writes

Regression guard, not a red-first test. A later request already starts a new read, so the new page is present before the cap exists.

Any workspace write, and any change to the caller's admission, deletes the pending entry for that tenant and scope. The next request starts a new raw read.

`a workspace write drops the pending read and the new page is present` changes the page list and requires `Written page` on the next tree.

The build commit `share the raw tree read` must kill the mutant `no-delete-on-write`: the write leaves the in-flight entry, and the next request still shows `Old page`.

## b. Mutants

The build commit named here is the commit that adds the cap. It is not this plan commit. Each row is the mutant name, the test that kills it, and that build commit.

| Mutant | Test that kills it | Build commit |
|---|---|---|
| `reused-stored-rejection` | `a rejected read is not reused` | `share the raw tree read` |
| `ttl-never-expires` | `after the unsettled TTL a new read starts` | `share the raw tree read` |
| `bound-off-by-one` | `a brain at 2499ms is kept and a brain at 2501ms is degraded` | `share the raw tree read` |
| `join-before-admission` | `a caller who is not admitted does not join the pending read` | `share the raw tree read` |
| `no-delete-on-write` | `a workspace write drops the pending read and the new page is present` | `share the raw tree read` |
| `concat-key` | `structured inflight key does not collide` | `export the structured inflight key` |
| `key-without-tenant` | `structured inflight key does not collide` | `export the structured inflight key` |
| `drop-ctx-waitUntil` | `a joiner sees the raw read after the originator returns only when waitUntil holds it` | `share the raw tree read` |
| `filtered-body-leak` | `two users with different ACLs never receive each other's filtered pages` | `share the raw tree read` |
| `cap-off-by-one` | `the 65th scope does not start a second read of a hung scope` | `share the raw tree read` |
| `no-freeze` | `settled pages and schema are frozen against in-place mutation` | `share the raw tree read` |
| `evict-oldest` | `the 65th scope does not start a second read of a hung scope` | `share the raw tree read` |
| `log-leaks-message` | `a read error string is absent from the response and the log` | `share the raw tree read` |
| `missing-executionCtx-throws` | `a missing executionCtx does not share and does not throw` | `share the raw tree read` |

`drop-ctx-waitUntil` makes the joiner miss the 1500ms deadline. `filtered-body-leak` shares the filtered body, so the low principal receives `Secret page`. `cap-off-by-one` stores 63 or 65 scopes: the 64th stored scope then starts a second running read, or the 65th scope does not. `evict-oldest` drops the oldest hung read to make room, and that scope's running `wikiPages` count becomes 2. `no-freeze` leaves the shared page and schema objects mutable. `log-leaks-message` puts `err.message`, a tenant, a scope, a principal id, or a title on the log line. `missing-executionCtx-throws` throws when `c.executionCtx` is absent, or shares that request. `key-without-tenant` drops `tenantId` from the key, so two tenants with the same scope share an entry.

`each write and ACL change drops the in-flight read` is the per-path form of `no-delete-on-write`. It passes before the cap exists, because every request already reads. After the build it fails if any listed path leaves the entry.

## c1. Compare-and-delete

Settle deletes the map entry only when the entry is still this promise. A TTL expiry that already replaced it must keep the replacement.

`a late settle does not replace the read started after the TTL` is on the mock clock. A joiner before the TTL must not start a second read. After 30_000ms a new read starts and returns `Second page`. The first promise then resolves to `First page` and must not become the second response.

## c2. Lazy TTL and the cap

TTL is checked when a request looks up the key. There is no `setTimeout` per entry. The clock is `deps.now`, or `Date.now` when the test does not pass one.

The map holds at most 64 running entries. A full map never evicts a hung read. A new scope that does not fit does an unshared read and is not stored. A request for a scope that is already running joins that read. Tests count running `wikiPages` calls, not the map size.

`the 65th scope does not start a second read of a hung scope` hangs every workspace and admits more than 64 reads across two callers, because one tree read stops at the fanout of 40. The test counts running `wikiPages` calls in call order. A second request for the oldest call and for the 64th call keeps each running count at 1. A second request for the 65th call starts a second running read, because that read was not stored.

## c3. Runtime

The runtime is workerd, via Cloudflare Workers. Wrangler 4.158.0 and Miniflare 5.20261104.0-beta are the local runtime. `src/worker/index.ts` is the worker entry. `c.executionCtx.waitUntil` is already used in `src/worker/agent/index.ts`.

A promise that performs cache I/O does not finish for a second request if the first request returned without `waitUntil`. The joiner waits until the test deadline. The same promise, passed to `ctx.waitUntil` before the first response, resolves for the joiner after the first response has already been returned: `200 joined:read`. A second Miniflare instance does not see the first instance's promise (`missing`).

The raw read therefore has to be registered with `c.executionCtx.waitUntil` before `GET /v1/brain/tree` returns the 2500ms `degraded` card. The joiner awaits that promise for its value. The I/O stays on the originator's context.

The map is module state in one isolate. Isolates do not share memory. L-1 protection is one pending raw read per tenant and scope per isolate. A reload loop that stays on that isolate collapses onto one read. A different isolate, or a different machine, starts its own read. This does not cap the fleet.

`a joiner sees the raw read after the originator returns only when waitUntil holds it` is in the test command. Without `waitUntil` the joiner hits the 1500ms deadline. With it, the body is `200 joined:read`. A second isolate returns `missing`.

`the waitUntil read times out once and a rejection is logged` is in the same command. One timeout fires. The rejection is caught, the response is `logged`, and the test records no unhandled rejection. The probe log line is `{"event":"tree_inflight","outcome":"rejected"}`. It does not include the error string.

The product promise passed to `waitUntil` never rejects. Settle does compare-and-delete in a `finally`: delete the entry only when the map still holds that slot. `a read error string is absent from the response and the log` throws `SENTINEL-ERR-9f3a-tree-inflight` from the read. That string is in no response and no log. The only product log line is `{"event":"tree_inflight","outcome":"rejected"}`.

`a missing executionCtx does not share and does not throw` is the guard for C-F. Two concurrent requests with no `executionCtx` each read, and both return 200. It passes before the cap exists. The build must keep it green.

Both use `dispatchFetch` only. They do not open a public URL and they do not deploy.

## c4. Mock clock

The 2499ms bound and the unsettled TTL advance `t.mock.timers`. The Miniflare join uses workerd's scheduler and a 1500ms deadline. On the build head, those three timing tests run 50 of 50 at the default node test worker count. That run is not this plan commit.

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

Choice: share the raw workspace read, not the filtered tree. `wikiPages` and `wikiSchema` take no principal, so the raw read may be shared only when ACL filtering runs per request after the join. Key: `inflightKey`, `JSON.stringify([tenantId, scope])`. Delete on settle only if the map still holds that promise. Lazy TTL of 30_000ms. Cap 64 running entries. A full map does not evict a hung read; the new scope does an unshared read. Hold the raw read with `waitUntil`. The promise never rejects. One request-bound timeout of 2500ms ends the wait. A thrown read is caught, logged as `{"event":"tree_inflight","outcome":"rejected"}`, and settled in a `finally`.

Accepted stale window: about one in-flight read, capped at 2500ms for the joiner's response. A joiner can be looking at pages a writer on another isolate has already changed, for about that long. Revocation is enforced by per-request filtering (`readableMany`, `pageVisible`, `filterMarkdown`) on that request's view. It is not enforced by delete-on-write. Delete-on-write only reaches the writer's isolate. It is how that isolate gets read-your-writes. It does not revoke a joiner on another isolate.

The settled `{pages, schema}` value is deep-frozen before any other request reads it. An in-place mutation throws.

If `c.executionCtx` is missing, or `waitUntil` throws, that request does its own read and does not throw.

The cap is per isolate. Isolates do not share memory. It does not protect the whole fleet. A reload loop on one isolate collapses onto one read. Another isolate starts its own.

Rollback is a revert of the build commit. No data migration.

Not chosen: a per-user semaphore, a filtered-tree cache, a concatenated string key, and evicting the oldest hung read to make room.

### C-G. Paths that delete the entry

These change `wikiPages()` or `wikiSchema()`, or they change the ACL stored on that workspace. Each calls `dropInflight` for the workspace's tenant and scope. The test `each write and ACL change drops the in-flight read` calls each one while a read is running and requires the next tree request to start a new `wikiPages`.

| Path | Site |
|---|---|
| `wikiSetSchema` | `src/worker/wiki/store.ts:457` |
| `savePage` | `src/worker/wiki/store.ts:937` |
| `unarchivePage` | `src/worker/wiki/store.ts:1001` |
| `applyProposal` | `src/worker/wiki/store.ts:1349` |
| `wikiReset` | `src/worker/wiki/store.ts:2049` |
| `wikiPseudonymise` | `src/worker/wiki/store.ts:2059` |
| `wikiForgetSources` | `src/worker/wiki/store.ts:2143` |
| `brainConfigSet` | `src/worker/brains/store.ts:192` |
| `brainSchemaAdd` | `src/worker/brains/store.ts:203` |
| `brainMemberSet` | `src/worker/brains/store.ts:744` |
| `brainMemberRemove` | `src/worker/brains/store.ts:751` |

Directory membership is not one of these paths. `src/worker/tenant-policy.ts:297`, `src/worker/tenant-policy.ts:792`, and `src/worker/security-journal.ts:187` change the caller's view. The next request filters with that view. Deleting the raw entry there would only affect the writer's isolate, which is the stale window above.

Devin has agreed on conditions (1) through (7). Sentinel has agreed with conditions C-A to C-G. Neither line is merge approval. The build head still needs the exact-head verifier, Sentinel, and Inspector.

## Red output

Command: the test command above. Exit 1. 11 pass, 7 fail. `duration_ms` 3857.201122.

```
✖ n concurrent tree requests for one hung brain share one pending read
  4 !== 1

✖ after settle a new read starts
  2 !== 1

✔ after the unsettled TTL a new read starts

✖ two users with different ACLs never receive each other's filtered pages
  2 !== 1

✔ a rejected read is not reused

✔ wikiPages and wikiSchema arguments do not carry the principal

✔ a caller who is not admitted does not join the pending read

✔ structured inflight key does not collide

✔ a workspace write drops the pending read and the new page is present

✖ a late settle does not replace the read started after the TTL
  2 !== 1

✖ the 65th scope does not start a second read of a hung scope
  evict-oldest starts a duplicate read
  2 !== 1

✖ settled pages and schema are frozen against in-place mutation
  Missing expected exception.

✖ a read error string is absent from the response and the log
  0 !== 1

✔ a missing executionCtx does not share and does not throw

✔ each write and ACL change drops the in-flight read

✔ a joiner sees the raw read after the originator returns only when waitUntil holds it

✔ the waitUntil read times out once and a rejection is logged

✔ a brain at 2499ms is kept and a brain at 2501ms is degraded
```

`a caller who is not admitted does not join the pending read`, `a workspace write drops the pending read and the new page is present`, `a missing executionCtx does not share and does not throw`, and `each write and ACL change drops the in-flight read` are regression guards. They pass on this handler. The freeze test has no exception. The error-string test sees no `tree_inflight` log line. The 65th-scope test sees a second running read of `c_cap_00`.

The `concat-key` mutant `tenantId + ":" + scope` makes `inflightKey("a:b", "c")` and `inflightKey("a", "b:c")` both `a:b:c`. The collision test then fails `expected: 'a:b:c'` against `actual: 'a:b:c'`. That mutant was reverted.

A stand-in that served the first caller's body to the second caller failed the ACL test on `Secret page`: actual true, expected false. That stand-in was not committed.
