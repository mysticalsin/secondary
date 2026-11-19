# deploy/ decision log

The user asked for this log for `deploy/`, and for the guard fix below. Comments were not stripped. Existing tests were not removed.

- Rehash through `copyThenRehash`, and do not read an environment variable while staging.
  - `DEPLOY_AFTER_COPY` was test scaffolding on the real deploy path. A stray value could replace staged bytes. It is gone. `deploy/guard.ts` does not read `process.env`. `deploy.sh` and the guard CLI call `copyThenRehash` with no hook.
  - The optional `afterCopy` argument runs after the write and before the rehash. The unit test passes a hook that replaces the file and expects `assets-manifest-mismatch`. That call does not start Wrangler.
  - The test added in `5dbf2bad` expected the env var to refuse the deploy. That assertion is replaced: `deploy.sh` with `DEPLOY_AFTER_COPY` set still stages the original bytes and starts the stub.
  - Proof, with the rehash removed and `afterCopy` left in place: `npm test` exit 1, 473 tests, 472 passed, 1 failed. The only failure was `afterCopy that replaces a staged file is refused and does not start wrangler` (`{ ok: true }` against `assets-manifest-mismatch`). The rehash was restored.
  - The extra `chmod` stays removed. Same-user writes to the `0700` directory `mktemp -d` creates, during the Wrangler upload, remain an accepted residual.
- Rehash each staged copy after the write, and do not chmod the temp directory.
  - The rehash after `writeFileSync` had no test. Deleting it left the suite green.
  - `DEPLOY_AFTER_COPY` was the test seam in `bc227aa`. Devin rejected it, and the next fix removes it. The proof below was for that seam: with the rehash removed, `npm test` exit 1, 471 tests, 470 passed, 1 failed, only `a tmp copy changed after write and before rehash is refused` (99 !== 2).
  - `chmod 0700` after `mktemp -d` was redundant. `mktemp -d` creates the directory mode `0700`.
  - Same-user writes to that `0700` directory during the Wrangler upload remain an accepted residual. The mode is the one `mktemp -d` creates.
- Stage outside the path `wrangler.jsonc` names, and pass that temp directory with `--assets`.
  - A leftover `deploy/.staged` is what a direct `wrangler deploy` uploads. `deploy.sh` had no `trap`, so killing it left that directory behind. Deleting the cleanup line left every test passing.
  - A write into `deploy/.staged` after the guard returned was the bytes Wrangler uploaded.
  - An empty directory named `unreproduced` in any case was not a sentinel, because the walk recorded files only.
  - The binding test's directory assertion changed from `deploy/assets` to `deploy/.staged` in `b6254be`. Devin accepted that edit. The bytes test no longer expects a write into the configured directory.
  - Same-user writes to the temp directory during upload are an accepted residual. `mktemp -d` creates it mode `0700`.
- Make Wrangler upload a directory that only the guard writes, and read that directory from `wrangler.jsonc`.
  - `wrangler.jsonc` and `deploy/guard.ts` both named `deploy/assets`, so `./node_modules/.bin/wrangler deploy` and `npx wrangler deploy` never ran the guard.
  - `package.json` had no `deploy` script, so nothing forced `deploy.sh`.
  - `deploy.sh` hashed the source and then exec'd Wrangler, which read the source again.
  - `deploy/guard.ts` matched `UNREPRODUCED` with case-sensitive equality, so a file named `unreproduced` with its real hash passed.
