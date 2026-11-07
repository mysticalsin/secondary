// Calendar events for meeting briefs. DELEGATED ONLY. The app-only Calendars.Read permission reads every
// mailbox in the tenant, so it is never requested. This stays disabled (CALENDAR_ENABLED) until the Entra
// OIDC work issues delegated Graph tokens; the caller then passes the signed-in user's own token, which is
// used for one request and never stored or logged. The window is bounded and only the minimum fields are read.

import { GRAPH_BASE } from "./graph.ts";

export const MAX_WINDOW_DAYS = 14;
export const MAX_EVENTS = 50;

export interface CalendarEvent {
  id: string;
  subject: string | null;
  start: string | null;
  end: string | null;
  isCancelled: boolean;
}

export type CalendarResult =
  | { ok: true; events: CalendarEvent[]; from: string; to: string }
  | {
      ok: false;
      error: "calendar_disabled" | "delegated_token_required" | "invalid_window" | "graph_error";
    };

export async function meetingWindow(o: {
  enabled: boolean;
  delegatedToken: string | null;
  from: Date;
  to: Date;
  fetch?: typeof fetch;
}): Promise<CalendarResult> {
  if (!o.enabled) return { ok: false, error: "calendar_disabled" };
  if (!o.delegatedToken) return { ok: false, error: "delegated_token_required" };
  if (Number.isNaN(o.from.getTime()) || Number.isNaN(o.to.getTime()) || o.to <= o.from)
    return { ok: false, error: "invalid_window" };
  const to = new Date(Math.min(o.to.getTime(), o.from.getTime() + MAX_WINDOW_DAYS * 86_400_000));
  const q = new URLSearchParams({
    startDateTime: o.from.toISOString(),
    endDateTime: to.toISOString(),
    $select: "id,subject,start,end,isCancelled",
    $top: String(MAX_EVENTS),
    $orderby: "start/dateTime",
  });
  const f = o.fetch ?? ((i, init) => fetch(i, init));
  try {
    const res = await f(`${GRAPH_BASE}/me/calendarView?${q}`, {
      headers: { Authorization: `Bearer ${o.delegatedToken}`, Prefer: 'outlook.timezone="UTC"' },
    });
    if (!res.ok) return { ok: false, error: "graph_error" };
    const j = (await res.json()) as {
      value?: {
        id?: string;
        subject?: string;
        start?: { dateTime?: string };
        end?: { dateTime?: string };
        isCancelled?: boolean;
      }[];
    };
    const events = (j.value ?? []).slice(0, MAX_EVENTS).flatMap((e) =>
      e.id
        ? [
            {
              id: e.id,
              subject: e.subject ?? null,
              start: e.start?.dateTime ?? null,
              end: e.end?.dateTime ?? null,
              isCancelled: e.isCancelled === true,
            },
          ]
        : [],
    );
    return { ok: true, events, from: o.from.toISOString(), to: to.toISOString() };
  } catch {
    return { ok: false, error: "graph_error" };
  }
}
