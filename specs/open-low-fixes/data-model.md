# Data model: Open low fixes

No new table, column, or index.

## Login row

`login_state` stays as created in `auth/identity-store.ts`. The callback deletes at most the row whose `state_hash` is the hash of the cookie state. A row stored under any other hash is not deleted by that callback.

## SCIM user name

`scim_users.user_name` stays `TEXT NOT NULL UNIQUE`. Uniqueness in the application is the folded value, checked with `normalizedEmailSql("user_name")` before insert and before a rename. The database unique index remains the stored bytes. This batch does not rewrite existing bytes to satisfy that index. A case-only rename of the same row still stores the trimmed lowercase value that patch already stored.

`principals` gains a row from `scimUserCreate` only when the folded user name is not already a `scim_users.user_name` and `ensurePrincipal` does not find an email. A refused create adds no principal. A `not_provisioned` sign-in adds no principal. A matched managed sign-in may set `subject` on the existing principal and does not change `email`.

## Switch row

`switches` stays `(name, enabled, changed_by, changed_at)`. An unknown `name` is read and skipped. It is not deleted and not updated. The four known names keep the values `switchState` already computed.

## Log line

The new switch line is the object `commit` already writes: `at`, `machine`, `from`, `event`, `reason`. For this case those values are `illegal_transition`, `kill_switch`, `unreadable`, `read`, `unknown_name`. No other field is added.
