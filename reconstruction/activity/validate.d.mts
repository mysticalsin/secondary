export type ReviewRecord = {
  record_id: string;
  session_id: string | null;
  capture: string;
  agent: string;
  tool: { name: string };
  started_at: string | null;
  finished_at: string | null;
  analysis_kind: string;
  target: { label: string | null };
  outcome: { completed: boolean; exit_code: number | null; overall_verdict: string | null; counts: Record<string, number | null> };
  tokens_used: number | null;
  writes_detected: boolean;
  context_scope: { usual_notes_loaded: boolean | null };
  evidence_paths: string[];
  notes: string;
};

export function parseStoredRecord(text: string): ReviewRecord;
export function parseNdjson(bytes: string | Uint8Array): Promise<{
  records: ReviewRecord[];
  incomplete: boolean;
  ledgerSha256: string;
  byteLength: number;
}>;
export function recordHash(value: unknown): Promise<string>;
export function sortRecords<T extends { finished_at: string | null; started_at: string | null; record_id: string }>(records: T[]): T[];
export function viewRecord(record: ReviewRecord): {
  id: string;
  session_id: string | null;
  capture: string;
  finished_at: string | null;
  started_at: string | null;
  activity_label: string;
  what_reviewed: string | null;
  outcome: ReviewRecord["outcome"];
  token_usage: { value: number | null; label: string };
  observed_writes_detected: boolean;
  context_scope: ReviewRecord["context_scope"];
  evidence_provenance_pointers: string[];
  untrusted_notes: string;
  trusted_runtime_capture: false;
  synthetic: boolean;
  reported_by: { agent: string; tool: { name: string } };
  analysis_kind: string;
};
export function brtNow(date?: Date): string;
