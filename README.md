# Secondary API recovery

Private preservation of source recovered from the deployed Secondary API Worker source map. This is the API Worker plus two shared packages. It is not the original git history, not the static UI, and not the other Workers that this API calls.

Recovered files live under `recovered-source/` and are not rewritten. New config, the package symlink, and tests live outside that directory. Details, omissions, and command results are in [RECOVERY.md](RECOVERY.md).

## Run locally

Node 22.18 or newer. Install does not run dependency lifecycle scripts (`@openuidev/lang-core` has an install-telemetry postinstall).

```bash
npm install --ignore-scripts --no-audit --no-fund
npm test
npm run typecheck
npm run typecheck:reconstructed
npm run build:worker
```

`npm test` runs the isolated recovered-code tests, including auth, tenant, and resource gates. `npm run typecheck` checks the shared packages and the Worker modules that do not need the missing files. `npm run typecheck:reconstructed` typechecks the whole API Worker through `reconstruction/`, where the three missing modules are new files derived from call sites. `npm run build:worker` writes a local esbuild bundle. `npm run typecheck:worker` still typechecks the recovered tree alone and fails. `npm run deploy` refuses.
