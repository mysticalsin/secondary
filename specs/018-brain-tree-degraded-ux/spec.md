# Spec 018 — Degraded brain picker

Ticket: SB-BRAIN-TREE-DEGRADED-UX

Follow-up to Inspector's hands-on pass on the tree timeout. The server bound stays as it is. This ticket is the two client scripts only.

## Ticket

Done when:

- [ ] A brain that is `unavailable` on `GET /v1/brains` and `degraded` on `GET /v1/brain/tree` appears once in the Dashboard picker and once in the Graph picker.
- [ ] Dashboard and Graph start those two requests together. A hung brain reaches the status `Degraded` on one 2500ms server bound, not on the sum of the two.
- [ ] The client `boundFetch` bound stays 8000ms.
- [ ] Choosing a degraded brain shows no empty-state sentence and no empty-state button. The status stays the word `Degraded`.
- [ ] No new helper text is added.

## Requirements

- De-duplicate picker options by brain id. The `/v1/brains` card is kept. The degraded root is not appended again.
- A brain that is only in the tree, and missing from `/v1/brains`, is still one option.
- The two calls overlap. The expected end-to-end wait for a hung brain is 2500ms, one server bound. Inspector measured the sequential wait at 5.1–5.2s.
- A degraded brain with no pages does not render "Your second brain has no pages yet", "Add or import notes", or "Open your Personal Brain". Graph does not reveal the empty-brain panel for that selection.
- A healthy brain with no pages still uses today's empty state.

## Out of scope

- No change under `src/`. No change to the tree or brains API.
- No new copy.
- No deploy.
