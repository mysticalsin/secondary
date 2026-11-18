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

`npm test` on this tree passed 441 and failed 0. `npm run typecheck` and `npm run typecheck:worker` each reported 0 `error TS` lines.

```bash
npm run verify:provenance
```

That check compares every reconstructed file with the commit that contains its source blob (`db3e8548bf74b863847ed9fbf1b71573dd384ee8`, `be6eb37f31e62f0f04a610202cca120aa4d9302f`, and `4ba133b04e49cfb20abe0a22b5ca367284456356`). A clone that does not have those commits, including a shallow clone or a copy used offline, exits 1 and prints `sourceCommit is not a readable tree`. The check is not part of `npm test`, and it is not stubbed.

There is no deploy script in this repo. Do not deploy, and do not point Wrangler at a Cloudflare account from here.
