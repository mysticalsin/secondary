import { request } from "../api";
import type {
  ComposeInput,
  LandingDraft,
  LandingSummary,
  LpCandidate,
  LpChecks,
  LpStats,
  SaveInput,
} from "./types";

const q = encodeURIComponent;

export const lp = {
  list: () => request<LandingSummary[]>("GET", "/v1/lp"),
  compose: (body: ComposeInput) => request<LandingDraft>("POST", "/v1/lp/compose", body),
  get: (id: string) => request<LandingDraft>("GET", `/v1/lp/${q(id)}`),
  save: (id: string, body: SaveInput) => request<LandingDraft>("PUT", `/v1/lp/${q(id)}`, body),
  references: (id: string, term: string) =>
    request<{ results: LpCandidate[] }>("GET", `/v1/lp/${q(id)}/references?q=${q(term)}`),
  check: (id: string) => request<LpChecks>("POST", `/v1/lp/${q(id)}/check`, {}),
  submit: (id: string) => request<LandingDraft>("POST", `/v1/lp/${q(id)}/submit`, {}),
  publish: (id: string, utm?: Record<string, string>) =>
    request<{ url: string; expiresAt: string }>(
      "POST",
      `/v1/lp/${q(id)}/publish`,
      utm ? { utm } : {},
    ),
  unpublish: (id: string) => request<{ ok: boolean }>("POST", `/v1/lp/${q(id)}/unpublish`, {}),
  stats: (id: string) => request<LpStats>("GET", `/v1/lp/${q(id)}/stats`),
};
