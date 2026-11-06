import { ApiError, request } from "../api";
import type {
  HoldRow,
  IncidentState,
  PublishResult,
  RuleDetail,
  RuleDraft,
  RulesList,
  SimulationView,
  ValidationIssue,
} from "./types";

const q = encodeURIComponent;

export const rulesApi = {
  list: (brain?: string) =>
    request<RulesList>("GET", `/v1/rules${brain ? `?brain=${q(brain)}` : ""}`),
  get: (id: string) => request<RuleDetail>("GET", `/v1/rules/${q(id)}`),
  create: (d: RuleDraft) => request<RuleDetail>("POST", "/v1/rules", d),
  save: (id: string, d: RuleDraft) => request<RuleDetail>("PUT", `/v1/rules/${q(id)}`, d),
  remove: (id: string) => request<null>("DELETE", `/v1/rules/${q(id)}`),
  validate: (d: RuleDraft) =>
    request<{ ok: true; needsSecond: boolean }>("POST", "/v1/rules/validate", d),
  simulate: (rule: RuleDraft, days: 7 | 30) =>
    request<SimulationView>("POST", "/v1/rules/simulate", { rule, days }),
  publish: (id: string, expectedHash: string, status?: "monitor" | "enforced") =>
    request<PublishResult>("POST", `/v1/rules/${q(id)}/publish`, {
      expectedHash,
      ...(status ? { status } : {}),
    }),
  rollback: (id: string, toVersion: number) =>
    request<PublishResult>("POST", `/v1/rules/${q(id)}/rollback`, { toVersion }),
  incident: () => request<IncidentState>("GET", "/v1/rules/incident"),
  setIncident: (on: boolean, reason?: string) =>
    request<IncidentState>("PUT", "/v1/rules/incident", reason ? { on, reason } : { on }),
  holds: () => request<HoldRow[]>("GET", "/v1/rules/holds"),
  decideHold: (id: string, decision: "approve" | "reject") =>
    request<{ status: "pending" | "approved" | "rejected"; approvals: number; required: number }>(
      "POST",
      `/v1/rules/holds/${q(id)}/decide`,
      { decision },
    ),
};

/** The issues of a 422 rule_refused answer, or null for any other error. */
export function issuesOf(e: unknown): ValidationIssue[] | null {
  if (!(e instanceof ApiError) || e.status !== 422) return null;
  const list = e.body.issues;
  return Array.isArray(list) ? (list as ValidationIssue[]) : null;
}
