# Data model: Verifier residuals

No new table or column.

`normalEmail` and `normalizedEmailSql` lowercase only U+0041 through U+005A. U+212A and U+0130 are unchanged on both sides. Stored emails are not rewritten by the fold.

`scimUserPatch` does not update `user_name` or `principals.email` when the folded user name is null.

`login_state.expires_at` stays `created + 600000` milliseconds. A callback at or after that instant deletes the row and stores no session.

`switches` rows are not deleted when the name is unknown. The seen-name set is memory in the isolate.

The ready body is unchanged: `ready` and `checks.do` / `checks.r2`.
