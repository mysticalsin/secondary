import { getLang, type Key, translate } from "./i18n";
import type { ActivityEntry, Me, Prefs, SourceRecordView } from "./types";

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
  source: (id: string) => request<SourceRecordView>("GET", `/v1/sources/${q(id)}`),
  activity: () => request<ActivityEntry[]>("GET", "/v1/activity"),
  prefs: () => request<Prefs>("GET", "/v1/ux/prefs"),
  savePrefs: (p: Partial<Prefs>) => request<Prefs>("PUT", "/v1/ux/prefs", p),
};
