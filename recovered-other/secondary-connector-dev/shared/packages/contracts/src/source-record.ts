// SourceRecord builder for connectors (PRD 4.2). Pure: no clock, no I/O, so it runs in Node, workerd and tests.
// Fail closed: `servable` is true only when the last permission check is current. Binary files carry
// metadata only; this record never holds content.

export type SourceAclState = "current" | "stale" | "revoked" | "unknown";
export type SourceProvider = "sharepoint_drive" | "onedrive_folder" | "synthetic_upload";

export interface SourceRecordInput {
  tenantId: string;
  plane: "TEAM_RESTRICTED" | "ACCOUNT_RESTRICTED";
  /** Required for ACCOUNT_RESTRICTED, forbidden otherwise. */
  accountId?: string;
  subspaceId?: string;
  classification: string;
  ownerRef: string;
  provider: SourceProvider;
  /** Opaque, server-assigned ids (never a file or customer name). */
  sourceRecordId: string;
  driveRef: string;
  itemRef: string;
  /** Raw provider ids for lineage. */
  driveId: string;
  itemId: string;
  /** eTag of the item; goes to `source_revision`. */
  sourceRevision: string;
  /** Web URL. Kept as the lineage locator only when it fits (300 characters). */
  webUrl: string | null;
  contentSha256: string;
  byteLength: number;
  extractorVersion: string;
  fetchedAt: string;
  aclCheckedAt: string;
  aclState: SourceAclState;
  aclMaxAgeSeconds: number;
  deltaCursorRef: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  retentionPolicyRef: string;
}

export interface SourceRecord {
  schema_version: "secondary.source-record/1";
  source_record_id: string;
  tenant_id: string;
  plane: SourceRecordInput["plane"];
  account_id?: string;
  subspace_id?: string;
  revision: number;
  expected_previous_revision: number | null;
  classification: string;
  personal_data_state: "unknown_quarantined";
  owner_ref: string;
  source_lineage: {
    source_provider: string;
    source_namespace: string;
    source_id: string;
    source_revision: string;
    evidence_status: "documented";
    evidence_locator: string | null;
  }[];
  lifecycle: { state: "quarantined"; created_at: string; updated_at: string };
  retention: { policy_ref: string; review_due: null; legal_hold: false };
  provider: SourceProvider;
  drive_ref: string;
  item_ref: string;
  source_revision: string;
  content_sha256: string;
  byte_length: number;
  extractor_version: string;
  fetched_at: string;
  acl_checked_at: string;
  acl_state: SourceAclState;
  acl_max_age_seconds: number;
  servable: boolean;
  delta_cursor_ref: string | null;
}

const MAX_LOCATOR = 300;

/**
 * Synced files are not classified for personal data by the connector, so they start as
 * `unknown_quarantined` (the schema then forces lifecycle `quarantined`). A steward reclassifies later.
 */
export function buildSourceRecord(i: SourceRecordInput): SourceRecord {
  const locator = i.webUrl && i.webUrl.length <= MAX_LOCATOR ? i.webUrl : null;
  return {
    schema_version: "secondary.source-record/1",
    source_record_id: i.sourceRecordId,
    tenant_id: i.tenantId,
    plane: i.plane,
    ...(i.plane === "ACCOUNT_RESTRICTED"
      ? { account_id: i.accountId as string, subspace_id: i.subspaceId as string }
      : {}),
    revision: i.revision,
    expected_previous_revision: i.revision > 1 ? i.revision - 1 : null,
    classification: i.classification,
    personal_data_state: "unknown_quarantined",
    owner_ref: i.ownerRef,
    source_lineage: [
      {
        source_provider: i.provider,
        source_namespace: i.driveId.slice(0, 200),
        source_id: i.itemId.slice(0, 200),
        source_revision: i.sourceRevision.slice(0, 200),
        evidence_status: "documented",
        evidence_locator: locator,
      },
    ],
    lifecycle: { state: "quarantined", created_at: i.createdAt, updated_at: i.updatedAt },
    retention: { policy_ref: i.retentionPolicyRef, review_due: null, legal_hold: false },
    provider: i.provider,
    drive_ref: i.driveRef,
    item_ref: i.itemRef,
    source_revision: i.sourceRevision.slice(0, 200),
    content_sha256: i.contentSha256,
    byte_length: i.byteLength,
    extractor_version: i.extractorVersion,
    fetched_at: i.fetchedAt,
    acl_checked_at: i.aclCheckedAt,
    acl_state: i.aclState,
    acl_max_age_seconds: i.aclMaxAgeSeconds,
    servable: i.aclState === "current",
    delta_cursor_ref: i.deltaCursorRef,
  };
}
