# Spec 019 — Brain tree in-flight cap

Ticket: SB-BRAIN-TREE-INFLIGHT-CAP

`GET /v1/brain/tree` returns when a brain misses the 2500ms bound. The workspace read is not cancelled. A reload loop can stack those reads, and the connector calls behind them, on one hung workspace. Sentinel L-1 on #26, confirmed again in the #27 review (report `47013a77`).

## Done when

- [ ] Four concurrent tree requests for one hung workspace start at most one pending `wikiPages` read.
- [ ] After that read settles, the next tree request starts a new read.
- [ ] After the unsettled-read TTL, the next tree request starts a new read instead of joining the expired one.
- [ ] Two callers with different admissions never receive each other's filtered pages. The shared value is the raw workspace read. `readableMany` still runs per request (I-2).
- [ ] A rejected read is not reused. The next request starts a new read and can succeed.
- [ ] `a brain at 2499ms is kept and a brain at 2501ms is degraded` still passes on the mock clock.
- [ ] No filtered tree, page title, or citation verdict is stored in the shared map.

## Out of scope

- Cancelling the SQL read. `wikiPages` still takes no signal.
- A per-user semaphore. That does not stop many users stacking reads on one workspace.
- Caching a filtered tree.
- A deploy.
