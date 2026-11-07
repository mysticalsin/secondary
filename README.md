# Secondary API recovery

Private preservation of source recovered from the deployed Secondary API Worker source map. This is the API Worker plus two shared packages. It is not the original git history, not the static UI, and not the other Workers that this API calls.

Recovered files live under `recovered-source/` and are not rewritten. New config, the package symlink, and tests live outside that directory. Details, omissions, and command results are in [RECOVERY.md](RECOVERY.md).

## Run locally

Node 22.18 or newer. Install does not run dependency lifecycle scripts (`@openuidev/lang-core` has an install-telemetry postinstall).

```bash
npm install --ignore-scripts --no-audit --no-fund
npm test
npm run typecheck
```

`npm test` runs 17 isolated tests of recovered policy, receipt, log, HMAC, agent-plan, and GenUI code. `npm run typecheck` checks the shared packages and the Worker modules whose imports do not depend on missing files.

`npm run typecheck:worker` typechecks the whole Worker and fails. The missing modules are listed in RECOVERY.md. There is no deploy script in this repo. Do not deploy, and do not point Wrangler at a Cloudflare account from here.
