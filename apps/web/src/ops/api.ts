import { request } from "../api";
import type {
  ActivityQuery,
  ActivityResponse,
  EventDetail,
  HealthResponse,
  HealthWindow,
  RetryResult,
  RotateResult,
  SourceConfig,
  SourceList,
  SourcePatch,
  SourceStats,
} from "./types";

const q = encodeURIComponent;

function qs(o: Record<string, string | undefined>): string {
  const p = Object.entries(o).filter(([, v]) => v);
  return p.length ? `?${p.map(([k, v]) => `${k}=${q(v as string)}`).join("&")}` : "";
}

const activityQs = (a: ActivityQuery) =>
  qs({
    window: a.window,
    status: a.status === "all" ? undefined : a.status,
    q: a.q.trim() || undefined,
    from: a.from,
    to: a.to,
    host: a.host,
  });

export const ops = {
  // Brain activity (brain managers only)
  brainActivity: (brain: string, a: ActivityQuery) =>
    request<ActivityResponse>("GET", `/v1/brains/${q(brain)}/activity${activityQs(a)}`),
  brainEvent: (brain: string, id: string) =>
    request<EventDetail>("GET", `/v1/brains/${q(brain)}/activity/${q(id)}`),
  retryEvent: (brain: string, id: string) =>
    request<RetryResult>("POST", `/v1/brains/${q(brain)}/activity/${q(id)}/retry`, {}),
  // The caller's own agent calls
  agentActivity: (a: ActivityQuery) =>
    request<ActivityResponse>("GET", `/v1/agents/activity${activityQs(a)}`),
  agentEvent: (id: string) => request<EventDetail>("GET", `/v1/agents/activity/${q(id)}`),
  // Sources (admins)
  sources: () => request<SourceList>("GET", "/v1/sources"),
  source: (id: string) => request<SourceConfig>("GET", `/v1/sources/${q(id)}`),
  saveSource: (id: string, patch: SourcePatch) =>
    request<SourceConfig>("PUT", `/v1/sources/${q(id)}`, patch),
  runSource: (id: string) => request<{ ok: true }>("POST", `/v1/sources/${q(id)}/run`, {}),
  rotate: (id: string) =>
    request<RotateResult>("POST", `/v1/sources/${q(id)}/credential/rotate`, {}),
  sourceStats: (id: string, window: "24h" | "7d" = "24h") =>
    request<SourceStats>("GET", `/v1/sources/${q(id)}/stats${qs({ window })}`),
  // Platform health (admins and stewards)
  health: (window: HealthWindow) => request<HealthResponse>("GET", `/v1/health${qs({ window })}`),
};
