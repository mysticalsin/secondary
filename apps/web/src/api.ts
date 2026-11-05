import type {
  AccountCard,
  AccountDetail,
  ActionResult,
  ActivityEntry,
  AdminRole,
  AuditReceipt,
  Candidate,
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
  constructor(status: number, reason: string) {
    super(reason);
    this.name = "ApiError";
    this.status = status;
    this.reason = reason;
  }
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
    const reason =
      data && typeof data === "object" && "reason" in data
        ? String((data as { reason: unknown }).reason)
        : `Request failed (${res.status})`;
    throw new ApiError(res.status, reason);
  }
  return data as T;
}

const q = encodeURIComponent;

export const api = {
  me: () => request<Me>("GET", "/v1/me"),
  map: (lens: Lens) => request<MapView>("GET", `/v1/map?lens=${lens}`),
  node: (id: string) => request<NodeDetail>("GET", `/v1/nodes/${q(id)}`),
  search: (term: string) => request<{ results: SearchResult[] }>("GET", `/v1/search?q=${q(term)}`),
  accounts: () => request<{ accounts: AccountCard[] }>("GET", "/v1/accounts"),
  account: (id: string) => request<AccountDetail>("GET", `/v1/accounts/${q(id)}`),
  governances: () => request<{ governances: GovernanceCard[] }>("GET", "/v1/governances"),
  governance: (id: string) => request<GovernanceDetail>("GET", `/v1/governances/${q(id)}`),
  review: () => request<{ candidates: Candidate[] }>("GET", "/v1/review"),
  activity: () => request<{ entries: ActivityEntry[] }>("GET", "/v1/activity"),
  act: (body: {
    nodeId: string;
    action: string;
    revision?: string;
    payload?: Record<string, unknown>;
  }) => request<ActionResult>("POST", "/v1/actions", body),
  personalList: () => request<{ items: PersonalItem[] }>("GET", "/v1/personal/items"),
  personalSave: (item: { id?: string; title: string; body: string; kind: string }) =>
    request<{ item: PersonalItem }>("POST", "/v1/personal/items", item),
  contribute: (id: string, targetScopeId: string) =>
    request<{ ok: boolean; candidateId: string; receiptId: string }>(
      "POST",
      `/v1/personal/items/${q(id)}/contribute`,
      { targetScopeId },
    ),
  contributeTargets: async (): Promise<ContributeTarget[]> => {
    const view = await request<MapView>("GET", "/v1/map?lens=departments");
    return view.hubs
      .filter((h) => h.access !== "locked")
      .flatMap((h) =>
        h.children
          .filter((c) => c.access !== "locked")
          .map((c) => ({ id: c.id, label: c.label, group: h.label })),
      );
  },
  plan: (body: { prompt?: string; nodeId?: string }) =>
    request<ViewPlan>("POST", "/v1/genui/plan", body),
  adminRoles: () =>
    request<{ roles: AdminRole[]; structureOnly: boolean }>("GET", "/v1/admin/roles"),
  adminAudit: () => request<{ receipts: AuditReceipt[] }>("GET", "/v1/admin/audit"),
};
