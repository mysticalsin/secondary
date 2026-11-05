# Runbook: Microsoft Entra ID sign-in and SCIM provisioning

Audience: Tony and Mantu IT. Workstream: B2 ID. Status of the portal steps: every step below is written from memory of the Entra admin center and is marked **(to verify)** where the portal wording or layout may have moved. Check each against the live portal before relying on it.

What this sets up:

- Sign-in: Secondary signs people in directly with Entra ID (OpenID Connect, authorization code with PKCE). The session is a `__Host-` cookie, 8 hours absolute, 30 minutes idle.
- Roles: Entra groups map to Secondary roles through a table. A person with no mapped group has no roles and sees only their Personal Brain.
- Provisioning: Entra pushes users and groups to `https://<host>/scim/v2`. Disabling or deleting a user there ends their sessions on the next request after the SCIM call lands.

Replace `<host>` with the API host (for dev the workers.dev host, later the custom host). Do all of it once per environment (dev, staging, prod) with a separate app registration each.

## 0. Decide first

1. `AUTH_MODE`: `access` (default, Cloudflare Access only), `both` (Access or Entra; recommended while rolling out), `entra` (Entra only; the Access JWT is then refused).
2. Cloudflare Access can stay in front as an outer gate in any mode. Entra sign-in is a second layer, not a replacement for it, unless you set `entra`.
3. Real data stays out until the Mantu Cloudflare account and the DPA exist (see the build plan). Use synthetic data in dev and staging.

## 1. App registration (sign-in)

In the Entra admin center, as an Application Administrator or Cloud Application Administrator **(to verify role names)**:

1. Identity, Applications, App registrations, New registration.
2. Name: `Secondary (dev)` (or staging, prod).
3. Supported account types: **Accounts in this organizational directory only (single tenant)**. Secondary refuses tokens from any other tenant, but single tenant also stops other tenants from even starting a sign-in.
4. Redirect URI: platform **Web**, value `https://<host>/auth/callback`. It must match exactly (scheme, host, no trailing slash). Add one registration per host. For local testing on `wrangler dev`, use a separate dev registration with `http://localhost:8787/auth/callback` **(to verify: Entra allows http for localhost only)**.
5. Register, then on the Overview page copy:
   - Application (client) ID
   - Directory (tenant) ID

### Client secret

1. Certificates and secrets, Client secrets, New client secret. Pick the shortest expiry that fits your rotation runbook (24 months is the maximum offered; 6 to 12 is saner) **(to verify)**.
2. Copy the **Value** immediately. It is shown once.
3. Do not send it to anyone by chat or email. Tony sets it directly: `wrangler secret put ENTRA_CLIENT_SECRET` for the right environment.
4. Put the expiry date in the key-rotation runbook. When it expires, sign-in stops.

### Token configuration (claims)

1. Token configuration, Add optional claim, token type **ID**, tick `email`. Accept the prompt about the Microsoft Graph `email` permission **(to verify)**. Secondary reads `email` and falls back to `preferred_username`.
2. Token configuration, Add groups claim. Choose **Groups assigned to the application** (not "All groups": that one overflows past 200 groups and then the token carries no groups at all). Under ID token, keep the **Group ID** format. Secondary matches group **object IDs**.
3. API permissions: the default `User.Read` (delegated) is enough. The scopes `openid profile email` are standard and need no admin consent **(to verify)**.

### Who may sign in

1. Enterprise applications, open `Secondary (dev)`, Properties, set **Assignment required** to Yes **(to verify)**.
2. Users and groups, assign the groups that should reach Secondary. Only assigned groups appear in the groups claim, so assign exactly the groups that you will map to roles (section 3) plus a general "all staff" group if everyone may sign in with no role.

## 2. Configuration values in Secondary

Vars (not secret) and secrets, per environment:

| Name | Kind | Value |
|---|---|---|
| `AUTH_MODE` | var | `both` or `entra` |
| `ENTRA_TENANT_ID` | var | Directory (tenant) ID, a GUID |
| `ENTRA_CLIENT_ID` | var | Application (client) ID, a GUID |
| `ENTRA_CLIENT_SECRET` | secret | `wrangler secret put ENTRA_CLIENT_SECRET` |
| `SCIM_TOKEN` | secret | `wrangler secret put SCIM_TOKEN` (see section 4) |
| `SCIM_TENANT_ID` | var, optional | Secondary tenant that owns the directory. Defaults to `DEFAULT_TENANT_ID` |

If any of the three Entra values is missing or not a GUID, Entra sign-in is off and `GET /auth/providers` answers `{"entra":false}`, which the UI uses to hide the button. SCIM is off while `SCIM_TOKEN` is unset or shorter than 32 characters (every call answers 401).

## 3. Group to role table

Secondary keeps a table in the tenant directory: Entra **group object ID** to **role id**. Valid role ids: `ceo`, `head_bid`, `acme_lead`, `consultant`, `reviewer`, `platform_admin`, `auditor` (the current list in `packages/policy`).

- The table is applied live: a login stores the groups claim, SCIM stores group membership, and every request resolves roles from both. A change takes effect on the next request.
- A person provisioned through SCIM takes their groups **only** from SCIM (so removing someone from a group in Entra removes the role at the next sync, not at the next sign-in). Someone who was never provisioned takes groups from the token at their last sign-in. If you use SCIM you must therefore provision the role groups too.
- Anyone with no mapped group gets no roles.
- Mapping a group to `platform_admin` or any restricted role is a privileged change. The two-person rule for it belongs to the admin console workstream (GOV).
- There is no admin screen or HTTP route for this table yet. It is edited with the Durable Object methods `groupMapSet(groupId, roleId)`, `groupMapList()` and `groupMapDelete(groupId)` on `TenantPolicy`; the GOV workstream exposes them. Until then, send the mapping to the engineer who applies it.

