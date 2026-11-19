# Plan 015

Tests only, on top of the residual-guards head.

- Extend the intake pin check so `patched-sha256.json` may name `src/state/erasure-request.ts` without putting that path in `PATCHED_RECOVERED` or the 117-file manifest.
- Add the decode, signed-call, and connector cases in the existing harness files.
- Move the department flag write in the ancestor test inside the `try`. The restore stays in `finally`.
