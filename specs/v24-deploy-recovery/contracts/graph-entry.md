# Contract: graph wrapper

The wrapper's main module is `deploy/graph-entry.ts`. It imports the default export of `src/worker/index.ts` and re-exports that module with `export *`.

## Files

| Public path | Repo path | Content type | sha256 |
|---|---|---|---|
| `/graph` | `deploy/graph/page.html` | `text/html; charset=utf-8` | `7e23249adc0ae23141e904dd03ff75be1fe59beb6229f413373e536dcf8568e4` |
| `/graph/app.js` | `deploy/graph/app.js.txt` | `text/javascript; charset=utf-8` | `5fe9f617170916ba4749d46b4340fc8ac6e3de570edb2fb57581dd7b58fbb07f` |
| `/graph/app.css` | `deploy/graph/app.css` | `text/css; charset=utf-8` | `be7948006e02b46d5c73bc28be5c67985b0572d04dfbe6121d1c419953cc6e80` |
| `/graph/nav.js` | `deploy/graph/nav.js.txt` | `text/javascript; charset=utf-8` | `ae5dc4a2b01105c7f0cad18246d140423b6eb366defc133127c4f82a0aacfb4a` |
| `/graph/nav.css` | `deploy/graph/nav.css` | `text/css; charset=utf-8` | `581e4d30582f5b1415b694a165e155b1b9b1ec54e5050484be3a51dac3c404af` |
| `/dashboard` | `deploy/graph/dashboard.html` | `text/html; charset=utf-8` | `32a9b9b9860026fa1581ede4b238c857f8ff0d1d954dc87c75a218e0a07ef345` |
| `/graph/dashboard.js` | `deploy/graph/dashboard.js.txt` | `text/javascript; charset=utf-8` | `9ed3f9fec3215d1eb0bde5961f31886e1937d9a36224a8969ef9338dd2f56f53` |
| `/graph/dashboard.css` | `deploy/graph/dashboard.css` | `text/css; charset=utf-8` | `db2058e727fe4155ab4711c8ab740284e3fbe52db7dd445c4e72626495afa1bb` |

`GET /graph/` uses the `/graph` row. `HEAD` of a row returns status 200 and an empty body.

## Response headers for a served file

`Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, `Permissions-Policy`, `Cache-Control`. `Cache-Control` on a served file is `no-store`. `Content-Type` is the table value.

## Rewrite

The nav snippet is `<link rel="stylesheet" href="/graph/nav.css"><script src="/graph/nav.js" defer></script>`.

API prefixes are `/v1/`, `/auth/`, `/scim/`, `/internal/`, and `/graph/`.

A `GET` outside those prefixes, whose `Accept` contains `text/html`, is forwarded without `If-None-Match` and without `If-Modified-Since`. If the inner status is 200 and the content type contains `text/html`, the nav snippet is appended inside `head`, `ETag` and `Last-Modified` are removed, and `Cache-Control` becomes `no-cache`. Every other response is returned as the inner app sent it.
