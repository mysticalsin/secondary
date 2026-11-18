# Feature Specification: v24 deploy recovery

**Feature Branch**: `cursor/recover-v24-deploy-1c66`

**Created**: 2026-11-18

**Status**: Draft

**Input**: User description: "Recover the Cloudflare deploy setup for secondary-api-dev so it matches live v24 bindings, Durable Object classes, migration tag v3, compatibility settings, asset routing, and the /graph wrapper. QA prep only. Do not deploy."

## Clarifications

Answers below are facts checked against the v24 reference, Wrangler 4.158.0's config schema, and commit `c9417c885fc3f12fdcf5201fa15f0e807d50f05d`. They are not guesses.

### Session 2026-11-18

- Q: Which branch receives this work? → A: `cursor/recover-v24-deploy-1c66`, created from `c9417c885fc3f12fdcf5201fa15f0e807d50f05d`. The constitution sentence "This lane's branch is `cursor/state-machines-c94c`" names the worker-typecheck lane. This feature is not that lane, does not commit to that branch, and does not amend the constitution. Principle VII is met by staying on this branch: fast-forward push only, no force, no hook bypass, not `main`, no merge.
- Q: Where do plain-text setting values go? → A: Nowhere in git. `wrangler.jsonc` has no `vars` object. `keep_vars` is true, which is the Wrangler 4.158.0 switch that keeps dashboard plain-text values on deploy instead of deleting them. The eleven plain-text names are a comment in `wrangler.jsonc`. The three values the reference omitted stay omitted.
- Q: How is a service binding's API environment `production` written? → A: Wrangler 4.158.0's service binding has `binding` and `service` only. `additionalProperties` is false, so an `environment` field is rejected. The schema says a named environment is encoded as `<worker_name>-<environment_name>`. The live API value `production` is the default script, so the service names stay `secondary-audit-dev` and `secondary-connector-dev` with no suffix.
- Q: What Durable Object migration history is recoverable? → A: The reference exposes the current tag `v3` and the two SQLite classes. It does not expose earlier steps. The config has one migration, tag `v3`, `new_sqlite_classes` `TenantPolicy` and `Workspace`. It has no `deleted_classes`, `renamed_classes`, `transferred_classes`, or `new_classes`, and no second tag.
- Q: Can the SPA asset bytes be rebuilt? → A: No. The v24 source map has 282 sources and no frontend HTML. This commit has no UI project. `deploy/assets/UNREPRODUCED` is the only file in that directory. `deploy.sh` exits non-zero for a real deploy while that file exists. The eight `/graph` files are inside `graph-entry.js` and are recovered.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Binding parity by name (Priority: P1)

A reviewer can read one Wrangler config and check it against v24's 26 bindings without seeing a secret or a plain-text value.

**Why this priority**: A later deploy of this Worker is unsafe until the binding names, classes, asset routing, and compatibility settings match v24.

**Independent Test**: Parse `wrangler.jsonc` and compare the binding names and types with the contract table. The parse contains no `vars` object and no secret value.

**Acceptance Scenarios**:

1. **Given** `wrangler.jsonc`, **When** it is parsed, **Then** the Worker name is `secondary-api-dev`, `main` is `deploy/graph-entry.ts`, `compatibility_date` is `2026-10-01`, and `compatibility_flags` is exactly `nodejs_compat`.
2. **Given** the parsed config, **When** binding names are collected, **Then** the set is exactly the 26 names in `contracts/bindings.md`, with the types in that table, and with no KV, D1, queue, or cron binding.
3. **Given** the parsed config, **When** secrets and plain-text settings are read, **Then** the nine secret names are `secrets.required` and the eleven plain-text names are the config comment. No `vars` object is present. `keep_vars` is true.
4. **Given** the parsed config, **When** migrations are read, **Then** the only entry is tag `v3` with `new_sqlite_classes` `TenantPolicy` and `Workspace`, and the destructive migration keys are absent.

---

### User Story 2 - /graph survives the entry module (Priority: P1)

A request to `/graph` is served by the wrapper, and the Worker still exports `TenantPolicy` and `Workspace`.

**Why this priority**: v24's main module is the wrapper. A deploy whose main module is only `index.ts` removes `/graph`.

**Independent Test**: Call the wrapper function with the eight recovered files and a fake inner app. Read `deploy/graph-entry.ts` for the re-export.

**Acceptance Scenarios**:

1. **Given** the eight recovered files, **When** `GET /graph` or `GET /graph/` runs, **Then** the response is status 200, the `/graph` HTML bytes, and the v24 content type and header names.
2. **Given** `HEAD /graph`, **When** the wrapper runs, **Then** the status is 200 and the body is empty.
3. **Given** `GET /graph/app.js`, `GET /graph/app.css`, `GET /graph/nav.js`, `GET /graph/nav.css`, `GET /dashboard`, `GET /graph/dashboard.js`, or `GET /graph/dashboard.css`, **When** the wrapper runs, **Then** each body matches that file's sha256 in `contracts/graph-entry.md`.
4. **Given** `POST /graph`, or a path that is not one of the eight, **When** the wrapper runs, **Then** the inner app receives the request.
5. **Given** a `GET` of HTML outside the API prefixes, **When** the inner app returns 200 HTML, **Then** the Graph view link is appended in `head`, `ETag` and `Last-Modified` are removed, and `Cache-Control` is `no-cache`.
6. **Given** a `GET` whose path starts with `/v1/`, `/auth/`, `/scim/`, `/internal/`, or `/graph/`, **When** the inner app returns HTML, **Then** the body is not rewritten.
7. **Given** `deploy/graph-entry.ts`, **When** it is read, **Then** it imports the default export of `recovered-source/worker/src/index.ts`, re-exports that module, and does not declare a second `TenantPolicy` or `Workspace` class.

