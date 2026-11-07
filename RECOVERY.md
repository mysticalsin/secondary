# Recovery record

Private intake of one deployed Worker. This file is new. `PROVENANCE.md` and `candidate-manifest.json` are the intake records, copied unchanged.

## Provenance

The archive `intake/secondary-api-private-source-candidate.tar.gz` is the reviewed intake.

| Check | Result |
| --- | --- |
| SHA-256 | `7a1c16daa666f635ca5bffc08feae0f81fc1ff21334d64678b17613446323dce` |
| Size | 341428 bytes |
| `PROVENANCE.md` SHA-256 | `f15f392226ab8350386ac2f1e8e21faf08dcd9a17decf36b420e10a7c4d5df10` |
| `candidate-manifest.json` SHA-256 | `330452d57b8704a69da263b64342b26c8b7fb1d828f111590a256ddff76cea77` |
| Manifest files | 117, all present, byte counts and SHA-256 match |
| Source bytes | 1227833 |
| Layout | 99 files under `recovered-source/worker/src`, 18 under `recovered-source/shared/packages` |
| Extensions | 116 `.ts`, 1 generated `.js` |

The manifest says the bytes came from `sourcesContent` in a source map of the deployed `secondary-api-dev` Worker (map SHA-256 `fbbb2928d9aa8ea9cfd043e1b1ea0226323784e9a71ff27a407e1d6571737985`). This repo does not contain that map, so that hash was not recomputed. Original git history and build config were not in the archive. Paths are the archive's safe mapping. Imports were left as recovered.

165 third-party sources were excluded by the intake and are not in this tree. That count was not re-derived here.

## What this tree is

Recovered product strings say Secondary, Company Brain, and My Secondary. The string Métis does not appear. Comments describe separate `workers/ops`, `workers/mcp`, `workers/audit`, and `workers/connector` calls. Their source is not here. `src/index.ts` serves non-API GET and HEAD from `env.ASSETS`; the static UI is not here. A local TOTO-OS dashboard is not part of this recovery.

Durable Object classes in this Worker are `TenantPolicy` (`src/tenant-policy.ts`) and `Workspace` (`src/workspace.ts`, extending `BrainBase` and `WikiBase`). `src/index.ts` re-exports `TenantPolicy` and `Workspace`.

## Layout adapter

Recovered imports were not edited. From `recovered-source/worker/src/*.ts`, `../../../packages/...` and from `recovered-source/worker/src/*/*.ts`, `../../../../packages/...` both resolve to a `packages/` directory at the repo root. The archive stored those packages at `recovered-source/shared/packages/`. The new symlink `packages` -> `recovered-source/shared/packages` makes the existing import strings resolve. It is not a claim about the original directory names above `src`.

`@secondary/policy` had no recovered `package.json` or barrel. `harness/adapters/policy-entry.ts` re-exports names that the recovered policy files already declare. `tsconfig.json` maps the package name to that adapter.

## Omissions that block a Worker build

These paths are imported and are not in the archive:

- `recovered-source/worker/src/types.ts` (`AppDeps`, `AppEnv`, `Session`, and the re-export of `AppDeps`)
- `packages/contracts/src/agent-ui/index.ts`
- `packages/contracts/src/view-plan.ts`

`Env` is used as a global name and is not declared in any recovered file. `src/ai/config.ts` says the non-AI bindings live in `wrangler.jsonc`. That config, `.dev.vars`, `deploy.sh`, and the binding-inventory test named in `src/stubs.ts` were not recovered.

The missing agent-ui barrel is imported for names that do exist in recovered siblings: `TURN_ACTIONS`, `TurnRequest`, `TurnRequestValue`, `LIMITS`, `AGENT_TOOLS`, `AgentToolName`, `agentSystemPrompt`, `agentToolDefs`, `SavedViewInput`, `SavedViewInputValue` (`schemas.ts`); `brainRefs`, `clean`, `lineOk`, `parseAgentProgram`, `toView`, `viewOfProgram`, `AgentNode` (`library.ts`, `view.ts`); `BrainRef`, `matchBrains`, `planProgram` (`planner.ts`); `lockTree` (`lock.ts`). The barrel file itself is absent. It was not recreated inside `recovered-source/`.

