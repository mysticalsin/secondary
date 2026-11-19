# Plan 014: Residual guards

Tests sit next to the routes they guard. Signed-call cases use `signOpsRequest` and the real `verifyOpsRequest` path through `createApp`. The connector case uses `connectorRoutes` and a real `Workspace` on sqlite. Candidate cases extend the existing directory harness and put the long node back when the test ends.

The missed-card restriction walk follows parent links already stored on the org, the same way an open card does. The erasure step check stays inside `knownErasureStep`.

## Security & data

Wrong keys, replays, and tampered queries stay 401. A second tenant cannot read the first tenant's candidate. No live token or cookie is written.
