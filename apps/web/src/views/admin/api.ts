// Client for /v1/admin/* (the governance console). Same rules as ../../api.ts: the server decides,
// and every refusal carries a reason that the console shows as it came.

import { useEffect, useState } from "react";
import { ApiError, getPersona, MOCK } from "../../api";
import type { Action, AdminGrant as Grant } from "../../types";

export interface Elig {
  roleId: string;
  actions: string[];
  maxHours: number;
  needsApproval: boolean;
}
export interface Caps {
  principalId: string;
  configure: boolean;
  steward: boolean;
  auditor: boolean;
  elevation: Elig | null;
}
export interface GovRole {
  id: string;
  label: string;
  summary: string;
  grants: Grant[];
  exclusions: string[];
  never: string[];
  elevation?: { actions: string[]; hours: number; approval?: boolean };
  version: number;
  sensitive: boolean;
  members: number;
}
export interface RoleVersion {
  version: number;
  at: number;
  proposedBy: string;
  approvedBy: string | null;
  role: GovRole;
}
export interface Change {
  id: string;
  kind: "role_upsert" | "member_add" | "member_remove" | "nda_grant" | "nda_revoke";
  status: "pending" | "applied" | "rejected" | "withdrawn" | "expired";
  title: string;
  payload: Record<string, unknown>;
  scopeKey: string;
  needsSecond: boolean;
  proposedBy: string;
  proposedByEmail: string | null;
  proposedAt: number;
  expiresAt: number;
  decidedBy: string | null;
  decidedAt: number | null;
  note: string | null;
  targetEmail: string | null;
  canDecide: boolean;
  canWithdraw: boolean;
}
export interface Person {
  id: string;
  email: string;
  roleIds: string[];
}
export interface ScopeOption {
  key: string;
  type: "circle" | "department" | "account";
  id: string;
  label: string;
  subspace: string | null;
  restricted: boolean;
  nda: boolean;
  authority: "admin" | "steward" | null;
}
export interface Member {
  principalId: string;
  email: string;
}
export interface NdaGrant {
  principalId: string;
  email: string;
  accountId: string;
  reason: string | null;
  expiresAt: number | null;
  grantedBy: string | null;
  approvedBy: string | null;
  active: boolean;
}
export interface Elevation {
  id: string;
  principalId: string;
  email: string | null;
  hours: number;
  reason: string;
  status: "pending" | "active" | "denied" | "ended" | "expired";
  requestedAt: number;
  until: number | null;
  note: string | null;
  canDecide: boolean;
  canEnd: boolean;
}
export interface ElevationState {
  eligible: Elig | null;
  active: { id: string; reason: string; until: number; secondsLeft: number } | null;
  pending: { id: string; hours: number; reason: string } | null;
}
export interface AccessReq {
  id: string;
  principalId: string;
  requesterEmail: string | null;
  nodeId: string;
  scopeLabel: string;
  scopeKey: string;
  reason: string;
  status: "pending" | "approved" | "granted" | "denied";
  createdAt: number;
  note: string | null;
  canDecide: boolean;
}
export interface Notice {
  id: number;
  kind: string;
  title: string;
  ref: string | null;
  at: number;
  read: boolean;
}
export interface AuditRow {
  id: string;
  at: string;
  actor: string;
  action: string;
  scope: string;
  result: string;
  reason: string;
}
export interface Saved {
  ok: true;
  applied?: boolean;
  change?: Change;
}

