# Graph Sites.Selected connector: admin consent and per-site grant

Status: TO VERIFY against the live tenant. Nothing here was run against Microsoft 365. Items marked (to verify) are Microsoft behaviours that the recorded-mock tests cannot prove.

Worker: `workers/connector` (`secondary-connector-dev`). Synthetic data only until a Mantu-owned Cloudflare account and a DPA exist.

## What the connector asks Microsoft for

- One Entra app, application permission `Sites.Selected` only. It reads nothing until a site admin grants it a site.
- No `Sites.Read.All`, `Files.Read.All`, `GroupMember.Read.All` or app-only `Calendars.Read`.
- Drive item delta (GA). A 410 means the token expired and the connector runs a full resync.
- Permission-change delta needs `Sites.FullControl.All`, so it is not used. Permissions are checked at read time instead (below).
- Teams channel messages have no delta, so they are out of scope.

## What Tony or IT must do

1. Register an Entra app ("Secondary connector") in the Mantu tenant. Note the tenant id and client id.
2. Add the Microsoft Graph application permission `Sites.Selected` and grant admin consent.
3. Create a client secret. Set it with `wrangler secret put GRAPH_CLIENT_SECRET` on `secondary-connector-dev`. Never put it in a file or chat.
4. Set the vars `GRAPH_TENANT_ID` and `GRAPH_CLIENT_ID` in `workers/connector/wrangler.jsonc`.
5. Create the queue: `wrangler queues create secondary-sync-dev`.
6. Create one 32+ character random key and set it as `CONNECTOR_HMAC_KEY` on both `secondary-connector-dev` and `secondary-api-dev`.
7. Deploy order (to verify): the api and the connector bind each other. Deploy the connector first without the `API` binding, deploy the api, then redeploy the connector with the binding.
8. Grant each site (next section), register the source, then set `CONNECTOR_ENABLED` to `"true"`.

## Per-site grant

An admin identity that can manage site permissions (for example an app holding `Sites.FullControl.All` used once, or Graph Explorer as a SharePoint admin) runs:

1. Find the site id: `GET https://graph.microsoft.com/v1.0/sites/{host}:/sites/{site-path}`.
2. Grant the connector app:

```
POST https://graph.microsoft.com/v1.0/sites/{site-id}/permissions
{ "roles": ["read"],
  "grantedToIdentities": [ { "application": { "id": "<connector client id>", "displayName": "Secondary connector" } } ] }
```

3. Find the drive id: `GET /sites/{site-id}/drives`.

Use `read`. (To verify) Listing `/drives/{id}/items/{id}/permissions` may need more than `read`. If Graph answers 403, every item stays hidden (fail closed). Do not raise the role without a security decision; the alternative is a delegated check once Entra delegated tokens exist.

## Register a source

Sources are managed by signed calls to the connector (`PUT /internal/sources/{id}`), made by the api admin proxy or an ops script signed with `CONNECTOR_HMAC_KEY` as client `secondary-ops`. Body example:

```
{ "tenantId": "tenant_mantu_synthetic", "provider": "sharepoint_drive",
  "driveId": "<drive id>", "folderPath": "/Bids",
  "scope": { "kind": "circle", "scopeId": "c_bid", "gateNodeId": "c_bid",
             "classification": "internal_confidential", "ownerRef": "owner_bid_circle" } }
```

For an account use `kind: "account"` plus `accountId` (`acct_...`) and `subspaceId`. The drive and target scope cannot change after creation. Disabling or deleting a source removes what it wrote to the Workspace. The source id is lower case, 6 to 40 characters.

## What gets stored

- Metadata and a source link for every file. A text extract only for UTF-8 `.md`, `.markdown` and `.txt` files up to 256 KiB.
- Office, PDF and images are never downloaded (PRD 4.2). Synced files start as personal-data `unknown_quarantined` until a steward reviews them.
- SourceRecords (contract `source-record`) are readable at `GET /internal/sources/{id}/records`.

## Read-time permission check

When someone searches or opens a source file, the api asks the connector. The connector lists the item's permissions through Graph and confirms access only for a direct user grant or an invitation to the user's email.

- Group grants and sharing links do not confirm, because group membership needs `GroupMember.Read.All`. Files shared only with a group stay hidden until a delegated check exists.
- A decision is cached per user for `ACL_MAX_AGE_SECONDS` (default 900, maximum 86400). Revocations take effect within that time. A content change from delta clears the cache for that item.
- Stale, throttled, failed or unconfigured means hidden. The api answers 403 with "source permission could not be confirmed" on open and omits the item from search.

## Kill switch

Set `CONNECTOR_ENABLED` to `"false"` and redeploy. Cron, queue and workflow stop, and every permission check denies, so source files disappear from search and open at once. Nothing is deleted; to remove content, delete the source.

## Calendar

Delegated only and off (`CALENDAR_ENABLED=false`). App-only `Calendars.Read` reads every mailbox, so it is never requested. To enable later: the Entra OIDC work must request the delegated `Calendars.Read` scope at sign-in and pass the user's own token with each call. The connector uses it once, never stores it, reads a window of at most 14 days, and selects only id, subject, start, end and cancelled flag.

## Verify after enabling (to verify)

1. `GET /health` on the binding shows `enabled` and `graphConfigured` true.
2. Register one test site folder with synthetic files, trigger `POST /internal/sources/{id}/sync`, and check the file count.
3. Remove a file at the source and sync again: it must leave search.
4. Remove a user's access at the source and wait out `ACL_MAX_AGE_SECONDS`: the file must be hidden for that user.
