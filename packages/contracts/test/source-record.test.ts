import { describe, expect, it } from "vitest";
import { validate } from "../src/index.ts";
import { buildSourceRecord, type SourceRecordInput } from "../src/source-record.ts";

const base = (): SourceRecordInput => ({
  tenantId: "tenant_synth001",
  plane: "ACCOUNT_RESTRICTED",
  accountId: "acct_synth_acme_0001",
  subspaceId: "sub_synth_root01",
  classification: "account_confidential",
  ownerRef: "principal_synth_own01",
  provider: "sharepoint_drive",
  sourceRecordId: "srcrec_0123456789abcdef01234567",
  driveRef: "drv_0123456789abcdef01234567",
  itemRef: "itm_0123456789abcdef01234567",
  driveId: "b!synthetic-drive-id",
  itemId: "01SYNTHETICITEM",
  sourceRevision: '"{ABC-1},2"',
  webUrl: "https://contoso.example.invalid/sites/x/doc.md",
  contentSha256: "a".repeat(64),
  byteLength: 120,
  extractorVersion: "connector-text-1",
  fetchedAt: "2026-11-05T10:00:00Z",
  aclCheckedAt: "2026-11-05T10:00:00Z",
  aclState: "current",
  aclMaxAgeSeconds: 900,
  deltaCursorRef: null,
  revision: 1,
  createdAt: "2026-11-05T10:00:00Z",
  updatedAt: "2026-11-05T10:00:00Z",
  retentionPolicyRef: "retention_synth_draft01",
});

describe("buildSourceRecord", () => {
  it("produces a record that passes the source-record schema", () => {
    const r = validate("source-record", buildSourceRecord(base()));
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it("is valid for a team plane with no account and for later revisions", () => {
    const rec = buildSourceRecord({
      ...base(),
      plane: "TEAM_RESTRICTED",
      accountId: undefined,
      subspaceId: undefined,
      classification: "internal_confidential",
      revision: 3,
    });
    expect(rec.expected_previous_revision).toBe(2);
    expect(validate("source-record", rec).errors).toEqual([]);
  });

  it("is servable only when the ACL state is current (fail closed)", () => {
    for (const aclState of ["stale", "revoked", "unknown"] as const) {
      const rec = buildSourceRecord({ ...base(), aclState });
      expect(rec.servable).toBe(false);
      expect(validate("source-record", rec).errors).toEqual([]);
    }
    expect(buildSourceRecord(base()).servable).toBe(true);
  });

  it("drops an over-long web URL from the locator", () => {
    const rec = buildSourceRecord({ ...base(), webUrl: `https://x.invalid/${"a".repeat(400)}` });
    expect(rec.source_lineage[0]?.evidence_locator).toBeNull();
    expect(validate("source-record", rec).errors).toEqual([]);
  });
});
