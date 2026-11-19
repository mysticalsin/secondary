# Spec 007: One path for every kill switch

**Feature Branch**: `cursor/sb-switch-normalize-b165`

**Input**: Tony, via Jarvis: "A, make the switches catch those variants too." The three unmatched forms in the decision log are the bare prefix (`/v1/ai`, `/v1/sources`), a trailing slash on a gated path (`/v1/personal/items/:id/contribute/`), and the same bare prefix on the other switch prefixes (the recorded third is that contribute trailing slash, together with `/v1/ai` and `/v1/sources`).

## Behaviour that changes

When the matching switch is off, these are 503 `{ error: "switched_off", switch: "<name>" }`:

- The path with no further segment: `/v1/ai`, `/v1/sources`, and `/v1/connectors`.
- The same path with a trailing slash.
- The contribute path with a trailing slash, including more than one slash (`/contribute//`, `/v1/genui/plan//`).
- Those paths with percent-encoding, and with a different letter case.

One function normalizes the path: lower case, then every trailing slash. A prefix matches that path or `prefix/…`. It does not match a longer sibling such as `/v1/aix`. The rows do not each special-case a variant.

A percent sequence `decodeURI` rejects stays 400 `{ error: "bad_request" }`.

## Behaviour that stays

`/v1x`, `/v10`, an interior double slash (`/v1//sources/s1`), and `%2F` / `%2f` are not extra slashes. `%2573` is not decoded twice. A dot segment that the URL parser collapses onto a switched path is that path; one that leaves the prefix is not. Unicode letter case that `toLowerCase` does not fold onto the ASCII prefix stays open. GET of the contribute path is not the contribute row. A bad percent sequence stays 400. Publish still reads `can.decide`. The Backlog folder download is unchanged. `auth.ts` and `isImport` still read the raw pathname.

## Independent test

The variant list in `harness/tests/switch-normalize.test.ts`. On main `f7002db` those requests are not 503. After the normalizer they are.
