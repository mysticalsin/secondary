# Spec 012: Source hardening

**Feature Branch**: `cursor/sb-src-hardening-b165`

**Input**: Phase 2. Gap C, the empty personal dashboard, stays out. The seed is not changed.

## Candidate read

`GET /v1/ux/candidates/:id` returns one contribution candidate. The id is at most 128 characters. The author can read it while the target node is still in their view. A non-author can read it only when `canDoInView` allows `review` or `approve_release` on that target node. `configure` is not that right. Content exclusion, break-glass and NDA stay in force, so a platform admin with no content right on the target is refused.

An author who has lost access to the node is refused. Policy wins over authorship.

Anyone else, a missing id, a foreign-tenant id, an unparsable id, and an id longer than 128 characters are the same 404 `{ error: "not_found" }`. An id of exactly 128 characters is still looked up. When that id names a node still in the author's view, the author gets 200. `GET /v1/nodes/:id` does not grow a candidate branch.

## Brain directory

`GET /v1/brains` and `GET /v1/brains?scope=all` bound each brain at 2,500 ms. A workspace that does not answer within the bound comes back as a card with its id and name, `pages: 0`, and `unavailable: true`, and only when the `type` and `q` filters would have kept it. The other brains still return. Cards that answer in time do not gain `unavailable`.

The unavailable card's `restricted` flag is `isRestrictedBrain` of the view node's own flags. It does not hard-code `false`. Ancestor or NDA restriction that is not copied onto the node itself is a residual: the miss path does not walk ancestors. `role` is the caller's real role when the view already produced it, and is omitted when it did not. `template` is omitted: it lives in the workspace that did not finish. Neither field is invented.

The bound aborts the local read, so a late reply does not continue into further subrequests. `clearTimeout` runs when the read finishes first, so a brain that answered is not aborted. A Durable Object call already sent cannot be cancelled from this isolate. That in-flight set is one brain's fixed fan-out, not a retry loop.

## Anonymous paths

With no credentials, these are 401 `{ error: "unauthorized" }`:

- `GET /v1/internal///ops/targets`
- `GET /v1/internal/%2Fops/targets`
- `GET /v1//internal`
- `GET /v1/internal/mcp//switches`

The first three do not match the ops mount, so they fall through to Access authentication. The same three with a valid Access token are 404 `{ error: "not_found" }` from the v1 catch-all. The HMAC is not what answers them.

`GET /v1/internal/mcp//switches` stays on the MCP mount. The extra slash does not fall through to Access authentication, which is why a valid Access token used to see a 404 with no switch data: the mount's catch-all answered before any credential check. Every path on that mount now requires the internal HMAC, so an unsigned request is 401 `{ error: "unauthorized" }` with or without an Access token. A request that passes the HMAC and is not a route is 404.

## Repro script

`docs/auth/mantu-503-repro.mjs` loads a worker only when the argument stays inside this repo. The check resolves the directory and `worker/entry.js`. A `../` escape, a directory symlink that leaves the repo, or an `entry.js` symlink that leaves the repo exits 1 and prints `refused: path is outside the repo`.

## Health

`GET /v1/health` is `{ ok: true }`. It does not include `env` or `version`. Nothing in the worker reads those fields from this response.