---

### User Story 3 - A real deploy cannot wipe live state (Priority: P2)

The deploy script can package a dry run, and it refuses a real deploy while the SPA bytes are unreproduced.

**Why this priority**: Uploading `deploy/assets` as it stands would replace the live SPA. Omitting `keep_vars` would delete the eleven plain-text settings. Secrets stay on the Worker only when the deploy does not delete them.

**Independent Test**: Run `deploy.sh` with no arguments and with a temporary root that contains `.dev.vars`. Both exit non-zero. `wrangler deploy --dry-run` is a separate command, not a live upload.

**Acceptance Scenarios**:

1. **Given** `deploy/assets/UNREPRODUCED` exists, **When** `deploy.sh` runs without `--dry-run`, **Then** the process exits non-zero and does not invoke an upload.
2. **Given** a `.dev.vars` file in the root passed to the guard, **When** the guard runs, **Then** it fails for both dry-run and real deploy.
3. **Given** a config with a `vars` object, a second migration tag, or `deleted_classes`, **When** the guard runs, **Then** it fails.
4. **Given** `--dry-run`, **When** `deploy.sh` reaches Wrangler, **Then** the command is `wrangler deploy --dry-run` with no `--secrets-file` and no login step in this feature.

---

### User Story 4 - pending_* needs no new migration (Priority: P2)

A reviewer can see that `pending_role` and `pending_at` do not require a new Durable Object migration or a storage rewrite.

**Why this priority**: A new migration tag, or a delete-class migration, can destroy stored Durable Object data. The question has to be answered before any later deploy.

**Independent Test**: Compare v24 `src/brains/store.ts` from the source map with `recovered-source/worker/src/brains/store.ts`. Confirm this feature adds no migration file and does not change that constructor.

**Acceptance Scenarios**:

1. **Given** the v24 source map sha256 `fbbb2928d9aa8ea9cfd043e1b1ea0226323784e9a71ff27a407e1d6571737985`, **When** `src/brains/store.ts` is read, **Then** `pending_role` and `pending_at` occur zero times.
2. **Given** main's `ensureMemberClaimColumns`, **When** an existing `brain_members` table lacks those columns, **Then** the existing test adds the two nullable columns and leaves the stored row in place. This feature does not edit that test or that constructor.
3. **Given** this feature's diff, **When** migrations are listed, **Then** there is no tag other than `v3` and no SQL file that rewrites or drops stored rows.

### Edge Cases

- `GET /graph/` is served as `/graph`.
- `HEAD` of a recovered file returns 200 and an empty body.
- `POST /graph` is delegated to the inner app.
- A page `GET` that carries `If-None-Match` or `If-Modified-Since` is forwarded without those two headers.
- An inner response that is not status 200, or whose content type is not HTML, is returned unchanged.
- A path under `/graph/` that is not one of the eight files is delegated, and an HTML response on that path is not rewritten, because `/graph/` is an API prefix in the v24 wrapper.
- `deploy.sh` rejects any argument other than `--dry-run`.
- The guard fails when `wrangler.jsonc` is missing or is not the single-migration shape above.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `wrangler.jsonc` sets `name` to `secondary-api-dev`, `main` to `deploy/graph-entry.ts`, `compatibility_date` to `2026-10-01`, and `compatibility_flags` to exactly `["nodejs_compat"]`.
- **FR-002**: The config's binding set is exactly the 26 names and types in `contracts/bindings.md`. It adds no KV namespace, D1 database, queue, or cron trigger.
- **FR-003**: The nine secret names are `secrets.required` and nowhere else. The config, specs, tests, and logs contain no secret values. No `.dev.vars` file is created.
- **FR-004**: The eleven plain-text names are a comment in `wrangler.jsonc` and are not given values. The config has no `vars` key. `keep_vars` is true.
- **FR-005**: `AUDIT` binds to service `secondary-audit-dev`. `CONNECTOR` binds to service `secondary-connector-dev`. `BLOBS` binds to bucket `secondary-blobs-dev` with jurisdiction `eu`. `TENANT_POLICY` and `WORKSPACE` bind to classes `TenantPolicy` and `Workspace`.
- **FR-006**: The `ASSETS` binding uses directory `deploy/assets`, `not_found_handling` `single-page-application`, `run_worker_first` true, and `base_path` `/`.
- **FR-007**: `migrations` is exactly one object: tag `v3` and `new_sqlite_classes` `["TenantPolicy", "Workspace"]`. The keys `deleted_classes`, `renamed_classes`, `transferred_classes`, and `new_classes` are absent.
- **FR-008**: `deploy.sh` is the deploy entry. With `--dry-run` it runs local Wrangler `deploy --dry-run` and no `--secrets-file`. Without `--dry-run`, while `deploy/assets/UNREPRODUCED` exists, it exits non-zero before an upload. It rejects a present `.dev.vars`, a `vars` object, and any migration shape other than FR-007.
- **FR-009**: The graph wrapper serves the eight files and applies the rewrite rules in User Story 2. `deploy/graph-entry.ts` re-exports `recovered-source/worker/src/index.ts` and does not define a second Durable Object class.
- **FR-010**: The pending-column verdict is no new Durable Object migration and no storage rewrite. This feature does not change `recovered-source/worker/src/brains/store.ts` and does not add a tag other than `v3`.
- **FR-011**: SPA bytes are not invented. `deploy/assets/UNREPRODUCED` remains the only file in that directory. The unreproduced list in the Assumptions stays in this spec.
- **FR-012**: On the implementation head, `npm test`, `npm run typecheck`, `npm run typecheck:worker`, and `npm run verify:provenance` exit 0. The parent `npm test` count is 416 passed and 0 failed. Worker typecheck stays at 0 errors. New tests are added. Existing tests are not rewritten.
- **FR-013**: This feature does not deploy, merge, force-push, push `main`, call the Cloudflare API, create a paid resource, open a tunnel, or read an API token.
- **FR-014**: `workers_dev` is true, `preview_urls` is false, `logpush` is false, and the config has no `routes`, no `account_id`, and no `observability` object.

