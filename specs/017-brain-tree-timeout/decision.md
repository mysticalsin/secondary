# Decision

`wikiPages` in `src/worker/wiki/store.ts` takes no signal. The SQL read runs to completion. `GET /v1/brain/tree` bounds the wait only. After 2500ms the response marks that brain `degraded` and stops waiting. The read is not cancelled.

A value that arrives in the abort turn is left out of the response. That bounds the response. It does not stop the read.

The graph and the dashboard do abort their own `fetch` of `/v1/brain/tree` after 8000ms. That is the browser request, not the SQL read.
