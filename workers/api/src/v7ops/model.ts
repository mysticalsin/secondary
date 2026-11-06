// v7 operate (docs/API-CONTRACT.md "v7 Operate"): the shapes the three views share. Pure, no I/O.

import type { FailureReason, RetryPolicy } from "../../../../packages/contracts/src/ops-v7.ts";

/** A source config id (`src_...`), as opposed to a file record id (`src:<sourceId>:<hex>`). */
export const SOURCE_CFG_ID = /^[a-z][a-z0-9_]{5,39}$/;
export const CREDENTIAL_NAME = "GRAPH_CLIENT_SECRET";
export const ROTATE_KEY = (id: string): string => `source:rotate:${id}`;

export type Settings = {
  chips: string[];
  deltaMinutes: number;
  retry: RetryPolicy;
  timeoutSeconds: number;
  aclMaxAgeSeconds: number;
};

export const FILE_TYPES = [
  "pdf",
  "docx",
  "doc",
  "pptx",
  "ppt",
  "xlsx",
  "xls",
  "csv",
  "md",
  "txt",
  "rtf",
  "msg",
  "eml",
  "html",
  "json",
  "xml",
  "png",
  "jpg",
  "vsdx",
  "one",
  "odt",
  "ods",
  "odp",
  "zip",
] as const;

/** One source as a backend reports it. `scopeId` is the Workspace scope the source feeds. */
export type SourceRow = {
  id: string;
  name: string;
  provider: "sharepoint_drive" | "onedrive_folder";
  folder: string;
  scopeId: string;
  paused: boolean;
  settings: Settings;
  lastSyncAt: number | null;
  lastError: string | null;
  files: number;
  rotatedAt: number | null;
  synthetic: boolean;
};

export type AttemptOut = {
  at: number;
  ms: number;
  outcome: "ok" | "throttled" | "error" | "timeout";
  reason: FailureReason | null;
  n: number;
  retryAfter: number | null;
};

export type SourceStats = {
  synthetic: boolean;
  retry: {
    plan: { try: number; afterSeconds: number; atSeconds: number }[];
    tries: number;
    totalSeconds: number;
    honoursRetryAfter: true;
    next: { try: number; inSeconds: number; last: string } | null;
  };
  latency: {
    n: number;
    timeoutSeconds: number;
    p50Ms: number;
    p95Ms: number;
    timedOut: number;
    timedOutShare: number;
    hint: { raiseTimeout: boolean; suggestedSeconds: number | null };
    points: { ms: number; outcome: "ok" | "timeout" | "429" | "error" }[];
  };
  acl: {
    maxAgeSeconds: number;
    total: number;
    confirmed: number;
    stale: number;
    failClosed: number;
    share: number;
  };
};

export type SourceAttempts = { id: string; name: string; scopeId: string; attempts: AttemptOut[] };

export type RunResult = "queued" | "paused" | "not_found" | "unavailable";

/** Where source config and numbers come from: the connector worker, or the dev stand-in. */
export interface SourcesBackend {
  readonly synthetic: boolean;
  list(): Promise<SourceRow[] | null>;
  get(id: string): Promise<SourceRow | null>;
  /** Merge: only the given settings change. Null when the source does not exist or the backend is down. */
  put(
    id: string,
    patch: { settings?: Partial<Settings>; paused?: boolean; rotatedAt?: number },
  ): Promise<SourceRow | null>;
  run(id: string): Promise<RunResult>;
  stats(id: string): Promise<SourceStats | null>;
  attempts(since: number): Promise<SourceAttempts[]>;
}
