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

`bash deploy.sh` without `--dry-run` must exit non-zero while `deploy/assets/UNREPRODUCED` exists. That refusal is the expected result. Do not delete the marker to force an upload.

Do not run `wrangler login`, `wrangler deploy` without `--dry-run`, or `wrangler secret`. Do not create `.dev.vars`.

The binding check is `harness/tests/v24-bindings.test.ts`. The `/graph` check is `harness/tests/graph-entry.test.ts`.
