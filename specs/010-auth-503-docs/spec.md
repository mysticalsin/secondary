# Spec 010: Keep the 503 classification

**Feature Branch**: `cursor/sb-503-docs-b165`

**Input**: Bring the ac41dfec classification and its repro in from `578de37a`, unchanged apart from a status note.

## What lands

- `docs/auth/mantu-503-classification.md`, the Devin classification of signed-out `GET /` on the ac41dfec bundle.
- `docs/auth/mantu-503-repro.mjs`, the box repro that drives that bundle's `worker/entry.js`.
- A short "Status as of ad04f08" note at the top of the classification. The historical text stays.

## What stays

No product code. The repro is not a test and is not typechecked.
