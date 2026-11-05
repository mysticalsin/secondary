# Runbook: offboarding a person

Goal: access ends within minutes, their personal data is handled per policy, company content stays.

## 1. Cut access (same day, ideally before the conversation)

1. Disable the account in Entra. SCIM deprovisioning removes roles, memberships, NDA grants and elevations in Secondary and ends the person's sessions at once. The API reads roles and the active flag from the tenant object on every request, so the next request is refused; the revocation epoch is only a change counter and is not compared. Where SCIM is not yet live, a platform admin removes the roles and grants in the admin console (each change bumps the epoch).
2. Revoke their MCP grants (INCIDENT.md, section 2). Refresh tokens last 30 days; a revoked grant ends them.
3. Check: `GET /v1/audit/receipts?principal=<id>&days=1` should show only denials after the cut.

## 2. Company content they authored

Stays. Items they authored, comments and approvals remain under their id while they are an employee or contractor under contract. Reassign open review items to another steward through the review queue.

## 3. Personal Brain

Default: keep for the retention period of the data protection notice, then it is deleted by the retention job. Drafts and briefs are removed automatically after `RETENTION_DRAFT_DAYS` (90) and `RETENTION_BRIEF_DAYS` (30) days without change. Notes are kept until erasure.

If the person (or the DPO) asks for erasure or an export:

- Export: `GET /v1/admin/rights/export?principal=<id>` as a platform admin. Hand the file over through the DPO, not by chat or email.
- Erase: `POST /v1/admin/rights/erase {"principal":"<id>"}`. Needs two different platform admins (the first call returns 202 `pending`, the second completes it within 24 hours). It deletes the Personal Brain, replaces their id by a keyed pseudonym in company items, comments, approvals and audit receipts, removes the directory entry and bumps the epoch. The erase itself is audited by pseudonym.

Prefer the id over the email in the URL. Do the Entra disable first: a person still signing in is recreated as a new anonymous principal.

## 4. Shared accounts and keys

Remove them from any Cloudflare Access policy, Azure DevOps group and the key vault readers. If they held `OPS_ADMIN_KEY`, `BACKUP_KEY` or any secret, rotate it (KEY-ROTATION.md).

## 5. Record

Note the date, the approver and the receipt ids in the offboarding ticket. Do not put the person's data in the ticket.
