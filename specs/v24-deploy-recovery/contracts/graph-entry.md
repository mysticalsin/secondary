# Contract: graph wrapper

The wrapper's main module is `deploy/graph-entry.ts`. It imports the default export of `src/worker/index.ts` and re-exports that module with `export *`.

## Files

| Public path | Repo path | Content type | sha256 |
|---|---|---|---|
| `/graph` | `deploy/graph/page.html` | `text/html; charset=utf-8` | `49151dd7148c0975bbfb9e9b4753eb4bbd1379f996ba1a7c4a4b9a2bd68ace9a` |
| `/graph/app.js` | `deploy/graph/app.js.txt` | `text/javascript; charset=utf-8` | `ae81920a96875f88caeb43d17984b3a43b0021ec22a16f91fc0215ae14d32304` |
| `/graph/fetch-bound.js` | `deploy/graph/fetch-bound.js.txt` | `text/javascript; charset=utf-8` | `0ac465aeb7e507160b7a2a31337de5db9fb30ed12da9c803c0aa4e628c09786c` |
| `/graph/app.css` | `deploy/graph/app.css` | `text/css; charset=utf-8` | `58a84df162b081c856a185f0f147838f2351ee604a359f47e0c0e927d89f20a3` |
| `/graph/nav.js` | `deploy/graph/nav.js.txt` | `text/javascript; charset=utf-8` | `ae5dc4a2b01105c7f0cad18246d140423b6eb366defc133127c4f82a0aacfb4a` |
| `/graph/nav.css` | `deploy/graph/nav.css` | `text/css; charset=utf-8` | `581e4d30582f5b1415b694a165e155b1b9b1ec54e5050484be3a51dac3c404af` |
| `/dashboard` | `deploy/graph/dashboard.html` | `text/html; charset=utf-8` | `10f3363c52baf020683ccf3cf790b84713a05827b5d37806072e6d4b8e14413f` |
| `/graph/dashboard.js` | `deploy/graph/dashboard.js.txt` | `text/javascript; charset=utf-8` | `6bc7a376638ed86cf380712c25abffc6707bb34c9e721f05f3662ec8cc304227` |
| `/graph/dashboard.css` | `deploy/graph/dashboard.css` | `text/css; charset=utf-8` | `f2ed6925ef5e781b2e4930d1ab5a00f9e5560170d3c37b273b40cafa3d098db8` |

`GET /graph/` uses the `/graph` row. `HEAD` of a row returns status 200 and an empty body.

## Response headers for a served file

`Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, `Permissions-Policy`, `Cache-Control`. `Cache-Control` on a served file is `no-store`. `Content-Type` is the table value.

## Rewrite

The nav snippet is `<link rel="stylesheet" href="/graph/nav.css"><script src="/graph/nav.js" defer></script>`.

API prefixes are `/v1/`, `/auth/`, `/scim/`, `/internal/`, and `/graph/`.

A `GET` outside those prefixes, whose `Accept` contains `text/html`, is forwarded without `If-None-Match` and without `If-Modified-Since`. If the inner status is 200 and the content type contains `text/html`, the nav snippet is appended inside `head`, `ETag` and `Last-Modified` are removed, and `Cache-Control` becomes `no-cache`. Every other response is returned as the inner app sent it.
