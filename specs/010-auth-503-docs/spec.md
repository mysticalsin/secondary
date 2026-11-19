# Spec 010: Keep the 503 classification

**Feature Branch**: `cursor/sb-503-docs-b165`

**Input**: Bring the ac41dfec classification and its repro in from `578de37a`, unchanged apart from a status note.

## What lands

- `docs/auth/mantu-503-classification.md`, the Devin classification of signed-out `GET /` on the ac41dfec bundle.
- `docs/auth/mantu-503-repro.mjs`, the box repro that drives that bundle's `worker/entry.js`.
- A short "Status as of ad04f08" note under the title. It says a route behind `authenticate`, such as `GET /v1/sources/s1`, is 401 without an Access token, and that `GET /v1/health` and `GET /v1/ready` do not require one.
- Marker lines, "Historical: describes the ac41dfec bundle only, not current main.", at the start of Verdict and above Fixes. Item 4 keeps its original sentence and adds an indented line: the wrangler file is the bundle's, and this repo has no wrangler config.

## What stays

No product code. The repro is not a test and is not typechecked.
