# Plan 007: One path for every kill switch

**Branch**: `cursor/sb-switch-normalize-b165` off `f7002db`.

## Steps

1. Tests for each recorded variant in plain, percent-encoded, and mixed-case form. They fail on main.
2. `normalizedSwitchPath` lowercases and drops every trailing slash. Every prefix row matches the prefix itself or `prefix/…`, not a longer sibling. `switchGate` still returns 400 when `decodeURI` throws, then matches the normalized path.
3. Regenerate the pinned switch table for the rows whose status changes.

## Security & data

The gate reads the request path and the session switch map. It writes the same 503 or 400 body as today. No new stored field, no secret, no change to who may publish or download a Backlog folder.
