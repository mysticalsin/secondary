# deploy/ decision log

The user asked for this log for `deploy/`, and for the guard fix below. Comments were not stripped. Existing tests were not removed.

- Make Wrangler upload a directory that only the guard writes, and read that directory from `wrangler.jsonc`.
  - `wrangler.jsonc` and `deploy/guard.ts` both named `deploy/assets`, so `./node_modules/.bin/wrangler deploy` and `npx wrangler deploy` never ran the guard.
  - `package.json` had no `deploy` script, so nothing forced `deploy.sh`.
  - `deploy.sh` hashed the source and then exec'd Wrangler, which read the source again.
  - `deploy/guard.ts` matched `UNREPRODUCED` with case-sensitive equality, so a file named `unreproduced` with its real hash passed.
