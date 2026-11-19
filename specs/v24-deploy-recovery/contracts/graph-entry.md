# Contract: graph wrapper

The wrapper's main module is `deploy/graph-entry.ts`. It imports the default export of `src/worker/index.ts` and re-exports that module with `export *`.

## Files

| Public path | Repo path | Content type | sha256 |
|---|---|---|---|
| `/graph` | `deploy/graph/page.html` | `text/html; charset=utf-8` | `1df28560b7621c18ccc7cdec72b886ea04f13e8c304fac0acae5baaab8cf6f76` |
| `/graph/app.js` | `deploy/graph/app.js.txt` | `text/javascript; charset=utf-8` | `18a3a0661fec9e7b4b34c39250f1d91cf001cc71ca949944fe7b9d3b8169e85a` |
| `/graph/app.css` | `deploy/graph/app.css` | `text/css; charset=utf-8` | `91333cfe793b50146a0b760ecff85eaac1f80b75d9745ab7a302285b67e4f76d` |
| `/graph/nav.js` | `deploy/graph/nav.js.txt` | `text/javascript; charset=utf-8` | `ae5dc4a2b01105c7f0cad18246d140423b6eb366defc133127c4f82a0aacfb4a` |
| `/graph/nav.css` | `deploy/graph/nav.css` | `text/css; charset=utf-8` | `581e4d30582f5b1415b694a165e155b1b9b1ec54e5050484be3a51dac3c404af` |
| `/dashboard` | `deploy/graph/dashboard.html` | `text/html; charset=utf-8` | `32a9b9b9860026fa1581ede4b238c857f8ff0d1d954dc87c75a218e0a07ef345` |
| `/graph/dashboard.js` | `deploy/graph/dashboard.js.txt` | `text/javascript; charset=utf-8` | `b3de688addcfc266db35f99d10a9893fe26740a8858c22e1939dd3b6c51230b6` |
| `/graph/dashboard.css` | `deploy/graph/dashboard.css` | `text/css; charset=utf-8` | `f2ed6925ef5e781b2e4930d1ab5a00f9e5560170d3c37b273b40cafa3d098db8` |

`GET /graph/` uses the `/graph` row. `HEAD` of a row returns status 200 and an empty body.

## Response headers for a served file

`Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, `Permissions-Policy`, `Cache-Control`. `Cache-Control` on a served file is `no-store`. `Content-Type` is the table value.

## Rewrite

The nav snippet is `<link rel="stylesheet" href="/graph/nav.css"><script src="/graph/nav.js" defer></script>`.

API prefixes are `/v1/`, `/auth/`, `/scim/`, `/internal/`, and `/graph/`.

A `GET` outside those prefixes, whose `Accept` contains `text/html`, is forwarded without `If-None-Match` and without `If-Modified-Since`. If the inner status is 200 and the content type contains `text/html`, the nav snippet is appended inside `head`, `ETag` and `Last-Modified` are removed, and `Cache-Control` becomes `no-cache`. Every other response is returned as the inner app sent it.
