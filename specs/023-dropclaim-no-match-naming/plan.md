# Plan 023 — Drop-claim no-match naming

Status: IMPLEMENTED. The red commit is `eb303c496daa19ca2d8c389ae8bbf126fab3f86d`.

Risk: LOW. The no-match branch still returns `ok: false` and writes nothing. `reconcileBrainMember` does not read the code, and no route turns it into an HTTP body, so the status does not change.

Parent: `3192477c2550c3776c83a5e2fd5ff34693734256`.

## Ticket

SB-DROPCLAIM-NO-MATCH-NAMING.

Done when:

- [ ] A `brainMemberDropClaim` call whose key matches no row returns `{ ok: false, code: "claim_not_found" }`.
- [ ] That call does not change the stored row.
- [ ] A null key still returns `{ ok: false, code: "state_unreadable" }`.
- [ ] The two tests that matched the old no-match string expect `claim_not_found`.
- [ ] The drop-claim row in `docs/state-machines.md` names `claim_not_found` for the select that returns not 1.

## Why this name

`claim_not_found` says the claim key was not on a row. `no_match` could be read as a role mismatch. `state_unreadable` describes an unknown stored word, and this branch is a missed key, not an unknown word.

## Grep

`state_unreadable` on the drop-claim path:

| Place | What it is | This slice |
| --- | --- | --- |
| `src/worker/brains/store.ts:464` | `!key` | Stays `state_unreadable` |
| `src/worker/brains/store.ts:499` | Select of the claim key returned not 1 | Becomes `claim_not_found` |
| `src/worker/brains/store.ts:1328` | The method's return type, which today is only `state_unreadable` | Adds `claim_not_found` and keeps `state_unreadable` for the null key |
| `docs/state-machines.md:797` | The `!key` row | Stays |
| `docs/state-machines.md:801` | The select-not-1 row | Becomes `claim_not_found` |
| `harness/tests/brain-member-drop-existing.test.ts:103` | Drop of a key that no longer matches | Expects `claim_not_found` |
| `harness/tests/brain-member-reconcile.test.ts:246` | Drop of `chg_other` against a null key | Expects `claim_not_found` |
| `src/worker/brains/store.ts:1382` and `:1403` | Callers. The return value is not read | No string match |

Other `state_unreadable` results, including `brainMemberRelease`, `brainMemberNote`, and the other machines, are not this path and stay.

## Red

TEST COMMAND:

```
node --experimental-strip-types --test --test-reporter=spec --test-name-pattern "pre-existing member finished pending|legacy claim with no key" harness/tests/brain-member-drop-existing.test.ts harness/tests/brain-member-reconcile.test.ts
```

Red on this commit, before the production change: exit 1. 2 tests, 0 pass, 2 fail. `duration_ms` 232.547353.

- `brain drop: a pre-existing member finished pending keeps the row` fails `deepStrictEqual`: actual `dropped: 'state_unreadable'`, expected `dropped: 'claim_not_found'`. The row is the same object on both sides.
- `brain reconcile: a legacy claim with no key stays when the read finds no governance row` fails `'state_unreadable' !== 'claim_not_found'`.

## Mutant

None of this edit is applied in a commit. After the fix, restoring `state_unreadable` at the no-match return fails both tests again. The mutant is `dc-no-match-old-name`.

## Rollback

Revert onto `3192477c2550c3776c83a5e2fd5ff34693734256`. Nothing is migrated.

## Unslop

| Before | After | Kept |
| --- | --- | --- |
| A missed claim key was `state_unreadable` | `claim_not_found` | `ok: false`, and the row stays |
| A null key used the same word | A null key stays `state_unreadable` | No new write |