type Method = "GET" | "POST" | "PUT";

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  if (MOCK)
    throw new ApiError(
      501,
      "The admin console needs the live API. It is not part of the mock data.",
    );
  const headers: Record<string, string> = { Accept: "application/json" };
  const persona = getPersona();
  if (persona) headers["X-Demo-Persona"] = persona;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`/v1/admin${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const d = (data && typeof data === "object" ? data : {}) as {
      reason?: string;
      error?: string;
    };
    // The server's own reason, as written. Plain wording only when it sent none.
    throw new ApiError(
      res.status,
      d.reason || (d.error ? d.error.replace(/_/g, " ") : `Request failed (${res.status})`),
      d as Record<string, unknown>,
    );
  }
  return data as T;
}

const q = encodeURIComponent;
const qs = (o: Record<string, string | undefined>): string => {
  const p = Object.entries(o).filter(([, v]) => v);
  return p.length ? `?${p.map(([k, v]) => `${k}=${q(v as string)}`).join("&")}` : "";
};

export const adm = {
  caps: () => request<Caps>("GET", "/caps"),
  roles: () => request<GovRole[]>("GET", "/roles"),
  roleHistory: (id: string) => request<RoleVersion[]>("GET", `/roles/${q(id)}/history`),
  saveRole: (id: string | null, body: Record<string, unknown>) =>
    id ? request<Saved>("PUT", `/roles/${q(id)}`, body) : request<Saved>("POST", "/roles", body),
  changes: (status?: string) => request<Change[]>("GET", `/changes${qs({ status })}`),
  approveChange: (id: string) => request<Saved>("POST", `/changes/${q(id)}/approve`, {}),
  rejectChange: (id: string, note: string) =>
    request<Saved>("POST", `/changes/${q(id)}/reject`, { note }),
  withdrawChange: (id: string) => request<Saved>("POST", `/changes/${q(id)}/withdraw`, {}),
  principals: () => request<Person[]>("GET", "/principals"),
  scopes: () => request<ScopeOption[]>("GET", "/scopes"),
  members: (type: string, id: string, subspace: string | null) =>
    request<{ scope: { label: string; restricted: boolean }; members: Member[] }>(
      "GET",
      `/memberships${qs({ type, id, subspace: subspace ?? undefined })}`,
    ),
  member: (body: {
    op: "add" | "remove";
    principalId: string;
    scope_type: string;
    scope_id: string;
    subspace?: string | null;
  }) => request<Saved>("POST", "/memberships", body),
  nda: () =>
    request<{ accounts: { id: string; label: string }[]; grants: NdaGrant[] }>("GET", "/nda"),
  ndaGrant: (body: { principalId: string; accountId: string; reason: string; expiresAt: string }) =>
    request<Saved>("POST", "/nda", body),
  ndaRevoke: (body: { principalId: string; accountId: string }) =>
    request<Saved>("POST", "/nda/revoke", body),
  elevation: () => request<ElevationState>("GET", "/elevation"),
  elevations: () => request<Elevation[]>("GET", "/elevations"),
  requestElevation: (body: { hours: number; reason: string }) =>
    request<unknown>("POST", "/elevations", body),
  decideElevation: (id: string, verb: "approve" | "deny", note: string) =>
    request<unknown>("POST", `/elevations/${q(id)}/${verb}`, { note }),
  endElevation: (id: string) => request<unknown>("POST", `/elevations/${q(id)}/end`, {}),
  requestAccess: (nodeId: string, reason: string) =>
    request<unknown>("POST", "/access-requests", { nodeId, reason }),
  accessRequests: (view: "mine" | "queue") =>
    request<AccessReq[]>("GET", `/access-requests${qs({ view })}`),
  approveRequest: (id: string) =>
    request<{ applied?: boolean }>("POST", `/access-requests/${q(id)}/approve`, {}),
  denyRequest: (id: string, note: string) =>
    request<unknown>("POST", `/access-requests/${q(id)}/deny`, { note }),
  notifications: () => request<{ unread: number; items: Notice[] }>("GET", "/notifications"),
  markRead: (ids?: number[]) =>
    request<{ unread: number }>("POST", "/notifications/read", ids ? { ids } : {}),
  audit: (f: { principal?: string; action?: string; from?: string; to?: string }) =>
    request<AuditRow[]>("GET", `/audit${qs(f)}`),
};

export const ALL_ACTIONS: Action[] = [
  "view_structure",
  "view_content",
  "comment",
  "contribute",
  "edit",
  "review",
  "approve_release",
  "manage_members",
  "configure",
  "request_access",
];

/** What the rail and banners may show for this person. The server re-checks every action. */
export function useAdminCaps(): Caps | null {
  const [caps, setCaps] = useState<Caps | null>(null);
  useEffect(() => {
    let live = true;
    adm.caps().then(
      (c) => live && setCaps(c),
      () => live && setCaps(null),
    );
    return () => {
      live = false;
    };
  }, []);
  return caps;
}
