# Data Model: Identity fold

No new table and no migration.

| Field | Rule |
|---|---|
| Principal email | Stored as the caller sent it. Match uses `normalEmail` and `normalizedEmailSql`. |
| SCIM `user_name` | ASCII A–Z fold of the trimmed input. Rejected when `normalEmail` is null. |
| Cohort `members` | JSON list of `normalEmail` results. A null fold is dropped. |
| `seenUnknownSwitch` | A `Set` on the `TenantPolicy` instance. At most 256 keys. Not shared across instances. |
| Deny warning | `{ at: "audit_unavailable", action, decision: "deny" }`. No address, no reason. |
