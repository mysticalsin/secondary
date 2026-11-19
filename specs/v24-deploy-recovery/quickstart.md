# Quickstart: v24 deploy recovery

From the repo root, on `cursor/recover-v24-deploy-1c66`:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run typecheck
npm run typecheck:worker
npm run verify:provenance
bash deploy.sh
```

`npm ci` installs the lockfile pin of Wrangler `4.158.0`. `deploy.sh` does not check that version again. `npm run deploy` and `bash deploy.sh` with no arguments are a dry run, and so is `bash deploy.sh --dry-run`. On this tree they exit 2 while a `deploy/assets` name case-folds to `unreproduced`, including an empty directory of that name, and Wrangler is not started. They also exit 2 when that marker is gone and `deploy/assets/MANIFEST.sha256` is missing or does not match the files, and when `deploy/.staged` exists. `deploy/.staged` stays absent. When the guard passes, the dry run is `wrangler deploy --dry-run --assets <tmp> --config wrangler.jsonc`. A real deploy is `bash deploy.sh --apply`. `npm test` refuses `--apply` before Wrangler. A `wrangler.json`, `wrangler.toml`, `.wrangler/deploy/config.json`, `.env`, `.env.*`, `.dev.vars`, `.dev.vars.*`, or a symlink at `deploy`, `deploy/assets`, `deploy/graph`, `deploy/graph-entry.ts`, or `deploy/.staged` also exits 2. That refusal is the expected result. Do not delete the marker, and do not add asset bytes, to force an upload.

Provenance needs the annotated tags `provenance/worker-119-db3e8548`, `provenance/worker-119-be6eb37f`, and `provenance/worker-119-4ba133b0`. None of those commits is an ancestor of `main`. Fetch them with `git fetch origin tag provenance/worker-119-db3e8548 tag provenance/worker-119-be6eb37f tag provenance/worker-119-4ba133b0`.

The asset check is `harness/tests/v24-bindings.test.ts`. Its fixtures are temporary synthetic files. The pass case stops at the guard.

Do not run `wrangler login`, `bash deploy.sh --apply`, or `wrangler secret`. Do not create `.dev.vars` or `.env`.

The binding check is `harness/tests/v24-bindings.test.ts`. The `/graph` check is `harness/tests/graph-entry.test.ts`.