Also absent: SPA assets, the other Workers, `scripts/gen-validator.mjs`, a standalone `view-plan.schema.json` (the schema text is embedded in `src/generated/view-plan.validator.js`), docs named by comments (`docs/DESIGN-V6-MY-AGENT-GENUI.md`, `docs/research/OPENUI-SPIKE.md`, `docs/API-CONTRACT.md`), and any original test suite.

Names read from `env` in recovered code, grouped only by how the code uses them:

- Called like bindings: `ASSETS.fetch`, `AUDIT.fetch`, `BLOBS.head`, `CONNECTOR.fetch`, `TENANT_POLICY` and `WORKSPACE` passed to Durable Object namespace helpers in `src/stubs.ts`
- Read as strings: `ACCESS_AUD`, `ACCESS_LINKED_EMAILS`, `ACCESS_TEAM_DOMAIN`, `AI_DAILY_TOKEN_BUDGET`, `AI_ENABLED`, `AI_MODEL`, `AI_PROCESSOR_CONTRACT`, `AI_TIMEOUT_MS`, `AI_USER_DAILY_TOKEN_BUDGET`, `ANTHROPIC_API_KEY`, `AUDIT_KEY_API`, `AUDIT_KEY_ERASE`, `AUDIT_KEY_READ`, `AUTH_MODE`, `BRIEF_PROOF_KEY`, `CONNECTOR_HMAC_KEY`, `CONNECTOR_HMAC_KEY_PREVIOUS`, `CONNECTOR_HMAC_KID`, `CONNECTOR_HMAC_KID_PREVIOUS`, `DEFAULT_TENANT_ID`, `DEV_AUTH_BYPASS_EMAIL`, `DO_JURISDICTION`, `ENTRA_ALLOW_GUESTS`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, `ENTRA_TENANT_ID`, `ENVIRONMENT`, `INTERNAL_HMAC_KEY`, `INTERNAL_HMAC_KEY_PREVIOUS`, `INTERNAL_HMAC_KID`, `INTERNAL_HMAC_KID_PREVIOUS`, `MCP_PUBLIC_URL`, `OPS_HMAC_KEY`, `OPS_HMAC_KEY_PREVIOUS`, `OPS_HMAC_KID`, `OPS_HMAC_KID_PREVIOUS`, `PSEUDONYM_KEY`, `RATE_LIMIT_PER_MIN`, `RESTORE_ENABLED`, `RETENTION_BRIEF_DAYS`, `RETENTION_DRAFT_DAYS`, `SCIM_TENANT_ID`, `SCIM_TOKEN`, `SEED_TOKEN`, `TENANT_DOMAINS`, `WIKI_ALARMS`, `WIKI_SEARCH_PER_MIN`, `WIKI_SEED`, `WIKI_WRITE_PER_MIN`

No values for those names were in the source. This list is not a Wrangler config.

## Dependencies and licenses

No lockfile or `LICENSE` file was recovered. Recovered source has no SPDX headers. The app's own license is unknown.

Import specifiers in recovered source: `hono`, `hono/http-exception`, `hono/cookie`, `hono/body-limit`, `zod`, `jose`, `@openuidev/lang-core`, `@secondary/policy`, `cloudflare:workers`.

Public versions installed for this harness, not claimed as the deployed set:

| Package | Version | License field |
| --- | --- | --- |
| `hono` | 4.13.17 | MIT |
| `zod` | 4.6.7 | MIT |
| `jose` | 6.2.15 | MIT |
| `@openuidev/lang-core` | 1.1.0 | MIT |
| `ci-info` (dependency of lang-core, not imported by recovered code) | 4.4.0 | MIT |
| `typescript` | 5.9.3 | Apache-2.0 |
| `@types/node` | 22.19.0 | MIT |
| `@cloudflare/workers-types` | 5.20261107.1 | MIT OR Apache-2.0 |

