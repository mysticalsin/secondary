// Kill switch for MCP. The state lives in the API (TenantPolicy). This worker asks for it with a
// signed service-binding call and caches the answer for a few seconds, so a switched-off server
// stops answering at the edge. The authoritative check is in the API, which refuses every internal
// call while the switch is off and is the only way any tool reaches data. So when the API cannot be
// asked here, the call goes on and meets that check: no tool can run, nothing is bypassed.

import { logEvent } from "../../../packages/contracts/src/log.ts";
import { signOpsRequest } from "../../../packages/contracts/src/ops-auth.ts";

const DEFAULT_CACHE_MS = 5_000;
let cached: { at: number; on: boolean } | null = null;

export async function mcpEnabled(env: Env, now = Date.now()): Promise<boolean> {
  const parsed = Number.parseInt(env.SWITCH_CACHE_MS ?? "", 10);
  const ttl = Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_CACHE_MS;
  if (cached && now - cached.at < ttl) return cached.on;
  let on = true;
  try {
    const url = `https://api.internal/v1/internal/mcp/switches?tenant=${encodeURIComponent(env.DEFAULT_TENANT_ID)}`;
    const headers = await signOpsRequest({
      secret: env.INTERNAL_HMAC_KEY,
      kid: env.INTERNAL_HMAC_KID,
      method: "GET",
      url,
    });
    const res = await env.API.fetch(url, { headers });
    if (res.ok)
      on = ((await res.json()) as { switches?: { mcp?: boolean } }).switches?.mcp !== false;
    // Failing open is by design (see the note at the top), but an unanswered pre-check is logged (I-03).
    else
      logEvent({
        event: "mcp_switch_check_failed",
        worker: "mcp",
        env: env.ENVIRONMENT,
        status: res.status,
      });
  } catch (e) {
    logEvent({
      event: "mcp_switch_check_failed",
      worker: "mcp",
      env: env.ENVIRONMENT,
      errorName: e instanceof Error ? e.name : "unknown",
    });
  }
  cached = { at: now, on };
  if (!on) logEvent({ event: "mcp_switched_off", worker: "mcp", env: env.ENVIRONMENT });
  return on;
}