To find a group's object ID: Groups, All groups, open the group, Overview, **Object ID** **(to verify)**.

## 4. SCIM provisioning

1. Enterprise applications, New application, **Create your own application**, name `Secondary SCIM (dev)`, choose "Integrate any other application you don't find in the gallery (Non-gallery)" **(to verify)**. You may instead reuse the sign-in app from section 1; a separate one keeps provisioning scope and sign-in assignment independent.
2. Provisioning, Get started, **Provisioning Mode: Automatic**.
3. Admin Credentials:
   - Tenant URL: `https://<host>/scim/v2`
   - Secret Token: a new random value, 32 characters or more. Generate it on a trusted machine (`openssl rand -base64 48`), set it with `wrangler secret put SCIM_TOKEN`, and paste the same value here. Do not send it to anyone.
   - Test Connection. It calls `GET /scim/v2/Users?filter=userName eq "..."` and must succeed.
4. Mappings:
   - Users: keep `userName`, `active`, `displayName`, `externalId`, `name.givenName`, `name.familyName`. **`userName` must equal the email people sign in with** (the `email` or `preferred_username` claim). If the UPN is not the mailbox address, change the `userName` source attribute to `mail` **(to verify)**. A mismatch creates a second principal and the role mapping will not apply to the person's real login.
   - Groups: keep `displayName`, `externalId` (source: `objectId`, the default) and `members`. Secondary matches a SCIM group to the role table by `externalId`, which is the group's object ID.
   - Everything else can be disabled. Unknown attributes are ignored, not rejected.
5. Settings: Scope **Sync only assigned users and groups**. Assign the same groups as in section 1. Provisioning Status **On**.
6. Check Provisioning logs for a first successful cycle. The initial cycle can take a while; incremental cycles run roughly every 40 minutes **(to verify)**.

### What deprovisioning does, and its real timing

- When Entra sends `active=false` (a disabled or soft-deleted user) or `DELETE`, Secondary ends every session of that person and refuses their next request, with a revocation epoch bump, in the same call. Tested: the next request after the SCIM call answers 401.
- The same person is also refused through the Cloudflare Access path, and cannot sign in again until reactivated.
- Manually granted roles, memberships, NDA grants and elevations are left in place but dormant while the person is inactive. They come back if the person is reactivated. The offboarding runbook revokes them.
- The "within 60 seconds" in the plan is the time after Entra calls SCIM. Entra itself only calls on its own cycle (about 40 minutes). For an urgent offboarding use **Provision on demand** for that user in the provisioning blade **(to verify)**, or disable the user and delete their sessions another way. Without SCIM an Entra-side disable does not end an existing Secondary session until it expires (at most 8 hours, or 30 minutes of inactivity).

## 5. What to send back (never the secrets)

Send these to the engineer, in the ticket:

1. Directory (tenant) ID.
2. Application (client) ID, per environment.
3. The exact redirect URIs you registered.
4. Table of group display name, group **object ID**, intended Secondary role id. Mark which group means "may sign in with no role".
5. Confirmation that the groups claim is "Groups assigned to the application" and that the `email` optional claim is added.
6. Confirmation that provisioning is On and the first cycle succeeded (the Provisioning logs line, no personal data).
7. Confirmation, by name only, that `ENTRA_CLIENT_SECRET` and `SCIM_TOKEN` are set as wrangler secrets in each environment, plus both expiry dates.

Do **not** send: the client secret value, the SCIM token, screenshots that show either, or user lists.

## 6. Checks after setup

1. `GET https://<host>/auth/providers` returns `{"entra":true,...}`.
2. Open `https://<host>/auth/login`. You land on `login.microsoftonline.com` for your tenant, sign in, and return to the app with a `__Host-secondary_session` cookie.
3. `GET /v1/me` shows your email and the role ids from your groups. A user with no mapped group shows no roles.
4. In Entra, remove a test user from a mapped group, run Provision on demand, reload: the role is gone on the next request.
5. Disable the test user, Provision on demand: the open tab gets 401 on its next call, and sign-in is refused.

## 7. Troubleshooting

| Symptom | Likely cause |
|---|---|
| `/auth/login` answers 404 | Entra values missing or not GUIDs, or `AUTH_MODE=access` |
| `/auth/login` answers 502 | Discovery failed or described another tenant; check `ENTRA_TENANT_ID` |
| Entra shows AADSTS50011 (reply URL mismatch) | The redirect URI registered differs from `https://<host>/auth/callback` |
| `/auth/callback` answers 401 `sign_in_failed` | Token rejected: wrong tenant, audience or nonce, expired, or no email. The worker log has the reason code only |
| `/auth/callback` answers 403 `account_disabled` | The person is deprovisioned in Secondary (SCIM `active=false`) |
| Signed in but no roles | The person's groups are not assigned to the app, not in the table, or the person is SCIM-provisioned and the group is not provisioned |
| Log line `groups_overage` | The token had too many groups. Switch the claim to "Groups assigned to the application" |
| SCIM test connection fails with 401 | `SCIM_TOKEN` unset, shorter than 32 characters, or different from the Secret Token in Entra |
