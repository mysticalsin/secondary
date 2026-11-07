# Protected-dev edge inventory

This file records a reconstruction checklist and a read-only metadata snapshot from 2026-11-07. It is not approval to deploy, not proof that these bindings are healthy, and not a source of truth for connecting a new preview. Do not copy the live ids below into a new Wrangler file or write to those namespaces.

The reconstruction edge name is `secondary-release-edge-reconstruction-local-only`. Its private API and MCP names in `wrangler.jsonc` are reconstruction placeholders, not `secondary-api-dev` or `secondary-mcp-dev`. `npm run deploy` does not upload it. `RESTORE_ENABLED` is not set on this edge.

## Observed live facts, not targets

Issuer `https://tony-walteur.cloudflareaccess.com`. The public cert document at `https://tony-walteur.cloudflareaccess.com/cdn-cgi/access/certs` was fetched with no credentials on 2026-11-07 15:33:55 America/Sao_Paulo: HTTP 200, 5116 bytes, SHA-256 `b5536252ff8227a04307334611fabaee5f2df05dec40b52f2498bed687760c66`. It contains two distinct RSA-2048 RS256 signature keys and no private parameters. Cache policy is public, `max-age=14400`, `must-revalidate`, `no-transform`. The raw body is kept at `reconstruction/release/observed-public-jwks.json` as that observation, not as the keys this edge will trust. `AUTH_ISSUER` and `AUTH_AUDIENCE` in this Wrangler file stay empty. A local unknown-kid or stale-cache check is not a Cloudflare rotation and not an Access login.

API audience `0efbc36f4d84025cc095efdc94f9891dbf90a7d718f5c4e0c2837a7aae0a8974` is a worker-targeted Access application. It is not the MCP audience `feb4350db153fcca208d1e398e2f5660ab2abf50f3e1d366464addcda517dd89`, which was observed only on `secondary-mcp-dev` `/authorize`. Machine `/mcp` uses the server's own OAuth resource, not that browser Access audience. No Entra provider was in the returned IdP list. The allow policy that was returned is Cloudflare account members, not every Mantu user. Managed OAuth was not configured. Do not stack it onto the server's own OAuth.

The six live workers were observed at compatibility date `2026-10-01` with `nodejs_compat`. The live MCP worker also has `global_fetch_strictly_public`. Reconstruction configs stay on `2026-11-07` and do not enable that fetch flag. Live `ENVIRONMENT` is `dev`. Live `DO_JURISDICTION` is `eu`. API and ops were observed with `RESTORE_ENABLED=yes`. Settings `migrations` being absent is the write-only schema, not proof that migration history is empty.

Observed dev resource ids, including Durable Object namespaces, KV, R2, and `secondary-sync-dev`, are existing dev resources. They are not staging targets for this edge.

## What this edge serves

`reconstruction/release/entry.ts` is the only client entry for its tests. `GET /` and `GET /settings` return the captured shell bytes plus an Observability link, without editing the stored file. `GET /settings/observability` returns the Mantu Observability page with `release: true`, so fixture and session buttons are absent. `GET /reconstruction/import` is the import form under the same rule. `/mcp`, `/authorize`, `/token`, `/register`, and `/.well-known/*` are forwarded to the MCP binding, not the API binding. `/harness/*` is 404. Missing issuer, audience, or local keys is 503.

Tests of this file are `protected-dev edge ignores dev headers and closes harness routes` and `the release edge is the only client path for pages and MCP`. The local JWT in those tests is not an Access login. The MCP worker behind the edge in that test is still the reconstruction `import-entry.ts` bundle.

## Not established

A live Access handshake, a fetch of the live certs, key rotation against those certs, admission of a real user, OAuth access-token wall-clock expiry, and a protected Cloudflare preview.
