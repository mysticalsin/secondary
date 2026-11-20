# Plan 019 — Brain tree in-flight cap

Ticket: SB-BRAIN-TREE-INFLIGHT-CAP

Risk: MEDIUM-HIGH. This is server concurrency in `src/worker/uxv2/tree.ts`. A shared result that includes one caller's filter would cross an ACL boundary. This phase is the plan and the red tests. The handler is unchanged.

## Approach

Share one in-flight raw read per tenant and workspace scope. The raw read is `wikiPages` plus `wikiSchema`. Each request still runs `readableMany`, `pageVisible`, and `filterMarkdown` with that caller's view. A miss of the 2500ms bound still returns `degraded` for that request. The shared read may finish later. It is not served as another caller's tree.

The map entry is deleted when the raw read settles, and when it has been pending for the TTL. The next request then starts a new read. A rejection is not stored. The next request starts a new read.

Planned TTL: 30_000ms, measured on the same clock as `treeBoundMs`. A test passes `inflightTtlMs` the way a test already passes `treeBoundMs`.

## Alternatives

- Cap concurrent tree requests per user. One user's reload loop stops. Many users, or many tabs, still stack one read each on the same hung workspace. That does not answer L-1.
- Cache the filtered tree per user. Fewer repeat filters, and a wrong key or a long TTL shows one person another person's pages. Rejected.
- Share the raw read per tenant and scope, and filter again on every request. One hung workspace has one pending read. Admission and citation checks stay on the request. This is the choice.

## Why a caller cannot receive another caller's filter

The shared value is the workspace's own page list and schema. It is not a view, a title list, or a citation verdict. `readableMany` keeps running once per request per brain, which is I-2. `pageVisible` and `filterMarkdown` use the caller's `AdmittedView`.

A caller who is not admitted to the workspace never joins the read. Personal scopes already contain the principal id. Two tenants use different workspace names, so they do not share an entry. The map key is `tenantId` plus `scope`. It does not contain a principal id, because the raw pages are not personal. Putting the principal id in the key would bring back one read per user, which is the leak L-1 names.

## Memory

At most one entry per tenant and scope. Settle deletes it. TTL deletes it. A rejection deletes it. The map therefore holds only reads that are still running and younger than the TTL. It does not hold page bodies after settle. A cap of 64 entries drops the oldest unsettled entry if a flood of distinct scopes arrives. The dropped read is left to finish on its own and is not reused.

## Test command

From the repository root:

```
node --experimental-strip-types --test --test-reporter=spec --test-name-pattern "pending read|new read|different ACLs|rejected read|2499ms is kept" harness/tests/brain-tree-inflight-cap.test.ts harness/tests/src-hardening.test.ts
```

The 2499ms case is the existing mock-clock test in `harness/tests/src-hardening.test.ts`. The new cases are in `harness/tests/brain-tree-inflight-cap.test.ts`. No real timer is the bound.

## Rollback

Revert this branch's commits. No data migration. The tree route goes back to one read per request. A page already returned is unchanged.

## Decision record draft

Choice: share the raw workspace read, not the filtered tree. Key: tenant and scope. Filter per request. TTL 30_000ms. Drop on settle, on rejection, and at 64 unsettled entries.

Not chosen: a per-user cap, and a cache of filtered pages.

This draft is not an agreement. A non-author reviews it before any handler change.

## Red output

Command: the test command above. Handler unchanged. Exit 1. 3 pass, 3 fail. `duration_ms` 1172.014464.

```
✖ n concurrent tree requests for one hung brain share one pending read (500.109632ms)
  4 !== 1

✖ after settle a new read starts (126.715657ms)
  2 !== 1

✔ after the unsettled TTL a new read starts (188.128886ms)

✖ two users with different ACLs never receive each other's filtered pages (121.463809ms)
  2 !== 1

✔ a rejected read is not reused (114.635294ms)

✔ a brain at 2499ms is kept and a brain at 2501ms is degraded (473.371792ms)
```

The two share assertions fail because each request still calls `wikiPages`. The ACL case already returns different pages (`Secret page` for the caller who can read `c_private`, not for the other) and then fails on the same `2 !== 1` count. The TTL case, the rejected-read case, and the 2499ms bound pass on the current handler: a later request already starts a new read, a rejection is not stored, and the bound is unchanged. Those three stay as guards for the implementation.
