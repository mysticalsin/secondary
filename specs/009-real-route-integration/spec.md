# Spec 009: Real route integration

**Feature Branch**: `cursor/sb-real-route-integration-b165`

**Input**: Drive the exported app through production `authenticate`, a `TenantPolicy` switch map, and `switchGate`.

## Session

The caller is synthetic. The token is an RS256 Access JWT signed with a test key that never leaves the test. `createApp` receives that key through `deps.jwks`, the same seam production uses for `verifyAccessJwt`. The email is `ada@synthetic.example`. The tenant id is `synthetic`. No network and no real credential.

The switch map is whatever `TenantPolicy.switchState` reads from its sqlite table. The test turns a switch off with `setSwitch` on that object. It does not hand the gate a made-up map.

## Routes

- `GET /v1/sources/:id` with the connector switch on reaches the handler in `routes.ts` and is not 401 or 503. With the switch off it is 503 `{ error: "switched_off", switch: "connector" }`. A trailing slash stays on that row. `/v1//sources/s1` stays 404. `/v1/sources/s1//x` is 503 while the switch is off.
- `POST /v1/personal/items/:id/contribute` does the same for the contribute switch. The workspace has no such item, so the handler's own answer is 404 `{ error: "not_found" }`.
- No token is 401 `{ error: "unauthorized" }` on both routes.

## Internal ops and MCP

`/v1/internal/ops` and `/v1/internal/mcp` are mounted in `createApp` before `v1Routes`. They do not pass through `switchGate`. That is intended. `index.ts` says those machine calls are mounted before `/v1` so they skip Access auth and the body limit. Each verifies its own HMAC (`OPS_HMAC_KEY` or `INTERNAL_HMAC_KEY`). `GET /v1/internal/mcp/switches` exists to read the switch map, including when a switch is off. A signed call with every switch off is 200 and the body shows the off flags. It is not 503 `switched_off`. An unsigned call is 401 from that HMAC check.

`switchGate` still refuses an MCP *user* call on the public `/v1` router when the session is internal and `mcp` is off. That is a different door.

## What stays

No change to who may publish, to the Backlog folder download, to the MCP allowlist, or to `isImport`. No change to `switches.ts` unless a test shows a real defect.
