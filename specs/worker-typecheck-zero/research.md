# Research: Worker typecheck zero

## Decision: Keep the recovered manifest, and list promotions separately

- Decision: `candidate-manifest.json` stays the recovered intake list and is not edited. Promoted files are recorded in `reconstructed-manifest.json` at the repository root. T018 commits an empty `files` array and the intake test update before any promoted file. Each promotion commit appends one entry with the file.
- Rationale: Devin ruled C. Adding `env.d.ts` under `recovered-source` makes `harness/tests/intake.test.ts` fail, because that test requires the tree to equal the candidate manifest. A separate list keeps the recovered manifest intact and still rejects an unlisted path.
- Alternatives considered: Adding promoted paths to `candidate-manifest.json`. Rejected. That file is the recovered intake record.

## Decision: Promote the four named blobs, not the `db3e8548` tree

- Decision: Write `env.d.ts` from blob `841f0dbc97ac0c6d5caaf83bf25b1609a08bdb2d` before `types.ts`. That blob's leading comment is N=9, and the tail hash is `a8e2ea493e635421b1acfb0ad5e7557ed39c4d73`. The two import specifiers are then retargeted. Then take bytes from the four blobs Devin named. Do not merge or cherry-pick `db3e8548`. Remove only the leading provenance comment and any blank lines directly after it. N is 8, 7, 13, and 5, and none of the four has a blank line after the comment. Every other byte stays identical. The agent-ui barrel is placed beside the existing siblings. Those siblings are not copied.
- Rationale: `types.ts` (`e8a6cc08cd5cf4bdc4ab102a0c2c5d00ac430e9e`) and `agent-ui/index.ts` (`ed80553761da2db13495c6eb250a438d7ef54327`) are the `db3e8548` blobs. `view-plan.ts` at `db3e8548` is `82bac154e813b9fa59c2f93e871127e0c37c3b8e`. The named blob is `d4b092167f4e1875d0254c98499a979cbd305dd6`. `view-plan.validator.d.ts` at `db3e8548` is `a403845f6cd562a3b2488e0e736aa57aaf57cbd2`. The named blob is `5a3b92e373e2ba7c38cc43e9b217719b0f8db13c`. `db3e8548` is not an ancestor of `387f2c8b`.
- Alternatives considered: Checking out `db3e8548` paths. Rejected because two of the four blobs would be the wrong bytes, and the checkout would be a merge-sized import of `reconstruction/`.

## Decision: `env.d.ts` blob `841f0dbc97ac` is the Env source of truth

- Decision: Check blob `841f0dbc97ac0c6d5caaf83bf25b1609a08bdb2d` line by line against names the code reads. Do not adopt an off-branch wrangler config. A wrangler or deploy config is a separate change and is out of scope.
- Rationale: Devin ruled this blob is the source of truth. The blob's header says secret fields are optional strings with no values.
- Alternatives considered: Running `wrangler types` against `reconstruction/wrangler.jsonc`, `reconstruction/release/wrangler.jsonc`, or `reconstruction/mcp/wrangler.jsonc`. Rejected. Those files are off this branch, and adopting one is out of scope.

## Decision: Line 111 is conditional

- Decision: Apply the line 111 rule only when the tree contains `harness/runtime/whole-api-causes.test.ts`. This branch does not. If a tree contains the file and the work would change line 111, stop and ask.
- Rationale: Devin ruled the check is conditional on the file being present. The file is absent here, so there is no line to edit and the file is not added.
- Alternatives considered: Copying the test from `1e8f67c` onto this branch. Rejected. That would create the file the conditional check is not asking this tree to carry.

## Decision: The standing red is the worker typecheck

- Decision: Each promotion commit is judged by a lower `error TS` count. A new red test is added only when a promoted type disagrees with the code.
- Rationale: The baseline failure is already 119 errors. A test that only repeats that count is a second copy of the same gate. A real mismatch is a diagnostic the parent commit does not report. It needs its own red test before a fix, and that test is not line 111. A name finding is the symmetric difference of Env property names and is not a real mismatch.
- Alternatives considered: Writing a new failing test before each blob copy. Rejected. The copy is the module the imports already name. The typecheck is the red.

## Decision: Do not add CI while main has none

- Decision: Stop and report. CI is a separate reviewed commit that extends main's existing CI system, with no new infrastructure. Main `190cd04877812c1d238c4468e98a8714086b457f` has no CI config. Until that commit exists, QA gates each T004+ head by running `npm run typecheck:worker` and recording the SHA and exit code. No merge until CI enforces the check on the exact head.
- Rationale: Devin ruled that a missing main CI system is a stop, not a prompt to invent one.
- Alternatives considered: Adding `.github/workflows` on this branch. Rejected. That is new infrastructure, and main has no CI system to extend.
