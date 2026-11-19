# deploy/ decision log

The user asked for this log for `deploy/`, and for the guard fix below. Comments were not stripped. Existing tests were not removed.

- Stage outside the path `wrangler.jsonc` names, and pass that temp directory with `--assets`.
  - A leftover `deploy/.staged` is what a direct `wrangler deploy` uploads. `deploy.sh` had no `trap`, so killing it left that directory behind. Deleting the cleanup line left every test passing.
  - A write into `deploy/.staged` after the guard returned was the bytes Wrangler uploaded.
  - An empty directory named `unreproduced` in any case was not a sentinel, because the walk recorded files only.
  - The binding test's directory assertion changed from `deploy/assets` to `deploy/.staged` in `b6254be`. Devin accepted that edit. The bytes test no longer expects a write into the configured directory.
  - Same-user writes to the `0700` temp directory during upload are an accepted residual.
- Make Wrangler upload a directory that only the guard writes, and read that directory from `wrangler.jsonc`.
  - `wrangler.jsonc` and `deploy/guard.ts` both named `deploy/assets`, so `./node_modules/.bin/wrangler deploy` and `npx wrangler deploy` never ran the guard.
  - `package.json` had no `deploy` script, so nothing forced `deploy.sh`.
  - `deploy.sh` hashed the source and then exec'd Wrangler, which read the source again.
  - `deploy/guard.ts` matched `UNREPRODUCED` with case-sensitive equality, so a file named `unreproduced` with its real hash passed.
