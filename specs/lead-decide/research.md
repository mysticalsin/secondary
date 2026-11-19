# Research: In-brain lead decisions

## Decision: standing grant, not elevation

`canDoInView` returns "Granted by elevation (audited)" when no grant matches and elevation is active. Clearing `elevatedUntil` and checking again separates a standing grant from that temporary allow. A lead's `review` or `edit` on their own node remains. An elevated CEO's `review` does not.

## Decision: author is passed on approve

List and open do not have one author. The approve route loads the proposal and passes `authorId`. The caller matching that id is denied.

## Alternatives considered

Requiring `approve_release` for every decision is the current code. It denies `acme_lead` on `a_acme`. That is the regression this change removes.