`zod` 4.6.7 and `@openuidev/lang-core` 1.1.0 typecheck against the recovered shared packages, including `z.strictObject`, `z.toJSONSchema`, `defineComponent`, `createLibrary`, `createParser`, and `createStreamingParser`. That is compatibility with these published versions, not proof they were bundled. `src/agent-ui/library.ts` already describes lang-core as MIT. The 165 excluded third-party files were not reviewed. Wrangler is not installed.

`npm install` was run with `--ignore-scripts`. `.npmrc` keeps that on, because lang-core's postinstall sends install telemetry.

## Security review (scoped)

Pattern scan of the 117 files found no email literals, no PEM blocks, and no token-shaped assignments. Matches on "secret" and "key" are code that reads those values from the environment or redacts them. This is not a clearance.

The six seed/data/stub filenames are source, not a private dump:

- `shared/packages/policy/src/seed.ts` is a deterministic FNV fixture generator
- `worker/src/seed.ts` is dev seeding of the synthetic org
- `worker/src/stubs.ts` is Durable Object namespace helpers, not stored records
- `worker/src/brains/data.ts` is route code
- `worker/src/wiki/seed.ts` runs only when `ENVIRONMENT` is `dev`
- `worker/src/wiki/seed-content.ts` states that its records are fictional and drawn from the synthetic org

`personas.ts` uses tenant `tenant_mantu_synthetic` and `${roleId}@example.invalid`. `policy/src/org.ts` defaults to seed `20261104`. Headers were read. Every string inside `seed-content.ts` was not re-read line by line in this pass.

No deployed host, account, or binding was contacted.

## Harness results

Node v22.23.4. Commands from the repo root:

```bash
npm install --ignore-scripts --no-audit --no-fund
npm test
npm run typecheck
npm run typecheck:worker
```

| Command | Result |
| --- | --- |
| `npm install --ignore-scripts --no-audit --no-fund` | pass, exit 0 |
| `npm test` | pass, 17 tests, 0 failed |
| `npm run typecheck` (`tsc --noEmit -p tsconfig.json`) | pass, exit 0 |
| `npm run typecheck:worker` (`tsc --noEmit -p tsconfig.worker.json`) | fail, exit 2, 119 errors in 61 files |

Supported typecheck covers `recovered-source/shared/packages/**/*.ts`, `harness/adapters/policy-entry.ts`, `harness/tests/**/*.ts`, and 25 Worker modules whose import closure does not use the global `Env` name or the three missing paths: `admin/store.ts`, `admin/validate.ts`, `agent/stream.ts`, `ai/anthropic.ts`, `ai/config.ts`, `ai/proof.ts`, `ai/segments.ts`, `auth/identity-store.ts`, `auth/limits.ts`, `brains/importers.ts`, `brains/model.ts`, `brains/sanitize.ts`, `brains/unzip.ts`, `internal-auth.ts`, `ops-snapshot.ts`, `personal-kind.ts`, `scim/parse.ts`, `scope.ts`, `security-journal.ts`, `sensitivity.ts`, `switches.ts`, `uxv2/zip.ts`, `wiki/changes.ts`, `wiki/text.ts`, `wiki/types.ts`.

The Worker run's 119 errors are 68 `TS2304` (`Cannot find name 'Env'`) and 43 `TS2307` (missing `types.ts`, `agent-ui/index.ts`, or `view-plan.ts`), plus 8 errors in files that already fail for those reasons: implicit `any`, a tool switch that no longer narrows, Durable Object stub generics, and `TS7016` because `view-plan.validator.js` has no declaration file. Recovered source was not edited to silence them. There is no bundle step. `wrangler deploy` was not run.

Tests cover recovered behavior only. The in-memory replay object in `harness/tests/contracts-security.test.ts` implements the recovered `ReplayStore` interface for that test. The object passed to `planView` in `harness/runtime/genui-plan.test.ts` is a plain map with the fields that function reads. Neither is a live binding.

## Other five Workers

Archive `intake/other-five/secondary-other-five-private-source-candidate.tar.gz`.

