// One Workflow instance per source sync. Steps are durable: a throttled run sleeps for the Retry-After
// the sync reported, then resumes from the saved cursor. Every step is idempotent (see sync.ts).

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { DEFAULT_RETRY, type RetryPolicy } from "../../../packages/contracts/src/ops-v7.ts";
import { runSync } from "./runtime.ts";
import { stateStub } from "./state.ts";

export interface SyncParams {
  tenantId: string;
  sourceId: string;
}

const MAX_ROUNDS = 40;

/** The Workflow step retry settings for a source's retry policy (Settings, Sources). */
export function stepRetries(p: RetryPolicy): {
  limit: number;
  delay: `${number} seconds`;
  backoff: "constant" | "linear" | "exponential";
} {
  if (p.kind === "none") return { limit: 0, delay: "1 seconds", backoff: "constant" };
  if (p.kind === "exponential")
    return { limit: p.tries - 1, delay: `${p.baseSeconds} seconds`, backoff: "exponential" };
  if (p.kind === "linear")
    return { limit: p.tries - 1, delay: `${p.everySeconds} seconds`, backoff: "linear" };
  return { limit: p.times.length, delay: `${p.times[0] ?? 1} seconds`, backoff: "constant" };
}

export class SourceSyncWorkflow extends WorkflowEntrypoint<Env, SyncParams> {
  override async run(event: WorkflowEvent<SyncParams>, step: WorkflowStep) {
    const { tenantId, sourceId } = event.payload;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      // Read each round, outside a step: it only tunes this step's retries, and a saved change applies at once.
      const policy =
        (await stateStub(this.env, tenantId).getSource(sourceId))?.settings?.retry ?? DEFAULT_RETRY;
      const r = await step.do(
        `sync-${round}`,
        {
          retries: stepRetries(policy),
          timeout: "5 minutes",
        },
        async () => {
          const out = await runSync(this.env, tenantId, sourceId);
          // A thrown error makes the step retry with backoff. Everything else is a plain result.
          if (out.status === "error") throw new Error(out.error);
          return out;
        },
      );
      if (r.status === "more") continue;
      if (r.status === "throttled") {
        const wait = Math.min(Math.max(r.retryAfterSeconds, 1), 900);
        await step.sleep(`throttled-${round}`, `${wait} seconds`);
        continue;
      }
      return r;
    }
    return { status: "more" as const };
  }
}
