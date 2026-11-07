export type UsageEvent = {
  eventId: string;
  principalId: string;
  payloadHash?: string;
  providerRequestId?: string | null;
  clientId?: string | null;
  streamSeq?: number | null;
  serverAt?: string;
  updatedAt?: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
  totalTokens?: number | null;
  trust?: string;
  evidence?: string;
  operation?: string;
  outcome?: string;
  requestId?: string;
  brainId?: string;
  describesRequestId?: string | null;
  brain?: string | null;
  provider?: string | null;
  model?: string | null;
  retryOf?: string | null;
  reportedAt?: string | null;
};
export function personalBrain(principalId: string): string;
export function decideAppend(
  existingById: UsageEvent | null,
  streamRow: UsageEvent | null,
  incoming: UsageEvent,
): { action: "idempotent"; event: UsageEvent } | { action: "conflict" } | { action: "replace"; event: UsageEvent } | { action: "insert" };
export function summarize(events: UsageEvent[]): {
  operations: number;
  events: number;
  tokenCoverage: { unknown: number; clientReported: number; serverMeasured: number; syntheticFixture: number };
  input: { value: number | null; complete: boolean; unknownEvents: number; knownEvents: number };
  output: { value: number | null; complete: boolean; unknownEvents: number; knownEvents: number };
  cacheRead: { value: number | null; complete: boolean; unknownEvents: number; knownEvents: number };
  cacheWrite: { value: number | null; complete: boolean; unknownEvents: number; knownEvents: number };
  total: { value: number | null; complete: boolean; unknownEvents: number; knownEvents: number };
  cost: "unknown";
  pricingVersion: null;
  providerVerified: false;
};
export function canonicalHash(value: unknown): Promise<string>;
export function syntheticFixture(name: unknown): {
  trust: string;
  evidence: string;
  providerVerified: boolean;
  provider: string;
  model: string;
  outcome: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  totalTokens: number | null;
} | null;
export function validateClientReport(input: unknown):
  | { ok: false; error: string; field?: string }
  | {
      ok: true;
      report: {
        eventId: string;
        brain: string | null;
        describesRequestId: string | null;
        outcome: string;
        provider: string | null;
        model: string | null;
        providerRequestId: string | null;
        streamSeq: number | null;
        retryOf: string | null;
        reportedAt: string | null;
        inputTokens: number | null;
        outputTokens: number | null;
        cacheReadTokens: number | null;
        cacheWriteTokens: number | null;
        totalTokens: number | null;
      };
    };
