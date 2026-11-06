import { request } from "../../api";
import type { Desk, DeskDetail, SlaInfo } from "./types";

const q = encodeURIComponent;

export const deskApi = {
  desk: () => request<Desk>("GET", "/v1/review-desk"),
  detail: (id: string) => request<DeskDetail>("GET", `/v1/review-desk/${q(id)}`),
  /** A 409 `personal_data_warning` (body.kinds) asks the person to confirm: resend with `acknowledged: true`. */
  comment: (id: string, text: string, acknowledged = false) =>
    request<{ ok: boolean; mentioned: string[]; unresolved: string[] }>(
      "POST",
      `/v1/review-desk/${q(id)}/comments`,
      { text, ...(acknowledged ? { acknowledged: true } : {}) },
    ),
  snooze: (id: string, until: string | null) =>
    request<{ ok: boolean; snoozedUntil: string | null }>(
      "POST",
      `/v1/review-desk/${q(id)}/snooze`,
      {
        until,
      },
    ),
  reassign: (id: string, to: string | null) =>
    request<{ ok: boolean; assignedTo: string | null }>(
      "POST",
      `/v1/review-desk/${q(id)}/reassign`,
      {
        to,
      },
    ),
  requestChanges: (id: string, note: string, revisionHash: string, acknowledged = false) =>
    request<{ ok: boolean }>("POST", `/v1/review-desk/${q(id)}/request-changes`, {
      note,
      revisionHash,
      ...(acknowledged ? { acknowledged: true } : {}),
    }),
  sla: (brainId: string) => request<SlaInfo>("GET", `/v1/brains/${q(brainId)}/review-sla`),
  setSla: (brainId: string, days: number) =>
    request<SlaInfo>("PUT", `/v1/brains/${q(brainId)}/review-sla`, { days }),
};
