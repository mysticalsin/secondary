# Plan 009: Real route integration

One test file imports `createApp` and requests it. The Access JWT is verified by `verifyAccessJwt`. `TENANT_POLICY` is a real `TenantPolicy` on a temporary sqlite file. `WORKSPACE.get` returns null so the contribute handler can answer `not_found` without a stored item.

## Security & data

The JWT key, the HMAC secrets, and the email are synthetic and exist only in the test process. The test does not call a network. Switch rows live in the temporary sqlite file and are removed with it.
