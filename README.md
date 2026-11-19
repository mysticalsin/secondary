# Secondary API recovery

Private preservation of source recovered from the deployed Secondary API Worker source map. This is the API Worker plus two shared packages. It is not the original git history, not the static UI, and not the other Workers that this API calls.

Recovered files live under `recovered-source/` and are not rewritten. New config, the package symlink, and tests live outside that directory. Details, omissions, and command results are in [RECOVERY.md](RECOVERY.md).

## Run locally

Node 22.18 or newer. Install does not run dependency lifecycle scripts (`@openuidev/lang-core` has an install-telemetry postinstall).

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run typecheck
```

`npm ci` installs the lockfile pin. `package.json` pins `wrangler` at exactly `4.158.0`. `deploy.sh` does not check that version again at runtime.

```bash
npm run verify:provenance
```

That check compares every reconstructed file with the commit that contains its source blob. The five entries use `db3e8548bf74b863847ed9fbf1b71573dd384ee8`, `be6eb37f31e62f0f04a610202cca120aa4d9302f`, and `4ba133b04e49cfb20abe0a22b5ca367284456356`. None of those commits is an ancestor of `main`. They are in this clone only as the annotated tags `provenance/worker-119-db3e8548`, `provenance/worker-119-be6eb37f`, and `provenance/worker-119-4ba133b0`. Fetch them with:

```bash
git fetch origin tag provenance/worker-119-db3e8548 tag provenance/worker-119-be6eb37f tag provenance/worker-119-4ba133b0
```

A clone without those tags exits 1. For each missing object the script prints `missing provenance object <sha>: git fetch origin tag provenance/worker-119-<prefix>`. The check is not part of `npm test`.

`npm run deploy` is `./deploy.sh`. With no arguments, or with `--dry-run`, that script is a dry run: it runs the asset guard and then `wrangler deploy --dry-run`. On this tree `deploy/assets/UNREPRODUCED` makes that exit 2 before Wrangler starts. A real deploy is `./deploy.sh --apply`. Do not run `--apply` from here, and do not point Wrangler at a Cloudflare account. The UI bytes are still the unreproduced marker.
