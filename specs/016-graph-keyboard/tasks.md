# Tasks 016

- [x] T001 Spec. A main landmark, an h1, and keyboard movement between graph nodes.
- [x] T002 Red tests `7b7c749fa7823d797c9cb3bb91ca4f0fb9dcd78a`. The page has no `<main>` and no `<h1>`, and the canvas tab index is -1.
- [x] T003 The canvas is in the tab order. Arrow keys move the selection and Enter selects the current node. Reverting the page, the script, and the stylesheet makes both tests fail again. The open panel no longer pushes Zoom off a 390px page: that rule applies from 761px up. Red commit for the off-screen zoom is `07a6355fea44a00b38495394cd2e4d969cc22ac7`, which measured Zoom in at x -18.
