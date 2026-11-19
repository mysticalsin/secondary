# Spec 016 — Graph keyboard and landmarks

## Requirements

- The graph page has a `<main>` landmark and one `<h1>`. The heading is the page name, Graph. It is not a new tagline.
- The graph canvas is in the tab order.
- With the canvas focused, Arrow Right and Arrow Down move to the next visible node, Arrow Left and Arrow Up move to the previous one, and Enter selects the current node. Moving selects that node, so its title is shown.

## Out of scope

- No new helper text, taglines, or secondary labels.
- The dashboard page already has its own landmark.
