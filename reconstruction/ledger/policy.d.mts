export function personalBrain(principalId: string): string;
export function decideAppend(existingById: unknown, streamRow: unknown, incoming: unknown): { action: string; event?: unknown };
export function summarize(events: unknown[]): unknown;
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
        inputTokens: number | null;
        outputTokens: number | null;
        cacheReadTokens: number | null;
        cacheWriteTokens: number | null;
        totalTokens: number | null;
      };
    };
