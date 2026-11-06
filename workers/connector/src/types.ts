import type {
  CallOutcome,
  FailureReason,
  RetryPolicy,
} from "../../../packages/contracts/src/ops-v7.ts";

export type Provider = "sharepoint_drive" | "onedrive_folder";
export type AclState = "current" | "stale" | "revoked" | "unknown";

/** Which Secondary scope a source feeds. `scopeId` is the Workspace scope; `gateNodeId` is the policy node a reader needs at content level. */
export interface SourceScope {
  kind: "account" | "circle";
  scopeId: string;
  gateNodeId: string;
  plane: "TEAM_RESTRICTED" | "ACCOUNT_RESTRICTED";
  /** Required for plane ACCOUNT_RESTRICTED. */
  accountId?: string;
  subspaceId?: string;
  classification: string;
  ownerRef: string;
}

/** v7 operate: what an admin tunes per source (Settings, Sources). Absent fields take the defaults. */
export interface SourceSettings {
  /** File types and folders the source is limited to ("pdf", "/Proposals"). Empty: everything. */
  chips: string[];
  deltaMinutes: number;
  retry: RetryPolicy;
  timeoutSeconds: number;
  aclMaxAgeSeconds: number;
}

export interface SourceDef {
  /** `^[a-z][a-z0-9_]{5,39}$`, assigned by the caller of the registry API. */
  id: string;
  provider: Provider;
  siteId: string | null;
  driveId: string;
  /** "" for the whole drive, else "/Folder/Sub". Delta runs on the drive root and is filtered to this path. */
  folderPath: string;
  scope: SourceScope;
  enabled: boolean;
  /** Paused: no cron or manual sync runs, but the synced items stay (unlike `enabled: false`, which purges). */
  paused?: boolean;
  /** Display name, no content. */
  name?: string;
  settings?: SourceSettings;
  createdAt: number;
}

/** One Graph call, kept for the latency chart. */
export interface CallRow {
  at: number;
  ms: number;
  outcome: CallOutcome;
}

/** One sync attempt. `n` counts consecutive failed runs: 1 is a first try. */
export interface AttemptRow {
  at: number;
  ms: number;
  outcome: "ok" | "throttled" | "error" | "timeout";
  reason: FailureReason | null;
  n: number;
  retryAfter: number | null;
}

export interface Cursor {
  sourceId: string;
  deltaLink: string | null;
  /** Resume point inside a paged pass. */
  nextLink: string | null;
  /** True while a full enumeration is running (first sync or after a 410). */
  full: boolean;
  /** Bumped at the start of every full pass; records not touched by it are deleted at its end. */
  gen: number;
  lastSyncAt: number | null;
  lastFullAt: number | null;
  lastError: string | null;
}

export interface LocalRecord {
  /** Secondary item id: `src:<sourceId>:<hex24>`. */
  itemId: string;
  sourceId: string;
  kind: "file" | "folder";
  driveItemId: string;
  parentId: string | null;
  name: string;
  mime: string | null;
  size: number;
  eTag: string;
  cTag: string | null;
  webUrl: string | null;
  contentSha256: string;
  /** True only when a UTF-8 text extract was stored in the Workspace. Binary types never are. */
  hasText: boolean;
  extractorVersion: string;
  fetchedAt: number;
  aclCheckedAt: number | null;
  aclState: AclState;
  revision: number;
  createdAt: number;
  updatedAt: number;
  gen: number;
}

export interface AclEntry {
  allowed: boolean;
  checkedAt: number;
}

/** Everything the sync and ACL code needs from storage. Implemented by the ConnectorState Durable Object. */
type Awaitable<T> = T | Promise<T>;

export interface Store {
  putSource(def: SourceDef): Awaitable<void>;
  getSource(id: string): Awaitable<SourceDef | null>;
  listSources(): Awaitable<SourceDef[]>;
  deleteSource(id: string): Awaitable<void>;
  getCursor(sourceId: string): Awaitable<Cursor>;
  setCursor(c: Cursor): Awaitable<void>;
  getRecord(itemId: string): Awaitable<LocalRecord | null>;
  putRecord(r: LocalRecord): Awaitable<void>;
  touchRecord(itemId: string, gen: number): Awaitable<void>;
  /** Ids of the file records at or below `itemId` (the item itself when it is a file). Read-only. */
  listTree(itemId: string): Awaitable<string[]>;
  /** Deletes the record, its ACL cache, and (for a folder) every descendant. */
  deleteTree(itemId: string): Awaitable<void>;
  /** Records of a source whose `gen` is older than `gen`. */
  listOlder(
    sourceId: string,
    gen: number,
  ): Awaitable<{ itemId: string; kind: "file" | "folder" }[]>;
  /** Removes every record and ACL entry of a source. Returns the removed file ids. */
  deleteBySource(sourceId: string): Awaitable<string[]>;
  getAcl(itemId: string, userKey: string): Awaitable<AclEntry | null>;
  putAcl(itemId: string, userKey: string, e: AclEntry): Awaitable<void>;
  /** Right to erasure: drops every cached decision of one user. Returns the number of rows removed. */
  deleteAclForUser(userKey: string): Awaitable<number>;
  deleteAclFor(itemId: string): Awaitable<void>;
  countRecords(sourceId: string): Awaitable<number>;
  listFiles(sourceId: string, limit: number): Awaitable<LocalRecord[]>;
  /** v7: Graph call timings (last 320 per source) and sync attempts (7 days). */
  recordCall(sourceId: string, c: CallRow): Awaitable<void>;
  listCalls(sourceId: string, limit: number): Awaitable<CallRow[]>;
  recordAttempt(sourceId: string, a: Omit<AttemptRow, "n">): Awaitable<void>;
  listAttempts(sourceId: string, since: number): Awaitable<AttemptRow[]>;
  /** Cached read decisions for the files of one source. */
  aclRows(sourceId: string): Awaitable<{ allowed: boolean; checkedAt: number }[]>;
}

export const NOT_CONFIRMED = "source permission could not be confirmed";

export interface ApiItem {
  id: string;
  title: string;
  /** UTF-8 text extract, or null for binary types and anything over the limits. */
  body: string | null;
  webUrl: string | null;
  mime: string | null;
  size: number;
  eTag: string;
  syncedAt: number;
}

/** Writes into the target Workspace through workers/api. Throws on any failure. */
export interface ApiSink {
  upsert(tenantId: string, source: SourceDef, items: ApiItem[]): Promise<void>;
  remove(tenantId: string, source: SourceDef, itemIds: string[]): Promise<void>;
  purge(tenantId: string, source: SourceDef): Promise<void>;
}
