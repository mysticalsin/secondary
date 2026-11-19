# Tasks 007

- [ ] T001 Spec. Record that `/v1/brain/tree` is called with no `root`, that a missing `root` already returns company roots, and that "All brains" (`value=""`) is only a client filter. The fix stays in the client.
- [ ] T002 Red test. Load `dashboard.js.txt` and `app.js.txt` against a fake `fetch`. Prove the default brain, that the dropdown matches `GET /v1/brains`, and that My Secondary is one choice. Show the assertions fail on the old "All brains" default.
- [ ] T003 Select the first admitted brain with pages, otherwise the first card. Drop the "All brains" option. Keep the empty state when the selected brain has no pages. Update the graph-entry hashes for the bytes that change.
