# Research: Open low fixes

## R1. Login row key

**Decision**: Hash and take only the cookie state.

**Rationale**: `docs/state-machines.md` machine 33 says a leaked query state can cancel another person's pending login, and the fix is to take the cookie's row and never the row named only by the query. On `c9417c8`, `auth/routes.ts` loops `[cookieState, state]` and calls `loginStateTake` for each. The disabled-IdP branch already refuses the query as a key. The test `oidc callback: a state mismatch consumes both login rows` locks the defect.

**Alternatives rejected**: Keep consuming both rows. That is the denial of service machine 33 names. Consume the query row only when it equals the cookie. That is the same as taking the cookie once.

## R2. SCIM user name fold

**Decision**: Compare with `normalizedEmailSql("user_name")` and `normalEmail`. Run the create check before `ensurePrincipal`. Exclude the row being patched.

**Rationale**: Machine 34 says the exact compare, including the list filter, moves onto `normalizedEmailSql` under the one-identity rule. A missed match must not become a second principal. `ensurePrincipal` inserts when the principal email does not already fold to the new name, so the uniqueness check has to happen first. Stored bytes are not rewritten by the compare. `src/state/actor.ts` already states that SQL and JavaScript share one fold list.

**Alternatives rejected**: A JavaScript-only fold of the stored column. That is machine 35's rejected next step, and it would diverge from `normalizedEmailSql`. Rewriting every stored `user_name` in place. That is a migration, and FR-011 forbids one.

## R3. Unknown switch log

**Decision**: One `commit(reject("kill_switch", "unreadable", "read", "unknown_name"))` per `switchState` call when any row fails `isSwitchName`.

**Rationale**: Machine 36 says an unknown stored name is skipped silently and, when fixed, is logged once per load. `commit` already logs `illegal_transition` with `reason` and no stored value. `setSwitch` already uses `unknown_name` without echoing the name. Known flags stay on `allOn()` unless a known row sets them.

**Alternatives rejected**: Log the stored name. The set-switch rule is that the line has no name and no value. Log once per process. `switchState` does not cache, so once per call is the load this code has.

## R4. Left out

**Decision**: Do not edit wiki job claim SQL, the budget refund, machine 12 limit iv, machine 35, or the later erasure retention paths.

**Rationale**: Wiki job claim already implements the documented transitions inside `wikiJobsDue`. Pulling that SQL into a reducer is a refactor of the claimer. `logIfRefundFailed` says idempotent repair is later, and a second naked `add` would be a bolt-on on top of the six compare-and-set attempts already inside `add`. Machine 12 limit iv names review rows and no failing case. Machine 35 forbids a JavaScript-only fold. The later erasure rows are retention or connector clocks, not a missed rights write.