| Check | Result |
| --- | --- |
| SHA-256 | `0c9c40f476e5c1a23fa03eb491726bf09d2fbe8af26edef276570bec86c5f655` |
| Size | 90077 bytes |
| Occurrences | 48, all hashes match `intake/other-five/manifest.json` |
| Unique objects | 44 |
| Workers | audit 2, connector 17, mcp 20, ops 7, pages 2 |

Eight shared-package occurrences match the API intake byte for byte (`audit-receipt.ts`, `signed-call.ts`, `log.ts`, `ops-auth.ts`). They are symlinks in `recovered-other/` onto `recovered-source/` and are listed in `recovered-other/DEDUP.json`. The API copies were not rewritten. One further exact match, MCP `worker/src/internal-auth.ts` with the API file of the same hash, is the same kind of symlink. Connector `internal-auth.ts` differs and is stored as its own copy. Two shared files are new and were not in the API intake: `source-record.ts` and `agent-host.ts`.

This intake does not contain the API's `worker/src/types.ts`, `packages/contracts/src/agent-ui/index.ts`, or `packages/contracts/src/view-plan.ts`. Connector `worker/src/types.ts` describes source-registry records, not `AppEnv`. MCP `worker/src/view/plan.ts` still imports the missing `view-plan.ts` as types only. Its generated validator is a different file from the API validator (API `44eb9707…`, MCP `a6065680…`) and names the same eight component types.

Frontend: `secondary-pages-dev` serves published Landing Page Studio HTML from a bucket (`GET /p/:slug`). It is not the Company Brain SPA. MCP has two markup sources: `consent-page.ts` (OAuth consent) and `view/ui.ts` (one inline `ui://secondary/view` document, CSS and script in that file, no separate CSS module). The API still sends non-API GET/HEAD to `env.ASSETS`. That asset bundle is not in either intake.

## Reconstruction build

`reconstruction/` is new. Recovered bytes are symlinked in at the import depth the API already uses (`reconstruction/worker-root/worker/src` and `reconstruction/packages`). `preserveSymlinks` makes those imports resolve to the new modules instead of the absent files under `recovered-source/`. The three new modules re-export or describe only shapes the recovered call sites and the API validator schema already use. `reconstruction/env.d.ts` is the global `Env`, named from recovered `env.*` reads, with no secret values. `reconstruction/wrangler.jsonc` has no account, no routes, and a migration tag that is not original history. `cloudflare:workers` is external in the bundle. A test-only class stub exists so Node can load the graph. It is not workerd.

| Command | Result |
| --- | --- |
| `npm test` | pass, 32 tests, 0 failed |
| `npm run typecheck` | pass, exit 0 |
| `npm run typecheck:reconstructed` | pass, exit 0 |
| `npm run build:worker` | pass, exit 0, `reconstruction/dist/worker.js` (gitignored) |
| `npm run typecheck:worker` | fail, exit 2, 119 errors (recovered tree alone, unchanged) |
| `npm run deploy` | fail, exit 1, upload refused |

The passing typecheck is the reconstructed project, not a claim that the recovered tree typechecks by itself. The 119-error command is still present. No `ts-ignore` and no `any` were added to recovered source. A local bundle is not production, security, Microsoft identity, or live-refresh acceptance.

## Other Worker overlays

Each remaining Worker has its own directory under `reconstruction/` (`audit`, `connector`, `mcp`, `ops`, `pages`). Recovered files are symlinks. New files are `env.d.ts`, `tsconfig.json`, and, for MCP, a declaration for the generated validator. Recovered bytes are unchanged. `npm run typecheck:worker` is still the API-only recovered project and still reports 119 errors.

| Command | Result |
| --- | --- |
| `npm test` | pass, 40 tests, 0 failed |
| `npm run typecheck:workers` | pass, exit 0: api, audit, connector, mcp, ops, pages |
| `npm run build:workers` | audit, connector, ops, pages pass as neutral bundles; MCP passes only as a Node-platform bundle |
| `npm run build:worker` | pass, API bundle |
| `npm run typecheck:worker` | fail, exit 2, 119 errors |
| `npm run deploy` | fail, exit 1, refused |