### Key Entities

- **Binding**: A name plus a type from the v24 set: plain-text setting, secret, service, R2 bucket, Durable Object namespace, or assets.
- **Graph file**: One of the eight paths, its content type, and its sha256.
- **Migration entry**: The single tag `v3` and the two SQLite class names.
- **Member columns**: `pending_role` and `pending_at` on `brain_members`. They are nullable columns added by the existing constructor when missing.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The binding test passes and reports 26 names, 11 plain-text names, 9 secret names, and zero secret or plain-text values in the config.
- **SC-002**: The graph tests pass for the eight paths, the rewrite rules, and the re-export source check.
- **SC-003**: `deploy.sh` without `--dry-run` exits non-zero while `deploy/assets/UNREPRODUCED` exists.
- **SC-004**: `wrangler deploy --dry-run` is run from `deploy.sh --dry-run`. The result is recorded with the exit code. No login is attempted.
- **SC-005**: The pending-column verdict in this spec is no, and the diff contains no new migration tag and no edit to `brains/store.ts`.
- **SC-006**: `npm test`, both typechecks, and `npm run verify:provenance` exit 0 on the implementation head.

## Assumptions

- Wrangler 4.158.0 is the config language. It is the newest published Wrangler whose optional peer accepts the pinned `@cloudflare/workers-types` `5.20261107.1`. Those types stay pinned.
- The reconstruction-branch Wrangler files are hints only. They are not copied. Their Worker names, compatibility dates, and migration tags differ from v24, and their comments say they are not a recovered config.
- The ordered migration steps that produced tag `v3` are not in the reference. A later real deploy must stop if Wrangler reports that this single step does not match the applied history. This feature does not add a flag that resets migrations.
- `keep_vars: true` leaves the eleven live plain-text values on the Worker. Wrangler does not delete secrets on deploy unless `wrangler secret delete` is run. This feature does not run that command.
- v24 `runtime.observability` is null. The config leaves observability unset so a later deploy does not turn it on.
- Unreproducible from this repo and the v24 source map: the SPA asset file list and bytes, the earlier migration steps inside tag `v3`, and the three omitted plain-text values. The `/graph` files are reproducible from `graph-entry.js`.
- Parent gates at `c9417c885fc3f12fdcf5201fa15f0e807d50f05d`: `npm test` 416 passed and 0 failed, `npm run typecheck` exit 0, `npm run typecheck:worker` exit 0, `npm run verify:provenance` exit 0.

## Pending-column verdict

No. v24 does not need a new Durable Object migration, and it does not need a storage rewrite, for `pending_role` and `pending_at`.

Evidence:

- The reference migration tag is `v3`. Both classes are already SQLite on this Worker. Cloudflare's Durable Object migration document says updating how an existing class uses storage does not require a migration, including changes to persistent storage, and that a delete migration deletes stored data. This feature adds no tag and no delete.
- v24 `src/brains/store.ts` in source map `fbbb2928d9aa8ea9cfd043e1b1ea0226323784e9a71ff27a407e1d6571737985` contains `pending_role` zero times and `pending_at` zero times, and it contains no `ALTER TABLE brain_members`.
- Main's `ensureMemberClaimColumns` in `recovered-source/worker/src/brains/store.ts` adds `pending_role TEXT` and `pending_at INTEGER` only when `PRAGMA table_info` does not already list them. The existing test `brain schema: an old member table gains the pending columns once` stores a row, opens the constructor, and requires the row's previous values to remain. A second open does not change the table. That is the storage change. It is already in main. This feature does not add another one.
