# Plan 005: Encoded source path

Mount a Hono app the way `index.ts` mounts `v1Routes`: `app.route("/v1", v1)`. The sub-app sets a session with `connector` off, runs `switchGate`, then `GET /sources/:id`.

The red commit records the failure. The next commit makes `switchGate` match `c.req.path` and answers 400 when `decodeURI` rejects the pathname. `switches.ts` matchers stay as they are.

`/v1/ai`, `/v1/sources`, and the trailing-slash contribute path stay unmatched. That question is in the decision log and is not a matcher edit.
