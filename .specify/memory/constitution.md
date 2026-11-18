# Secondary Second Brain Constitution

## Core Principles

### I. Linear/Apple Notes simplicity

A change is the smallest surface that does the job. One concern per commit. No extra framework, package, or abstraction when the existing file can carry the change. If a sentence, type, or file is not needed for the acceptance check, it is not added.

### II. No helper text, taglines, or secondary labels

Do not add helper text, taglines, or secondary labels to explain a layout or a type. Fix the layout or the type itself. Documentation that records a decision is not helper text. Provenance of a reconstructed file goes in the commit message, not in a code comment.

### III. Clean modular separation of concerns

Each module has one home. A type that the Worker already imports lives at that import path and nowhere else. `reconstruction/` is not a second home. No `tsconfig` path, include, or `preserveSymlinks` entry may point at `reconstruction/`.

### IV. No bolt-ons

If a clean result needs a refactor, stop and recommend the refactor. Do not add a shim, a stub, an `any` cast, or `@ts-ignore` to force the typecheck down. A stand-in that is promoted is the real module at its import path, not a new wrapper around the stand-in.

### V. Tests first, red first

A behavior change starts with a failing test. On the worker typecheck lane the standing red is `npm run typecheck:worker` at the count recorded for that commit's parent. A real mismatch between a promoted module and the code gets its own red test before any fix. That test is not `harness/runtime/whole-api-causes.test.ts` line 111. Never silence a mismatch with `any` or `@ts-ignore`.

### VI. Security and data section in every plan

Every implementation plan has a Security & data section. It states what data is read, what is written, and what is forbidden. Env bindings are names only. Secret values are not copied into git, specs, or logs.

### VII. Isolated branches only

Work stays on the named branch. Push is a fast-forward. No force, no hook bypass, not `main`. No merge of another branch. No new repository.

### VIII. Separate QA and real-testing gates

The writer runs the gates named in the spec and reports the counts. QA is a later session by a non-writer, on the exact head the writer pushed. The writer does not grade their own QA pass.

### IX. Exact-head CI

A check runs on the commit being judged, not on a floating branch tip. The worker typecheck gate, once attached, fails the job when `npm run typecheck:worker` exits non-zero.

### X. Merge and deploy only on Tony's own words

Merge and deploy happen only when Tony says so in his own words. A reviewer's acceptance, a green gate, or an agent's summary is not that permission. No spend.

## Repo rules

These add constraints. They do not weaken Principles I–X.

- GitHub Spec Kit v1.4.0 is required for every change. Do not substitute another Spec Kit version. If v1.4.0 cannot be fetched, stop.
- The state-machines lane's branch is `cursor/state-machines-c94c`. The full-fix batch Tony named on 2026-11-18 uses `cursor/sb-full-fix-b165`. Principle VII's named branch for that batch is `cursor/sb-full-fix-b165`.
- Do not delete or weaken a passing test. Main `c9417c885fc3f12fdcf5201fa15f0e807d50f05d` is 416 passed and 0 failed. A red test required by Principle V may be the only failing assertion, and that test is made green without rewriting unrelated tests. `npm run typecheck` stays 0 errors.
- The worker typecheck on this batch stays 0 errors. It does not go up.
- An open question is reported. It is not answered by guessing.

## Governance

This constitution supersedes local habit. An amendment that removes or redefines a principle needs Tony's own words, a version bump, and a note of what changed. Wording clarifications that do not weaken a principle are patch or minor bumps.

Compliance review: QA checks the plan's Security & data section, the branch, the exact head, and the gates in the feature spec. A missing Security & data section, a force push, a hook bypass, a push to `main`, a merge, or a deploy is a stop.

**Version**: 1.0.1 | **Ratified**: 2026-11-12 | **Last Amended**: 2026-11-18

Amendment 1.0.1: Tony's full-fix instruction requires new regression tests, and main is already 416 passed after the erasure merge. The repo rule that named 403 is now "do not delete or weaken a passing test". The full-fix branch is named. No principle is weakened.
