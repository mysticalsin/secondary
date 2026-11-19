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
| Layout | 99 files under `src/worker`, 18 under `recovered-source/shared/packages` |
| Extensions | 116 `.ts`, 1 generated `.js` |

The manifest says the bytes came from `sourcesContent` in a source map of the deployed `secondary-api-dev` Worker (map SHA-256 `fbbb2928d9aa8ea9cfd043e1b1ea0226323784e9a71ff27a407e1d6571737985`). This repo does not contain that map, so that hash was not recomputed. Original git history and build config were not in the archive. Paths are the archive's safe mapping. Imports were left as recovered.

165 third-party sources were excluded by the intake and are not in this tree. That count was not re-derived here.

## What this tree is

Recovered product strings say Secondary, Company Brain, and My Secondary. The string Métis does not appear. Comments describe separate `workers/ops`, `workers/mcp`, `workers/audit`, and `workers/connector` calls. Their source is not here. `src/index.ts` serves non-API GET and HEAD from `env.ASSETS`; the static UI is not here. A local TOTO-OS dashboard is not part of this recovery.

Durable Object classes in this Worker are `TenantPolicy` (`src/tenant-policy.ts`) and `Workspace` (`src/workspace.ts`, extending `BrainBase` and `WikiBase`). `src/index.ts` re-exports `TenantPolicy` and `Workspace`.

## Layout adapter

The Worker tree now lives at `src/worker`. From `src/worker/*.ts`, `../../packages/...` and from `src/worker/*/*.ts`, `../../../packages/...` both resolve to a `packages/` directory at the repo root. The archive stored those packages at `recovered-source/shared/packages/`. The symlink `packages` -> `recovered-source/shared/packages` makes those import strings resolve. It is not a claim about the original directory names above `src`.

`@secondary/policy` had no recovered `package.json` or barrel. `harness/adapters/policy-entry.ts` re-exports names that the recovered policy files already declare. `tsconfig.json` maps the package name to that adapter.

## Omissions that block a Worker build

These paths are imported and are not in the archive:

- `src/worker/types.ts` (`AppDeps`, `AppEnv`, `Session`, and the re-export of `AppDeps`)
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

## Next step

The 119 `typecheck:worker` errors in the table above are the intake measurement on this file's original run. `specs/worker-typecheck-zero/closeout.md` records the later promotion of `env.d.ts`, `types.ts`, the agent-ui barrel, `view-plan.ts`, and `view-plan.validator.d.ts`, and records 0 `error TS` lines. Do not fetch the deployed Worker to invent further substitutes. There is still no wrangler config in this recovery record, and this file is not a deploy instruction.
