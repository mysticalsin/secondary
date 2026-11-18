# Contract: Verifier residuals

| Input | Result |
|---|---|
| Non-managed sign-in `U+212A@ascii.example` while `k@ascii.example` is stored | principal id is not that ASCII row |
| Non-managed sign-in `U+0130@ascii.example` while `i@ascii.example` is stored | principal id is not that ASCII row |
| `normalEmail` and SQL `lower()` of those two addresses | equal to each other, not equal to `k@` or `i@` |
| Patch user name that `normalEmail` blanks | `invalid`, stored user name and email unchanged |
| `GET /v1/ready` with DO and R2 missing | 503 `{ ready: false, checks: { do: "fail", r2: "fail" } }` |
| First `switchStatus` with two unknown names | two `unknown_name` lines, no stored name in the text, known switches enabled |
| Second `switchStatus` with those names | no new `unknown_name` line |
| Callback 601 seconds after the login row | 400, no session cookie, row absent |