A neutral esbuild of the MCP entry fails. The published `agents@0.33.0` package imports `node:` modules, `cloudflare:email`, and `@modelcontextprotocol/sdk`, and its client dependency does not export `.` for a neutral bundle. `reconstruction/dist/mcp.js` is therefore a Node bundle with `cloudflare:*` left external. It is not a workerd artifact. Loading the public OAuth provider prints that Client ID Metadata Documents want the compatibility flag `global_fetch_strictly_public`. That flag is not in any recovered config, so it was not added.

Public packages added for these entrypoints, not a recovered lockfile:

| Package | Version | License |
| --- | --- | --- |
| `agents` | 0.33.0 | MIT |
| `@modelcontextprotocol/server` | 2.4.0 | Apache-2.0 |
| `@modelcontextprotocol/sdk` | 1.32.2 | MIT |
| `@modelcontextprotocol/ext-apps` | 2.0.4 | MIT |
| `@cloudflare/workers-oauth-provider` | 1.2.4 | MIT |
| `ajv` | 8.20.0 | MIT |

`ajv` is required by the recovered MCP validator, which calls `require("ajv/dist/runtime/...")` inside an ESM file. The file on disk is unchanged. Node tests do not inject `require`. Loading that file in Node or in workerd throws `require is not defined`.

## Local workerd

`npm run test:workerd` runs Miniflare 5 against local bundles. It does not log in, upload, or call a private API. `compatibility_date` `2026-11-07` is the reconstruction date. On that date the runtime enables Node.js compatibility by default, so the flag is not repeated and is not claimed as original config. Bindings in that test are synthetic harness values.

| Check | Runtime | Result |
| --- | --- | --- |
| `npm test` | Node | pass, 44 tests |
| `npm run test:workerd` | workerd via Miniflare | pass, 11 tests |
| `npm run typecheck:workers` | TypeScript | pass, six overlays, 0 errors |
| `npm run typecheck:worker` | TypeScript on recovered API tree | fail, exit 2, 119 errors |
| `npm run build:workers` | esbuild | audit, connector, ops, pages neutral; MCP is a Node-platform bundle and is not workerd proof |
| `npm run build:workerd` | Wrangler `deploy --dry-run` | MCP entry and the view-plan gate bundle for workerd. Nothing is uploaded |
| `npm run deploy` | refused | exit 1 |

Workerd results that are not Node results: recovered `TenantPolicy.epoch` and `Workspace.listByKind` run on local SQLite and return no rows; a connector source in one tenant is absent from another; a refresh whose Graph client throws stays `lastError: graph_auth_failed` with `lastSyncAt: null` and `ready: false`; `/v1/ready` reports only `do` and `r2`, and a missing R2 binding is HTTP 500 `internal_error` rather than ready; a direct audit request is 403 because the local fetch carries `CF-Connecting-IP`, while a service-binding hop without that header still enforces the key; a rejected view plan does not echo the rejected row text. The recovered MCP validator module, loaded as ESM and not bundled, throws `require is not defined`. Wrangler's bundler rewrites those top-level calls, and the bundled view-plan gate then rejects inline data. `SourceSyncWorkflow` is registered on the refresh harness; the test accepts either a created instance id or an explicit gap and does not claim a completed sync. Loading the OAuth provider prints that Client ID Metadata Documents want `global_fetch_strictly_public`. That flag is not in recovered config and was not added.

## Delivered static shell

Three DOM-text archives are preserved under `recovered-delivery/`. They are minified delivery text, not wire bytes and not original TypeScript. Nothing in them is imported or executed. No HTML document was in the archives, so no shell page was invented and the files are not served as an app.

| Archive | Bytes | SHA256 |
| --- | --- | --- |
| `shell-six/` | 61301 | `64622e1c8e5504636f7dace883edfa39b60e186ae282895718e9eef0ecd8ef79` |
| `lazy-six/` | 39254 | `803132fda13db3a662c441c4722ac797a2084cae1aa28c9958479f8a8bbd8296` |
| `final-code/` | 7372 | `9afe572e0bc07b483196d42e8f7df4cdd7f3c8ca2aa535ba619b3a086916dae3` |

