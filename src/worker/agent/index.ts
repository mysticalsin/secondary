// My Agent (v6, docs/DESIGN-V6-MY-AGENT-GENUI.md). Mounted once in ../routes.ts, after authentication.
//   POST   /agent/turn                 one answer, as server-sent events
//   GET    /views, POST /views         saved views (plan and layout, never data)
//   GET/PUT/DELETE /views/:id, POST/DELETE /views/:id/share, GET /views/shared/:shareId
// Same pilot flag as the rest of /v1/brains: `brains_v3`.

import { Hono } from "hono";
import { TURN_ACTIONS, TurnRequest } from "../../../packages/contracts/src/agent-ui/index.ts";
import { AGENT_LIMITS } from "../ai/config.ts";
import { needFlag } from "../brains/open.ts";
import { tenantStub } from "../stubs.ts";
import type { AppDeps, AppEnv } from "../types.ts";
import { bad, sess } from "../ux/util.ts";
import { runTurn } from "./turn.ts";
import { viewsHandlers } from "./views.ts";

export function agentRoutes(deps: AppDeps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const flag = async (c: Parameters<typeof needFlag>[0], next: () => Promise<void>) =>
    (await needFlag(c, "brains_v3")) ?? next();
  r.use("/agent/*", flag);
  r.use("/views", flag);
  r.use("/views/*", flag);

  r.post("/agent/turn", async (c) => {
    let body: unknown;
    try {
      body = JSON.parse(await c.req.text());
    } catch {
      throw bad("invalid_body");
    }
    const parsed = TurnRequest.safeParse(body);
    // One of text or action. A link action (open_page, open_brain) is not a turn.
    if (
      !parsed.success ||
      (!parsed.data.text && !parsed.data.action) ||
      (parsed.data.action && !TURN_ACTIONS.includes(parsed.data.action.action))
    )
      throw bad("invalid_body");
    const req = parsed.data;
    const s = sess(c);
    const limited = await tenantStub(c.env, s.tenantId).hit(
      `agent:${s.principal.id}`,
      s.ctx.now,
      AGENT_LIMITS.turnsPerMin,
    );
    if (limited.limited) {
      c.header("Retry-After", String(limited.retryAfter));
      return c.json({ error: "rate_limited" }, 429);
    }

    const turnId = crypto.randomUUID();
    const enc = new TextEncoder();
    let job: Promise<void> = Promise.resolve();
    const body$ = new ReadableStream<Uint8Array>({
      start(ctrl) {
        let gone = false;
        // A client that left must not stop the books: sends are ignored from then on.
        const send = async (event: string, data: unknown): Promise<void> => {
          if (gone) return;
          try {
            ctrl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch {
            gone = true;
          }
        };
        job = runTurn({ c, deps, req, turnId, send })
          .catch(async (e) => {
            console.warn(JSON.stringify({ at: "agent_turn", error: String(e).slice(0, 160) }));
            await send("error", { code: "internal_error" });
          })
          .finally(() => {
            try {
              ctrl.close();
            } catch {
              // already closed or cancelled
            }
          });
      },
      cancel() {
        // The reader went away: the job carries on to the ledger and the receipt.
      },
    });
    try {
      c.executionCtx.waitUntil(job);
    } catch {
      // no execution context (a test calling the app directly): the stream's own job keeps running
    }
    return new Response(body$, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  });

  const v = viewsHandlers();
  r.get("/views", (c) => v.list(c));
  r.post("/views", (c) => v.create(c));
  // before "/views/:id": "shared" is not a view id
  r.get("/views/shared/:shareId", (c) => v.shared(c));
  r.get("/views/:id", (c) => v.get(c));
  r.put("/views/:id", (c) => v.update(c));
  r.delete("/views/:id", (c) => v.remove(c));
  r.post("/views/:id/share", (c) => v.share(c));
  r.delete("/views/:id/share", (c) => v.unshare(c));
  return r;
}
