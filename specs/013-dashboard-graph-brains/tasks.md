# Tasks 013

- [x] T001 Spec. Record that `/v1/brain/tree` is called with no `root`, that a missing `root` already returns company roots, and that "All brains" (`value=""`) is only a client filter. The fix stays in the client.
- [x] T002 Red test `1ae3fdd4a92d6f0f2017fa9558c94121418a8020`. Load `dashboard.js.txt` and `app.js.txt` against a fake `fetch`. Prove the default brain, that the dropdown matches `GET /v1/brains`, and that My Secondary is one choice. On that commit the old default fails: it never calls `GET /v1/brains`, the first option is "All brains" with value `""`, and the selected value is `""` rather than `c_delivery`.
- [x] T003 Select the first admitted brain with pages, otherwise the first card. Drop the "All brains" option. Keep the empty state when the selected brain has no pages. Update the graph-entry hashes for the bytes that change.
