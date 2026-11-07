// Turns the connector's local state into the contract SourceRecord (packages/contracts source-record schema).

import {
  buildSourceRecord,
  type SourceRecord,
} from "../../../packages/contracts/src/source-record.ts";
import { sha256Hex } from "./ids.ts";
import type { Cursor, LocalRecord, SourceDef } from "./types.ts";

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

export async function toSourceRecord(
  tenantId: string,
  src: SourceDef,
  rec: LocalRecord,
  cursor: Cursor | null,
  now: number,
  maxAgeSeconds: number,
): Promise<SourceRecord> {
  const h = async (s: string) => (await sha256Hex(s)).slice(0, 24);
  // An ACL state only counts as current while it is inside the staleness bound.
  const fresh = rec.aclCheckedAt !== null && now - rec.aclCheckedAt <= maxAgeSeconds * 1000;
  const aclState = rec.aclState === "current" && !fresh ? "stale" : rec.aclState;
  return buildSourceRecord({
    tenantId,
    plane: src.scope.plane,
    accountId: src.scope.accountId,
    subspaceId: src.scope.subspaceId,
    classification: src.scope.classification,
    ownerRef: src.scope.ownerRef,
    provider: src.provider,
    sourceRecordId: `srcrec_${await h(rec.itemId)}`,
    driveRef: `drv_${await h(src.driveId)}`,
    itemRef: `itm_${await h(`${src.driveId}/${rec.driveItemId}`)}`,
    driveId: src.driveId,
    itemId: rec.driveItemId,
    sourceRevision: rec.eTag || "unknown",
    webUrl: rec.webUrl,
    contentSha256: rec.contentSha256,
    byteLength: Math.min(rec.size, 104_857_600),
    extractorVersion: rec.extractorVersion,
    fetchedAt: iso(rec.fetchedAt),
    aclCheckedAt: iso(rec.aclCheckedAt ?? rec.fetchedAt),
    aclState,
    aclMaxAgeSeconds: maxAgeSeconds,
    deltaCursorRef: cursor?.deltaLink ? `cursor_${src.id}` : null,
    revision: rec.revision,
    createdAt: iso(rec.createdAt),
    updatedAt: iso(rec.updatedAt),
    retentionPolicyRef: "retention_connector_default",
  });
}
