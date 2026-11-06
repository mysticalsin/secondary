import { request } from "../../api";
import type { DismissReason, Gap, GapList, TopGaps } from "./types";

const q = encodeURIComponent;
const base = (brain: string, gap: string) => `/v1/brains/${q(brain)}/gaps/${q(gap)}`;

export const gapsApi = {
  list: (brain: string, status: "active" | "closed" | "dismissed" | "all" = "active") =>
    request<GapList>("GET", `/v1/brains/${q(brain)}/gaps?status=${status}`),
  assign: (brain: string, gap: string, to: string, due: string) =>
    request<{ ok: boolean; gap: Gap }>("POST", `${base(brain, gap)}/assign`, { to, due }),
  /** 201 with the new draft; 409 `already_started` or `page_exists` come back as ApiError. */
  start: (brain: string, gap: string, title?: string) =>
    request<{ ok: boolean; proposalId: string; pageId: string; title: string; status: "candidate" }>(
      "POST",
      `${base(brain, gap)}/start`,
      title ? { title } : {},
    ),
  merge: (brain: string, gap: string, into: string) =>
    request<{ ok: boolean; gap: Gap }>("POST", `${base(brain, gap)}/merge`, { into }),
  dismiss: (brain: string, gap: string, reason: DismissReason, note?: string) =>
    request<{ ok: boolean; gap: Gap }>("POST", `${base(brain, gap)}/dismiss`, {
      reason,
      ...(note ? { note } : {}),
    }),
  top: (limit = 5) => request<TopGaps>("GET", `/v1/gaps/top?limit=${limit}`),
};
