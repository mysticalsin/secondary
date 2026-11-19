# Spec 015 — SPA layout and accessibility

## Requirements

- At a 390px-wide phone, the nav capsule links, the brand link, and the graph panel close button are each at least 44px in the dimension a thumb hits. At a 1440px desktop those same controls are at least 24px.
- One 300-character page title with no spaces does not make the dashboard wider than the viewport at 1440, 390, or 375.
- Zoom in and Zoom out can be hit while the graph page panel is open. The shift that clears the open panel applies only at 761px and wider, so the controls stay inside a 390px phone.
- The search field shows a visible focus ring.
- A request that never reaches the network does not say the sign-in expired. The status is exactly `The brain could not be loaded.` It does not append `(offline)`.
- When a page returns HTTP 500, the graph status does not say Ready. It uses the existing "could not be read" sentence.
- `prefers-reduced-motion: reduce` turns off the loading pulse and the dashboard skeleton shimmer.

## Out of scope

- Keyboard movement on the graph canvas, a `<main>` landmark, and an `<h1>`. Those belong to the next spec.
- No new helper text, taglines, or secondary labels.
