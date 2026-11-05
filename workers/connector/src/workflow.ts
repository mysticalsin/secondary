// One Workflow instance per source sync. Steps are durable: a throttled run sleeps for the Retry-After
// the sync reported, then resumes from the saved cursor. Every step is idempotent (see sync.ts).

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { runSync } from "./runtime.ts";

export interface SyncParams {
  tenantId: string;
  sourceId: string;
}

const MAX_ROUNDS = 40;

export class SourceSyncWorkflow extends WorkflowEntrypoint<Env, SyncParams> {
  override async run(event: WorkflowEvent<SyncParams>, step: WorkflowStep) {
    const { tenantId, sourceId } = event.payload;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const r = await step.do(
        `sync-${round}`,
        {
          retries: { limit: 3, delay: "30 seconds", backoff: "exponential" },
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
