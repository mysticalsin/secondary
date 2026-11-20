# Plan 024 — Drop-claim whitespace key

Status: IMPLEMENTED. The red commit is `b269d55fed1e44aa8130e9283ea5dd925d95bff3`.

Risk: LOW. A whitespace-only key returns `ok: false` and writes nothing. `reconcileBrainMember` does not read the code, and no route turns it into an HTTP body, so the status does not change.

Parent: `58600c0cc13c2cb364fdc72877485988e4b6ae94`.

## Ticket

SB-DROPCLAIM-WHITESPACE-KEY. Low. Owner MSB.

Done when:

- [ ] A space, a tab, a newline, and `" \t\n "` return `{ ok: false, code: "state_unreadable" }`.
- [ ] Each of those calls leaves the pending row, the first-time claimed row, and the schema unchanged.
- [ ] A null key and `""` still return `state_unreadable`.
- [ ] A key that matches no row still returns `claim_not_found`.
- [ ] The drop-claim row in `docs/state-machines.md` names `!key` or `key.trim() === ""` as `state_unreadable`.

## Why

A whitespace-only key is not a stored claim. `claim_not_found` says the key was looked up and missed. `state_unreadable` says there is no key to read. Null and `""` already use that word. Space, tab, newline, and mixed whitespace join them. A real key that misses a row stays `claim_not_found`.

## Red

TEST COMMAND:

```
node --experimental-strip-types --test --test-reporter=spec --test-name-pattern "space key|tab key|newline key|a whitespace key" harness/tests/brain-member-drop-claim-direct.test.ts
```

Red on `b269d55fed1e44aa8130e9283ea5dd925d95bff3`, before the production change: exit 1. 4 tests, 0 pass, 4 fail. `duration_ms` 462.181322.

- `brain drop: a space key is state_unreadable and writes nothing` fails: actual `'claim_not_found'`, expected `'state_unreadable'`.
- `brain drop: a tab key is state_unreadable and writes nothing` fails: actual `'claim_not_found'`, expected `'state_unreadable'`.
- `brain drop: a newline key is state_unreadable and writes nothing` fails: actual `'claim_not_found'`, expected `'state_unreadable'`.
- `brain drop: a whitespace key is state_unreadable and writes nothing` fails: actual `'claim_not_found'`, expected `'state_unreadable'`.

## Mutant

None of this edit is applied in a commit. After the fix, removing the `key.trim() === ""` clause so the guard is `if (!key)` fails the four whitespace tests again. The mutant is `dc-whitespace-no-trim`.

## Rollback

Revert onto `58600c0cc13c2cb364fdc72877485988e4b6ae94`. Nothing is migrated.

## Unslop

| Before | After | Kept |
| --- | --- | --- |
| A whitespace-only key was `claim_not_found` | `state_unreadable` | `ok: false`, and the rows stay |
| Null and `""` were unreadable | They stay `state_unreadable` | A missed real key stays `claim_not_found` |
