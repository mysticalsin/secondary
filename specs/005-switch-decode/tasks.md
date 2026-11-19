# Tasks 005

- [x] T001 Red test: encoded `/v1/%73ources/s1` with the connector switch off expects 503 `{ error: "switched_off", switch: "connector" }` on the production mount. Hono is `4.13.17`.
- [x] T002 `switchGate` matches `c.req.path`. A malformed percent-encoding is 400 and does not continue. Other undecoded prefix checks stay as they are and are listed in the decision log.
- [x] T003 Pin one Hono decode: `%2573` is not sources, a literal `%25` on `/v1/sources/:id` matches main, `%2F` is not a slash, uppercase `%6F`, an encoded `/v1` prefix, and an encoded trailing slash. `securityHeaders` uses `c.req.path`. The MCP allowlist and the import limit stay on the raw pathname.
