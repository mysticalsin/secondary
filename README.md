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
npm run typecheck:workers
npm run build:worker
npm run build:workers
```

`npm test` runs the isolated recovered-code tests. `npm run typecheck:workers` typechecks the API reconstruction and the audit, connector, MCP, ops, and pages overlays. `npm run build:workers` writes local bundles. The MCP bundle uses the Node platform because the published `agents` package imports Node builtins. `npm run typecheck:worker` still typechecks the recovered API tree alone and fails. `npm run deploy` refuses.
