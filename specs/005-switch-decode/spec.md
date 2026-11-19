# Spec 005: Encoded source path

**Input**: Sentinel P-1. Hono `4.13.17` routes on the decoded path. `switchGate` used to read `new URL(c.req.url).pathname`, which keeps the percent-encoding.

## Behaviour

`GET /v1/%73ources/s1` with the connector switch off is mounted the same way production mounts `/v1`: `app.route("/v1", v1)`, then `switchGate`, then `GET /sources/:id`. The gate matches `c.req.path`. That request is 503 `{ error: "switched_off", switch: "connector" }`. `GET /v1/%2573ources/s1` is not decoded twice and hits the catch-all. A percent-encoding `decodeURI` rejects is 400 `{ error: "bad_request" }` and does not continue. `securityHeaders` uses the same routed path for `Cache-Control: no-store`. A valid encoding of a path that is not a kill-switch row still continues.

## Not in this slice

`/v1/ai` with no further slash, `/v1/sources` with no id, and a trailing slash on the contribute path are not matched. That is the same as main `8c2ede3`. This slice does not change those matchers.
