import type {
  AccountCard,
  AccountDetail,
  ActionResult,
  ActivityEntry,
  AdminRole,
  AuditReceipt,
  Candidate,
  ContributeResult,
  ContributeTarget,
  GovernanceCard,
  GovernanceDetail,
  Lens,
  MapView,
  Me,
  NodeDetail,
  PersonalItem,
  SearchResult,
  ViewPlan,
} from "./types";

export const MOCK = import.meta.env.VITE_MOCK === "1";

const PERSONA_KEY = "secondary.persona";

export function getPersona(): string | null {
  try {
    return window.localStorage.getItem(PERSONA_KEY);
  } catch {
    return null;
  }
}

export function setPersona(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(PERSONA_KEY, id);
    else window.localStorage.removeItem(PERSONA_KEY);
  } catch {
    /* storage unavailable: persona stays default for this page load */
  }
}

export class ApiError extends Error {
  status: number;
  reason: string;
  /** The parsed error body, for flows that need more than the reason (for example sensitivity flags). */
  body: Record<string, unknown>;
  constructor(status: number, reason: string, body: Record<string, unknown> = {}) {
    super(reason);
    this.name = "ApiError";
    this.status = status;
    this.reason = reason;
    this.body = body;
  }
}

// The API answers `{error, reason?}`. Errors without a reason get plain wording here.
const ERROR_TEXT: Record<string, string> = {
  not_found: "Not found, or outside your view.",
  revision_conflict: "This changed since you opened it. Reload and review the new revision.",
  sensitivity_flags_pending: "Some spans are flagged. Acknowledge each one to continue.",
  user_validation_required: "Confirm what you are sharing, then send again.",
  seed_disabled: "Seeding is disabled.",
  audit_unavailable: "The audit service is not answering, so nothing was changed.",
  rate_limited: "Too many requests. Wait a moment.",
  not_supported: "Not available in this release.",
};

function reasonOf(status: number, data: unknown): string {
  if (data && typeof data === "object") {
    const d = data as { reason?: unknown; error?: unknown };
    if (typeof d.reason === "string" && d.reason) return d.reason;
    if (typeof d.error === "string") return ERROR_TEXT[d.error] ?? d.error.replace(/_/g, " ");
  }
  return `Request failed (${status})`;
}

type Method = "GET" | "POST";

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const persona = getPersona();
  if (MOCK) {
    // The dynamic import sits behind a build-time constant, so production builds without
    // VITE_MOCK=1 drop src/mock/ entirely.
    const { handle } = await import("./mock/index");
    return (await handle(method, path, body, persona)) as T;
  }
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (persona) headers["X-Demo-Persona"] = persona;
  const res = await fetch(path, {
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
    const body = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    throw new ApiError(res.status, reasonOf(res.status, data), body);
  }
  return data as T;
}

const q = encodeURIComponent;

export const api = {
  me: () => request<Me>("GET", "/v1/me"),
  map: (lens: Lens) => request<MapView>("GET", `/v1/map?lens=${lens}`),
  node: (id: string) => request<NodeDetail>("GET", `/v1/nodes/${q(id)}`),
  search: (term: string) => request<{ results: SearchResult[] }>("GET", `/v1/search?q=${q(term)}`),
  accounts: () => request<AccountCard[]>("GET", "/v1/accounts"),
  account: (id: string) => request<AccountDetail>("GET", `/v1/accounts/${q(id)}`),
  governances: () => request<GovernanceCard[]>("GET", "/v1/governances"),
  governance: (id: string) => request<GovernanceDetail>("GET", `/v1/governances/${q(id)}`),
  review: () => request<Candidate[]>("GET", "/v1/review"),
  activity: () => request<ActivityEntry[]>("GET", "/v1/activity"),
  /** `revision` is the integer the server compares against; it never comes from client state alone. */
  act: (body: {
    nodeId: string;
    action: string;
    revision?: number;
    payload?: Record<string, unknown>;
  }) => request<ActionResult>("POST", "/v1/actions", body),
  personalList: () => request<PersonalItem[]>("GET", "/v1/personal/items"),
  personalCreate: (item: { title: string; body: string; kind: string }) =>
    request<PersonalItem>("POST", "/v1/personal/items", item),
  contribute: (
    id: string,
    body: {
      targetScopeId: string;
      user_validated: { by: string; at: string; revision: number };
      acknowledged_flags: string[];
    },
  ) => request<ContributeResult>("POST", `/v1/personal/items/${q(id)}/contribute`, body),
  contributeTargets: () => request<ContributeTarget[]>("GET", "/v1/personal/targets"),
  plan: (body: { prompt?: string; nodeId?: string }) =>
    request<ViewPlan>("POST", "/v1/genui/plan", body),
  adminRoles: () => request<AdminRole[]>("GET", "/v1/admin/roles"),
  adminAudit: () => request<AuditReceipt[]>("GET", "/v1/admin/audit"),
};
