# Research: v24 deploy recovery

## Decision: Wrangler 4.158.0

**Decision**: Add `wrangler@4.158.0` as a dev dependency. Leave `@cloudflare/workers-types` at `5.20261107.1`.

**Rationale**: The repo had no Wrangler. `4.164.0` asks for workers-types `^5.20261117.1`. `4.159.0` asks for `^5.20261109.1`. `4.158.0` asks for `^5.20261104.1`, which accepts `5.20261107.1`. Upgrading the types package can change the worker typecheck that is already 0. The 4.158.0 schema has `secrets.required`, `keep_vars`, `alias`, R2 `jurisdiction`, assets `run_worker_first` as a boolean, and service bindings without an `environment` field.

**Alternatives considered**: `4.164.0` with `--legacy-peer-deps`. Rejected because it ignores the peer that this repo can satisfy with 4.158.0. Copying a reconstruction-branch config. Rejected in the spec clarifications.

## Decision: names only, keep_vars true

**Decision**: No `vars` object. `keep_vars` true. Secret names live in `secrets.required`. Plain-text names live in one comment.

**Rationale**: Wrangler 4.158.0's schema text says a deploy deletes dashboard vars that are not in the config unless `keep_vars` is true, and that secrets are not deleted by deploy. The reference omitted three plain-text values. Writing the other eight would still put values in git, which the task forbids. The comment is the names-only list the config can hold, because `vars` values are strings and the schema has no names-only list for plain-text settings.

**Alternatives considered**: Commit the eight non-omitted values. Rejected. The task says setting names only.

## Decision: one migration tag v3

**Decision**: `migrations` is one entry, tag `v3`, `new_sqlite_classes` `TenantPolicy` and `Workspace`. No delete, rename, transfer, or key-value class list. No `exports` block.

**Rationale**: The reference shows tag `v3` and two SQLite namespaces on this script. It does not show earlier steps. The legacy migrations document says a delete migration deletes stored objects, and that a storage-code change on an existing class does not require a migration. The declarative `exports` field is one-way. v24 still reports a tag, so this config stays on the legacy list. A later deploy that reports a history mismatch must stop. This feature does not add a reset flag.

**Alternatives considered**: Invent tags `v1` and `v2`. Rejected. The reference does not contain them. Switch to `exports`. Rejected. That drops the tag and cannot be undone.

## Decision: pending columns need no new migration

**Decision**: Do not add a migration and do not edit `brains/store.ts`.

**Rationale**: Recorded in the spec's pending-column verdict. The source map hash matches `RECOVERY.md`. The v24 copy of `src/brains/store.ts` has zero occurrences of `pending_role` and `pending_at`. Main already adds the nullable columns in the constructor. The existing schema test covers one add and a second pass.

**Alternatives considered**: A tag `v4`. Rejected. Class creation is not what these columns are. A SQL file that rewrites rows. Rejected. The constructor leaves stored values in place, and a rewrite was forbidden.

## Decision: graph wrapper as the main module

**Decision**: `main` is `deploy/graph-entry.ts`. It imports and re-exports `recovered-source/worker/src/index.ts`. The eight files are extracted from v24 `graph-entry.js` and served by `deploy/graph-route.ts`.

**Rationale**: v24's inferred main module serves `/graph` and re-exports `./index.js`. Putting `index.ts` itself as `main` would drop that behavior. The wrapper is outside `recovered-source/` so recovered bytes stay unchanged. JavaScript files are stored as `.js.txt` so the bundler takes them as text under a Text rule.

**Alternatives considered**: Commit the 109300-byte `graph-entry.js` as `main` and hope Wrangler leaves it unbundled. Rejected. It imports `./index.js`, which is the bundled artifact, not this repo's source. Stop because the wrapper could not be recovered. Rejected. The file is 66 lines plus the eight bodies, and the behavior is testable.

## Decision: SPA marker, real deploy refused

**Decision**: `deploy/assets/UNREPRODUCED` is the only asset file. `deploy.sh` exits non-zero without `--dry-run` while it exists.

**Rationale**: The reference says the asset list is not readable, and no earlier UI capture is in this task. The source map has no frontend HTML. A dry run may package the marker. A real deploy of that directory would replace the live SPA. The refusal is the guard.

**Alternatives considered**: Copy frontend files from `cursor/worker-reconstruction-0cf6`. Rejected. Those branches were limited to Wrangler hints, and the task says no earlier UI capture is available. Invent an `index.html`. Rejected. That would be a fake UI.

## Decision: checksum manifest for the later asset drop-in

**Decision**: Keep `deploy/assets/UNREPRODUCED` as the only committed asset file. Extend the real-deploy guard so it also requires `deploy/assets/MANIFEST.sha256` to match the files in that directory, using the line and directory rules in `contracts/asset-manifest.md`. `--dry-run` does not apply the asset check. Tests write synthetic files in a temporary directory. A passing fixture stops at the guard.

**Rationale**: The owner asked for the branch to be ready for a captured UI drop-in, and for a red test of the refusal and the match. The live asset list is still unreadable. Inventing those bytes would replace the live SPA with a fake UI. The marker stays the first refusal so deleting it without a matching manifest cannot upload. The hash is sha256 of raw bytes, which is what a later capture can record without putting secret values in git. A path with `..` is rejected so the check cannot read outside the asset directory.

**Alternatives considered**: Put a guessed `index.html` in `deploy/assets/`. Rejected. The task forbids inventing UI assets. Fetch the live Worker assets. Rejected. This run does not call Cloudflare. Make `--dry-run` refuse while the marker exists. Rejected. The existing dry run is how the bundle was shown to compile, and the new refusal is the real deploy path.

## Decision: stage the bytes Wrangler uploads

**Decision**: `wrangler.jsonc` `assets.directory` is `deploy/.staged`, gitignored, and absent by default. The guard reads that field, refuses it when it is the source tree or escapes the repo, copies the listed `deploy/assets` bytes into it, and hashes the copies. `npm run deploy` is `./deploy.sh`. `deploy.sh` removes the directory after Wrangler returns. A path segment that case-folds to `unreproduced` is refused.

**Rationale**: Direct `wrangler deploy` never called the guard, because the guard and the config were two strings for the same directory. Hashing the source and then letting Wrangler read it again allowed the bytes to change in between. A case-sensitive sentinel name misses the same file on a case-insensitive disk. One upload path, written only by the guard, closes those three.

**Alternatives considered**: Wrap the Wrangler binary so every invocation runs the guard. Rejected. Wrangler can be started by a path the wrapper does not own. Keep `deploy/assets` as the upload directory and only add the npm script. Rejected. `npx wrangler deploy` would still skip the guard.

## Decision: alias the existing policy adapter

**Decision**: `alias["@secondary/policy"]` is `./harness/adapters/policy-entry.ts`.

**Rationale**: Recovered modules import that package name. The repo resolves it with a `tsconfig` path for typecheck. Wrangler uses esbuild and does not read that path unless `alias` is set. The adapter already re-exports the recovered policy files.

**Alternatives considered**: Edit recovered import specifiers. Rejected. That changes recovered source. Add a new package barrel. Rejected. The adapter is already the barrel.

## Decision: observability stays unset

**Decision**: Do not set `observability`.

**Rationale**: v24's runtime observability is null. Setting `observability.enabled` would change the live Worker on a later deploy. Parity wins over the general advice to enable logs on a new Worker. This Worker is not new.

**Alternatives considered**: Enable logs and traces. Rejected for parity.
