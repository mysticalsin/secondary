import { getLang, type Key, translate } from "./i18n";
import type {
  AccountCard,
  AccountDetail,
  AccountRec,
  AccountRecords,
  ActionResult,
  ActivityEntry,
  AdminRole,
  AttentionItem,
  AuditReceipt,
  Candidate,
  ContributeResult,
  ContributeTarget,
  ContributionStatus,
  Draft,
  GovernanceCard,
  GovernanceDetail,
  Lens,
  MapView,
  Me,
  NodeDetail,
  PersonalItem,
  Prefs,
  RecordSection,
  ReviewDetail,
  RevisionRow,
  SearchResult,
  SourceRecordView,
  ViewPlan,
} from "./types";
import type { AiStatus, Brief, BriefRequest, BriefResponse } from "./views/brief/types";

export const MOCK = import.meta.env.VITE_MOCK === "1";

const PERSONA_KEY = "secondary.persona";

// The persona picker opens on the first persona (CEO), so send that until the viewer picks another.
// The API ignores this header outside ENVIRONMENT=dev.
const DEFAULT_PERSONA = "ceo";

export function getPersona(): string | null {
  try {
    return window.localStorage.getItem(PERSONA_KEY) ?? DEFAULT_PERSONA;
  } catch {
    return DEFAULT_PERSONA;
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

// The API answers `{error, reason?}`. Errors without a reason get plain wording in the viewer's language.
const ERROR_KEY: Record<string, Key> = {
  not_found: "err.not_found",
  revision_conflict: "err.revision_conflict",
  sensitivity_flags_pending: "err.sensitivity_flags_pending",
  user_validation_required: "err.user_validation_required",
  seed_disabled: "err.seed_disabled",
  audit_unavailable: "err.audit_unavailable",
  rate_limited: "err.rate_limited",
  not_supported: "err.not_supported",
  customer_permission_required: "err.customer_permission_required",
  permission_reference_required: "err.permission_reference_required",
};

function reasonOf(status: number, data: unknown): string {
  if (data && typeof data === "object") {
    const d = data as { reason?: unknown; error?: unknown };
    if (typeof d.reason === "string" && d.reason) return d.reason;
    if (typeof d.error === "string") {
      const k = ERROR_KEY[d.error];
      return k ? translate(getLang(), k) : d.error.replace(/_/g, " ");
    }
  }
  return translate(getLang(), "err.failed", { status });
}

export type Method = "GET" | "POST" | "PUT" | "DELETE";

export async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
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
  source: (id: string) => request<SourceRecordView>("GET", `/v1/sources/${q(id)}`),
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
  aiStatus: () => request<AiStatus>("GET", "/v1/ai/status"),
  brief: (body: BriefRequest) => request<BriefResponse>("POST", "/v1/briefs", body),
  saveBrief: (brief: Brief) =>
    request<{ saved: { id: string; revision: number } }>("POST", "/v1/briefs/save", { brief }),
  // Personal Brain, B2
  personalUpdate: (
    id: string,
    body: { revision: number; title?: string; body?: string; kind?: string; tags?: string[] },
  ) =>
    request<{ ok: boolean; revision: number; updatedAt: string }>(
      "PUT",
      `/v1/personal/items/${q(id)}`,
      body,
    ),
  personalDelete: (id: string) =>
    request<{ ok: boolean; copiesLeftInReview: number }>("DELETE", `/v1/personal/items/${q(id)}`),
  personalHistory: (id: string) =>
    request<RevisionRow[]>("GET", `/v1/personal/items/${q(id)}/history`),
  personalRestore: (id: string, revision: number, fromRevision: number) =>
    request<{ ok: boolean; revision: number }>("POST", `/v1/personal/items/${q(id)}/restore`, {
      revision,
      fromRevision,
    }),
  personalContributions: (id: string) =>
    request<ContributionStatus[]>("GET", `/v1/personal/items/${q(id)}/contributions`),
  drafts: () => request<Draft[]>("GET", "/v1/ux/drafts"),
  saveDraft: (
    key: string,
    body: { title: string; body: string; kind: string; baseRevision: number },
  ) => request<{ ok: boolean; at: string }>("PUT", `/v1/ux/drafts/${q(key)}`, body),
  dropDraft: (key: string) => request<{ ok: boolean }>("DELETE", `/v1/ux/drafts/${q(key)}`),
  prefs: () => request<Prefs>("GET", "/v1/ux/prefs"),
  savePrefs: (p: Partial<Prefs>) => request<Prefs>("PUT", "/v1/ux/prefs", p),
  // Review, B2
  reviewDetail: (id: string) => request<ReviewDetail>("GET", `/v1/ux/review/${q(id)}`),
  reviewComment: (id: string, text: string) =>
    request<{ ok: boolean }>("POST", `/v1/ux/review/${q(id)}/comments`, { text }),
  reviewDecide: (
    id: string,
    body: { revision: number; verdict: "changes_requested" | "accept"; comment?: string },
  ) => request<{ ok: boolean }>("POST", `/v1/ux/review/${q(id)}/decision`, body),
  // Account records, B2
  records: (accountId: string) =>
    request<AccountRecords>("GET", `/v1/ux/accounts/${q(accountId)}/records`),
  recordCreate: (
    accountId: string,
    body: {
      section: RecordSection;
      title: string;
      note?: string;
      ownerRole?: string;
      due?: string | null;
      status?: string;
      story?: { internal: string; lesson: string; external: string };
    },
  ) => request<AccountRec>("POST", `/v1/ux/accounts/${q(accountId)}/records`, body),
  recordUpdate: (
    accountId: string,
    id: string,
    body: {
      revision: number;
      title?: string;
      note?: string;
      ownerRole?: string;
      due?: string | null;
      status?: string;
      story?: { internal: string; lesson: string; external: string };
    },
  ) => request<AccountRec>("PUT", `/v1/ux/accounts/${q(accountId)}/records/${q(id)}`, body),
  recordPermission: (
    accountId: string,
    id: string,
    body: { revision: number; granted: boolean; reference?: string },
  ) =>
    request<AccountRec>(
      "POST",
      `/v1/ux/accounts/${q(accountId)}/records/${q(id)}/permission`,
      body,
    ),
  attention: () => request<{ items: AttentionItem[] }>("GET", "/v1/ux/attention"),
  adminRoles: () => request<AdminRole[]>("GET", "/v1/admin/roles"),
  adminAudit: () => request<AuditReceipt[]>("GET", "/v1/admin/audit"),
};
