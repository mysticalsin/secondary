# Quickstart: v24 deploy recovery

From the repo root, on `cursor/recover-v24-deploy-1c66`:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run typecheck
npm run typecheck:worker
npm run verify:provenance
bash deploy.sh --dry-run
```

`npm run deploy` and `bash deploy.sh` without `--dry-run` must exit 2 while a `deploy/assets` name case-folds to `unreproduced`, including an empty directory of that name. They must also exit 2 when that marker is gone and `deploy/assets/MANIFEST.sha256` is missing or does not match the files, and when `deploy/.staged` exists. `deploy/.staged` stays absent. `bash deploy.sh --dry-run` passes `--assets` and `--config wrangler.jsonc`. A `wrangler.json`, `wrangler.toml`, `.wrangler/deploy/config.json`, or a symlink at `deploy`, `deploy/assets`, or `deploy/.staged` also exits 2. That refusal is the expected result. Do not delete the marker, and do not add asset bytes, to force an upload.

The asset check is `harness/tests/v24-bindings.test.ts`. Its fixtures are temporary synthetic files. The pass case stops at the guard.

Do not run `wrangler login`, `wrangler deploy` without `--dry-run`, or `wrangler secret`. Do not create `.dev.vars`.

The binding check is `harness/tests/v24-bindings.test.ts`. The `/graph` check is `harness/tests/graph-entry.test.ts`.
