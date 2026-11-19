# Spec 016 — Graph keyboard and landmarks

## Requirements

- The graph page has a `<main>` landmark and one `<h1>`. The heading is the page name, Graph. It is not a new tagline.
- The graph canvas is in the tab order from its HTML `tabindex`. The script does not set `tabIndex` again.
- The canvas role is `application`. Its accessible name does not give key instructions and does not say to use Find a page. As the selection moves, the hidden `#graph-selection` paragraph is the only polite live region, and it announces the current title. The details panel is not a live region.
- With the canvas focused, Arrow Right and Arrow Down move to the next visible node, Arrow Left and Arrow Up move to the previous one, and Enter selects the current node. Moving selects that node, so its title is shown. Arrow keys held with Alt, Ctrl, or Meta do not move the selection and do not call preventDefault.

## Out of scope

- No new helper text, taglines, or secondary labels.
- The dashboard page already has its own landmark.
