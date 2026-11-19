# Tasks 015

- [x] T001 Spec. Tap targets, the long title, zoom under the open panel, the search focus ring, and the three status and motion fixes.
- [x] T002 Red tests `48b1b41ac380845de34e1f391d0352ab6d3ef862`. At 390 the brand is 22px, the close button is 19.45×20, and the capsule links are 28.84px on Graph and 29.5px on Dashboard. A 300-character title makes the dashboard `scrollWidth` 3251 at 1440, 2973 at 390, and 2973 at 375. Zoom in and Zoom out hit the panel. Search outline is `none`. Reduced motion still runs `pulse`. Offline says the sign-in expired. A 500 leaves `Ready. 1 page could not be read.`
- [x] T003 Apply the CSS and the two script changes. Reverting those four files makes all seven tests fail again.
