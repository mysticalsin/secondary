# Spec 011: Route test gaps

**Feature Branch**: `cursor/sb-route-test-gaps-b165`

**Input**: The PR #16 review items that are still open. Tests only.

## Cases

- A signed ops call with a bad signature, a timestamp older than the allowed skew, a missing timestamp, or a body that was not the signed body is 401 `{ error: "unauthorized" }`.
- `POST /v1/internal/ops/restore` with no signature is 401. A valid signature with restore turned off is 403 `{ error: "restore_disabled" }`. In dev, with restore turned on and the tenant's own snapshot, the same route is 200 `{ ok: true }`.
- `GET /v1/sources/:id` with a real session and no workspace binding is 500 `{ error: "internal_error" }`.
- The same route, when the connector answers `allowed: false`, is 403 `{ error: "forbidden", reason: "source permission could not be confirmed" }`.
- A contribution records `status: "candidate"` on the workspace object the handler passed to `create`, not only in the JSON.
- `GET /v1/internal/ops/targets` with a valid Access token and a bad HMAC is 401. That 401 is the HMAC check. `GET /v1/internal//ops/targets` with a valid Access token is 404, because that path never reaches the ops HMAC middleware.

## What stays

No product code. Publish, the Backlog folder download, and the MCP allowlist stay as they are.
