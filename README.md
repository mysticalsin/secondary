# Secondary API recovery

Private preservation of recovered Secondary Worker source and delivered shell text. It is not the original git history and not a complete UI.

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
npm run test:workerd
```

`npm test` runs the Node tests, including hash checks of the delivered shell text. Those tests do not execute the delivered JavaScript. `npm run test:workerd` runs the recovered Workers in local workerd through Miniflare, with synthetic bindings and no upload. `npm run typecheck:workers` typechecks the six reconstruction overlays. `npm run build:workers` writes local esbuild bundles; the MCP esbuild bundle is Node-only. `npm run build:workerd` is Wrangler's dry-run bundler for the MCP entry. `npm run typecheck:worker` still typechecks the recovered API tree alone and fails with 119 errors. `npm run deploy` refuses.

Delivered shell text is under `recovered-delivery/`, including the source-view HTML shell and the main bundle. After `npm run build:workerd`, `node reconstruction/fixture/serve.mjs` serves those preserved bytes on `http://127.0.0.1:43131` and proxies `/v1` to the recovered API in local workerd. The dev persona is chosen by the server session, not by a client header. Fonts and logos are missing and are not fetched. `/reconstruction/genui` and `/reconstruction/observability` are new pages. The observability page is not a copy of the reference still.
