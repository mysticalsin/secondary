# Plan 005: Encoded source path

Mount a Hono app the way `index.ts` mounts `v1Routes`: `app.route("/v1", v1)`. The sub-app sets a session with `connector` off, runs `switchGate`, then `GET /sources/:id`.

Request `http://127.0.0.1/v1/%73ources/s1`. Record the failure. Do not change `switches.ts` or `routes.ts` in this commit.

`/v1/ai`, `/v1/sources`, and the trailing-slash contribute path stay unmatched. That question is in the decision log and is not a matcher edit.
