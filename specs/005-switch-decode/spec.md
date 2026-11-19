# Spec 005: Encoded source path

**Input**: Sentinel P-1. Hono `4.13.17` routes on the decoded path. `switchGate` reads `new URL(c.req.url).pathname`, which keeps the percent-encoding.

## This commit

A red test only. `GET /v1/%73ources/s1` with the connector switch off is mounted the same way production mounts `/v1`: `app.route("/v1", v1)`, then `switchGate`, then `GET /sources/:id`. The test expects `503` and `{ error: "switched_off", switch: "connector" }`.

The plain path `GET /v1/sources/s1` already returns that 503. The encoded path reaches the handler. That is the bug. This commit does not decode the path and does not add a connector check in the handler. The fix is a later change, and that change will say the behaviour change in plain words: an encoded source path that Hono routes to `/sources/:id` will be refused when the connector switch is off.

## Not in this slice

`/v1/ai` with no further slash, `/v1/sources` with no id, and a trailing slash on the contribute path are not matched. That is the same as main `8c2ede3`. This slice does not change those matchers.
