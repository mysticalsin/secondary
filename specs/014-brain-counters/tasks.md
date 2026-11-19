# Tasks 014

- [x] T001 Spec. Scope the unresolved count and the dashboard link total to the chosen brain. Leave "All brains" out, per spec 013.
- [x] T002 Red test `f0c387411951b0f2fdb4ea62f05fb72e7912ce89`. Delivery is selected. Engineering's broken link must not show as unresolved, and a global link into Engineering must not raise Dashboard's Links count. On that commit the dashboard Links value is 1 and the graph stats are `2 notes · 1 link · 1 unresolved`.
- [x] T003 Apply the filters. Reverting them makes T002 fail with those same two results.