`final-code/dependency-closure-14.json` says the quoted JS/CSS reference set of 14 assets is closed and that `index-DZRyvnzT.js` adds no further local import. That file is present (5704 code points, SHA256 `0c99a1cb3e8d42334cd5deb1641abd3212a56b21d0bab828e44eec67d498bb01`) and its uppercase strings are CI provider names, not secret values. `index-PLmoiPYI.js` is now stored from a later DOM capture as `recovered-delivery/main-js/index-PLmoiPYI.dom-captured.js` (578596 code points, 581692 UTF-8 bytes, SHA256 `0acf56bc36d5dbfed072cc12ceb38abb9750bab36203f9f38bf5243315df33bd`). The archive is 177509 bytes, SHA256 `c57b5e2b505f60936fbe583eda5de2244e7442a9c3c0641ecfde40d82c7dd69d`. It is minified delivery text, not wire bytes and not original TypeScript. No `sourceMappingURL` comment is in it. Forty font files and `/brand/logo_main.png` plus `/brand/logo_main_white.png` are named and not stored. Scoped privacy notes report no unresolved flags. That is not a universal clearance.

The main file's dynamic imports are the six chunks `AgentPage`, `AgentPanel`, `BrainViews`, `PinnedGrid`, `SettingsSection`, and `SharedView`. It also names `Renderer`, `Thread`, `ViewCard`, `agent-DA0iqiiF.js`, and `agent-Wsu4vetM.css` as asset strings. Those files were already quarantined from earlier captures on this branch; this archive does not contain them and they were not fetched again. `index-DiBYRwP4.css` and `index-DZRyvnzT.js` are not imported by the main file. The main file does not call `/v1/genui/plan`. It does call `/v1/me` with `credentials: "same-origin"` and sends `X-Demo-Persona` from `localStorage` key `secondary.persona`, defaulting to `ceo`. Recovered `auth.ts` reads that header only when `ENVIRONMENT !== "dev"` is false. The recovered worker does expose `/v1/genui/plan`, `/v1/brain/tree` (`personal` or `company`), and `/v1/me`. The delivered renderer catalog and that plan schema still share only `Callout` and `Table`. The recovered shell is `recovered-delivery/html-shell/index.html` (820 code points, SHA256 `96f1c636da2147743212cbef111a779146664e581ec4d03ba5a038e9f16124ea`). It is Chrome source-view text joined with LF, not wire bytes and not original line endings. It mounts an empty `#root`, loads `/assets/index-PLmoiPYI.js`, and links `/assets/index-DiBYRwP4.css`. `reconstruction/fixture/serve.mjs` is a new local server that reads those preserved bytes. It is not the original host. Fonts and both logos answer `missing non-code asset` and are not fetched. `/v1/me` is a synthetic fixture. Other `/v1` paths answer `synthetic_gap`.

The delivered renderer names a different component set from the recovered view-plan schema. The only shared names are `Callout` and `Table`. `KpiTile` is in the renderer and not in the schema. `KpiRow` is in the schema and not in the renderer. The view-plan gate remains the recovered rejection of inline data. It is not a claim that the delivered renderer matches that schema, and it is not a visual match.

## Still absent

Original API `types.ts`, `agent-ui/index.ts`, `view-plan.ts`, original worker `wrangler.jsonc`, and original compatibility date. Fonts, both logos, and any HTML shell. `env.ASSETS` is still unresolved. Original TypeScript for the shell is not in these archives. The HTML shell and the main bundle are preserved DOM or source-view text, not wire bytes. Live Graph, Entra, Access, and production objects are not connected. `compatibility_date` `2026-11-07` is the reconstruction date, not a recovered deploy date. Local workerd sets Miniflare `dev.outboundService` to a deny worker; a probe fetch to `https://example.invalid` must return `egress_denied`. That is the network guard. Synthetic bindings alone are not that guard. The recovered MCP entry still returns `MCP_PUBLIC_URL is not configured` before `OAuthProvider` runs, so a bearer token does not reach a tool. Wrangler dry-run of the MCP bundle is not a workerd tool success. The unbundled MCP validator still throws `require is not defined`. A passing local test is not production, security, Microsoft identity, or visual acceptance. No pull request URL is recorded.
