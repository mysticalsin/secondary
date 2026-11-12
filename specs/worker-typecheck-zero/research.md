# Research: Worker typecheck zero

## Decision: Promote the four named blobs, not the `db3e8548` tree

- Decision: Copy blob bytes for the four destinations Devin named. Do not merge `db3e8548`.
- Rationale: `types.ts` (`e8a6cc08cd5cf4bdc4ab102a0c2c5d00ac430e9e`) and `agent-ui/index.ts` (`ed80553761da2db13495c6eb250a438d7ef54327`) are the `db3e8548` blobs. `view-plan.ts` at `db3e8548` is `82bac154e813b9fa59c2f93e871127e0c37c3b8e`. The named blob is `d4b092167f4e1875d0254c98499a979cbd305dd6`. `view-plan.validator.d.ts` at `db3e8548` is `a403845f6cd562a3b2488e0e736aa57aaf57cbd2`. The named blob is `5a3b92e373e2ba7c38cc43e9b217719b0f8db13c`. `db3e8548` is not an ancestor of `387f2c8b`.
- Alternatives considered: Checking out `db3e8548` paths. Rejected because two of the four blobs would be the wrong bytes, and the checkout would be a merge-sized import of `reconstruction/`.

## Decision: Do not run `wrangler types` on this branch

- Decision: Env uses blob `841f0dbc97ac0c6d5caaf83bf25b1609a08bdb2d`, checked line by line against names the code reads.
- Rationale: No wrangler config is on `387f2c8b`. Three configs exist only off this branch (`reconstruction/wrangler.jsonc`, `reconstruction/release/wrangler.jsonc`, `reconstruction/mcp/wrangler.jsonc`). The Env blob's own header says it was written because no recovered wrangler config could regenerate the interface, and that secret fields are optional strings with no values.
- Alternatives considered: Picking one off-branch wrangler config and running `wrangler types`. Rejected. That chooses a config Tony did not name.

## Decision: Do not add or edit the line-111 test

- Decision: Leave `harness/runtime/whole-api-causes.test.ts` absent. If it appears and line 111 would change, stop and ask.
- Rationale: The file is not on this branch. At `1e8f67c` (not an ancestor) line 111 is the TS2304 cause sentence inside a recorded report. Devin said the line stays green and unchanged.
- Alternatives considered: Bringing the test onto this branch so the "green" check can run. Rejected. That adds a file the spec phase was told not to change, and the line's counts would move once types are promoted.

## Decision: The standing red is the worker typecheck

- Decision: Each promotion commit is judged by a lower `error TS` count. A new red test is added only when a promoted type disagrees with the code.
- Rationale: The baseline failure is already 119 errors. A test that only repeats that count is a second copy of the same gate. A real mismatch still needs its own red test before a fix, and that test is not line 111.
- Alternatives considered: Writing a new failing test before each blob copy. Rejected. The copy is the module the imports already name. The typecheck is the red.

## Decision: CI attachment waits for a file name

- Decision: Do not create a workflow file. Stop and ask Tony which file gets `npm run typecheck:worker` as an exact-head required check.
- Rationale: This branch has no CI configuration. Inventing `.github/workflows/` would guess the provider.
- Alternatives considered: Treating `package.json`'s `typecheck:worker` script as the CI gate. Rejected. The script exists and is not a CI check on an exact head.
