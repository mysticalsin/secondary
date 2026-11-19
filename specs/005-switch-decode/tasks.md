# Tasks 005

- [x] T001 Red test: encoded `/v1/%73ources/s1` with the connector switch off expects 503 `{ error: "switched_off", switch: "connector" }` on the production mount. Hono is `4.13.17`.
- [ ] T002 Fix, only after this red test is confirmed. State the behaviour change: an encoded path that Hono routes onto `/sources/:id` is refused when the connector switch is off.
