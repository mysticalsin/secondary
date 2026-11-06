import { request } from "../api";
import type { InsightQuery, Insights, OverviewTile } from "./types";

export const insightsApi = {
  insights: (brain: string, o: InsightQuery = {}) => {
    const p = new URLSearchParams();
    if (o.mode) p.set("mode", o.mode);
    if (o.q) p.set("q", o.q);
    if (o.scoreKind) p.set("scoreKind", o.scoreKind);
    if (o.focus) p.set("focus", o.focus);
    if (o.window) p.set("window", o.window);
    const s = p.toString();
    return request<Insights>(
      "GET",
      `/v1/brains/${encodeURIComponent(brain)}/insights${s ? `?${s}` : ""}`,
    );
  },
  overview: () =>
    request<{ generatedAt: string; brains: OverviewTile[] }>("GET", "/v1/brains/overview"),
};
