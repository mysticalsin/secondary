# Spec 014: Residual guards

**Feature Branch**: `cursor/sb-residual-tests-b165`

**Input**: Sentinel X-2, Y-1, and PR #19 R-1, R-2, R-3, L-1. Erasure rulings from 11 Nov 2026. Product code changes only where a test shows the rule is not already enforced.

## Signed internal calls

`GET /v1/internal/ops/targets` and `GET /v1/internal/mcp/switches` accept a signature only from that route's own key. The ops key on the MCP route, and the MCP key on the ops route, are 401. A forged MCP signature, a timestamp more than 60 seconds ahead, a missing nonce, and a missing key id are 401. Replaying the same signed MCP request is 401. Changing `?tenant=` after signing is 401.

## Persistence

A connector upsert that the route reports as changed is still present on the workspace afterwards. A source-access check that returns an allowed id has called the connector binding.

## Candidate id

An id longer than 128 characters is 404 even when the text after `cand:` names a node the author can read. An id of exactly 128 characters that names such a node is still 200. The org edit that creates that node is undone before the next test.

A candidate stored for tenant A is 404 for a user of tenant B, including when that user can see the same node id in their own org.

## Missed card

A brain card, whether the workspace answered or missed the bound, is restricted when the node or an ancestor is restricted, under NDA, or a contacts subspace. Direct publish uses that same walk: an unflagged brain under a restricted or contacts ancestor does not publish without review. A closed card on `scope=all` uses it for the restricted badge. The same walk serves both cards. It is finished only when a parent id is null. A missing parent, or a chain that is still open after twelve hops, fails closed: the card is restricted. The real org's longest chain is five, so a chain of thirteen ancestors is a synthetic cap, not a production shape.

## Erasure steps

A stored erasure order is unreadable when a step is not one of `receipts`, `tombstone`, `personal`, `connector`, `directory`, or `scope:` plus a scope id of the form `[a-z0-9][A-Za-z0-9_.:@-]{0,127}`. A request drops a step that is not that form before it is stored, and `place` ranks a scope step only when the same check matches. The plan emits a scope step only for an id of that form. The runner takes the scope id with that same match, not a prefix. A grant whose subject is not the person being erased does not resume. That subject check is already in `erasureGrantOk`.
