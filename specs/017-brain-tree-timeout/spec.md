# Spec 017 — Brain tree timeout

Ticket: SB-BRAIN-TREE-TIMEOUT

One hung brain must not freeze Dashboard or Graph. `GET /v1/brains` already bounds each brain. `GET /v1/brain/tree` does not, and neither client bounds its own fetch.

## Requirements

- `GET /v1/brain/tree` gives each admitted brain 2500ms. A test may pass `treeBoundMs` instead.
- A brain that does not answer is still in `roots`: a workspace, its label, `access: "degraded"`, and no children. Brains that answered keep today's nodes.
- The graph and the dashboard stop their own `GET /v1/brain/tree` after 8000ms. A test may set `document.documentElement.dataset.fetchBound` to a shorter bound.
- When a root is degraded, or that fetch times out, both pages show the status `Degraded`. They do not stay on `Loading your second brain…` or `Reading your second brain…`.
- When the tree names the hung brain, its name is an option in the brain picker, next to the healthy brains. The status is the word `Degraded` and nothing else.

## Out of scope

- The directory bound on `GET /v1/brains` stays as it is.
- No new helper sentence, tagline, or reload instruction.
- No deploy.
