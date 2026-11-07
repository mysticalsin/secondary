# Protected-dev edge inventory

This is a reconstruction checklist for a later review. It does not provision accounts, routes, or secrets, and it is not approval to deploy.

The edge worker name is `secondary-release-edge-reconstruction-local-only`. The API name it would call privately is `secondary-api-reconstruction-local-only`. Neither name is a recovered Wrangler service. Do not reuse an existing live binding or copy a local Durable Object database into one.

## Entry

`reconstruction/release/entry.ts` is the browser edge. The local fixture server and `import-entry.ts` remain the dev test entry. Tests of this edge load `entry.ts`. Tests of MCP OAuth load the reconstruction `import-entry.ts` bundle, not the recovered `index.ts`.

## Route map

| Path | Release behavior | Identity |
| --- | --- | --- |
| `/harness/*` | 404 `harness_closed` | none |
| `/settings/observability/session`, `/settings/observability/usage`, `/reconstruction/import/session` | 404 `fixture_closed` | none |
| `/settings/observability`, `/reconstruction/import` | JWT required | `Authorization: Bearer` or `Cf-Access-Jwt-Assertion`, verified locally |
| `/mcp`, `/authorize`, `/token`, `/register`, `/.well-known/*` | forwarded to the private API binding | OAuth on that worker, not this edge's dev headers |
| anything else | 404 | none |

`X-Dev-Email`, `X-Dev-Persona`, `X-Demo-Persona`, and `X-User-Email` are ignored. An empty issuer, audience, or local key set is `503 auth_unconfigured` and does not authenticate.

## Bindings this edge expects later

- `API`: service binding to the reconstruction API worker. Not public.
- `AUTH_ISSUER`, `AUTH_AUDIENCE`: set at review time. Empty in the checked-in file.
- `LOCAL_JWKS`: public JWK set only. No private key fields. No JWK URL.
- `INTERNAL_HMAC_KEY`: secret, not committed. Used only on the private hop.

No static asset binding is declared. The edge HTML is generated. Captured shell bytes stay in `recovered-delivery/` and are not the release document.

## Not done

Live Access or Entra account wiring, remote JWKS fetch, production hostname, and copying local fixture data are not part of this file.
