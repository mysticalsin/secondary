# deploy/ decision log

The user asked for this log for `deploy/`, and for the guard fix below. Comments were not stripped. Existing tests were not removed.

- Pin both Wrangler calls to `wrangler.jsonc`, and fail closed on a shadow config or an asset symlink.
  - Without `--config`, Wrangler 4.158.0 prefers `wrangler.json` over `wrangler.jsonc` and follows `.wrangler/deploy/config.json`.
  - `deploy.sh` passes `--config wrangler.jsonc` on both calls and uses `dirname -- "$0"`.
  - `lstat` refuses `wrangler.json`, `wrangler.toml`, or `.wrangler/deploy/config.json` with `config-shadow` when the path is present or the stat errors.
  - `lstat` of the configured directory fails closed. A dangling symlink, a symlink loop, or a stat error is `assets-directory-present`. `ENOENT` is the only absent result.
  - `lstat` of `deploy` or `deploy/assets` refuses a symlink with `assets-symlink`.
  - Evidence, Wrangler 4.158.0, no token, `--dry-run --assets` on an empty temp directory. A `wrangler.json` whose entry is `missing-shadow-entry.ts`, with no `--config`: exit 1, `missing-shadow-entry.ts` was not found. The same file with `--config wrangler.jsonc`: exit 0, `Read 0 files`, `--dry-run: exiting now`. A `.wrangler/deploy/config.json` pointing at `/tmp/redirected-wrangler.jsonc`, with no `--config`: `Using redirected Wrangler configuration` and that path. The same redirect with `--config wrangler.jsonc`: exit 0 and no redirected-configuration line.
  - Residual: `mktemp` follows `TMPDIR`, so the caller can choose where the `0700` directory is created. Same-user writes during the Wrangler upload remain accepted.
  - Residual: cleanup is `trap 'rm -rf "$tmp"' EXIT`. Cleanup on a signal is untested.
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
