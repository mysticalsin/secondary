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

`npm test` runs the Node tests, including hash checks of the delivered shell text. Those tests do not execute the delivered JavaScript. `npm run test:workerd` runs the recovered Workers in local workerd through Miniflare, with synthetic bindings and no upload. It includes the local OAuth MCP session in `reconstruction/workerd/mcp-oauth.test.mjs` and the two-user import gate in `reconstruction/workerd/import-isolation.test.mjs`. The owner-scope checklist is `reconstruction/ACCEPTANCE.md`. `npm run typecheck:workers` typechecks the derived workers. The API project includes the release edge and the harness, not only the recovered index. `npm run build:workers` writes local esbuild bundles; the MCP esbuild bundle is Node-only. `npm run build:workerd` is Wrangler's dry-run bundler for the MCP entry. `npm run typecheck:worker` still compiles the original recovered API tree by itself. That snapshot has no `Env`, `types.ts`, agent-ui barrel, or `view-plan.ts`, so it fails. Those modules exist only in the derived tree. `npm run deploy` refuses.

Delivered shell text is under `recovered-delivery/`, including the source-view HTML shell and the main bundle. After `npm run build:workerd`, `node reconstruction/fixture/serve.mjs` serves those preserved bytes on `http://127.0.0.1:43131` and proxies `/v1` to the recovered API in local workerd. The dev persona is chosen by the server session, not by a client header. Fonts and logos are missing and are not fetched. `/reconstruction/genui` remains the reconstruction GenUI flow. Settings → Observability is served at `/settings/observability`. Settings → Import is served at `/reconstruction/import`. The captured settings router has neither item, so the served shell adds those links without changing stored delivery bytes. Observability stays a local preview, not a copy of the reference still.

Import accepts pasted text or a local `.txt` or `.md` file, at most 7000 characters. The preview and the local MCP tools `personal_import`, `personal_import_read`, and `personal_import_search` use the same `/harness/import` gate and the recovered personal workspace. `personal_note_create` keeps its name and stores a receipt through that gate. The preview session is the seeded consultant, or the CEO plus-address in the same local tenant. It cannot choose a second tenant. Two new OAuth users in two tenants are covered by `reconstruction/workerd/mcp-import-roundtrip.test.mjs`. External model usage on an import is `unknown`. A usage ledger on the local API worker records that unknown operation, optional client-reported numbers, and synthetic fixtures. Settings → Observability → Usage reads it for the signed-in session. `/harness/*` is not a production route. The bundled MCP entry is the reconstruction `import-entry.ts` composition, not the recovered `index.ts`. `reconstruction/release/entry.ts` is the protected-dev edge checked by `reconstruction/workerd/release-auth.test.mjs`. Browser routes serve the captured shell, the Mantu Observability and import pages, and `/brains/me` for the signed-in person's own imported context. That page is a deterministic plan with AI disabled. It is not the recovered org planner and not a live model. Machine `/mcp` is a separate service binding. Settings → Observability → Activity is `/settings/observability?section=activity`. It starts empty. A signed-in person can paste `relay.codex-review-run/1` NDJSON; the page stores it for that verified user and tenant and does not open evidence paths. `node reconstruction/activity/build-offline.mjs` writes one HTML file, `reconstruction/activity/offline/index.html`, with the pinned schema embedded and no review records. That file is the local paste page. Its typed label and session cache are not authentication and it is not the release page. The synthetic fixtures in the tests are not a historical ledger. The fixture server is not that edge. It is not a deploy, and a local test JWT is not production Access or Entra. The inventory is `reconstruction/release/INVENTORY.md`.
