import { ApiError, getPersona, MOCK, request } from "../api";
import { getLang, translate } from "../i18n";
import type {
  AskEvent,
  BrainRoot,
  Digest,
  Question,
  Routine,
  RoutineInput,
  RoutineRun,
  TreeNode,
  Usage,
} from "./types";

const q = encodeURIComponent;

export const ux2 = {
  tree: (root: BrainRoot) => request<{ roots: TreeNode[] }>("GET", `/v1/brain/tree?root=${root}`),
  /** Questions built from pages the caller can read, so each has an answer. */
  suggestions: () =>
    request<{ questions: { q: string; workspaceId: string; pageId: string }[] }>(
      "GET",
      "/v1/ask/suggestions",
    ),
  questions: () => request<Question[]>("GET", "/v1/questions"),
  answer: (id: string, body: { action: string; revisionHash?: string; note?: string }) =>
    request<{ ok: boolean }>("POST", `/v1/questions/${q(id)}`, body),
  routines: () => request<Routine[]>("GET", "/v1/routines"),
  createRoutine: (r: RoutineInput) => request<Routine>("POST", "/v1/routines", r),
  updateRoutine: (id: string, r: Routine) => request<Routine>("PUT", `/v1/routines/${q(id)}`, r),
  deleteRoutine: (id: string) => request<{ ok: boolean }>("DELETE", `/v1/routines/${q(id)}`),
  runRoutine: (id: string) => request<RoutineRun>("POST", `/v1/routines/${q(id)}/run`, {}),
  runs: (id: string) => request<RoutineRun[]>("GET", `/v1/routines/${q(id)}/runs`),
  usage: (period: "7d" | "30d") => request<Usage>("GET", `/v1/usage?period=${period}`),
  digest: () => request<Digest>("GET", "/v1/digest/preview"),
  digestDraft: () => request<{ draftId: string }>("POST", "/v1/digest/draft", {}),
};

/** Parse a Server-Sent Events body into events. Exported for tests. */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<AskEvent> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const take = (block: string): AskEvent | null => {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (!data.length && event !== "done") return null;
    try {
      return { event, data: data.length ? JSON.parse(data.join("\n")) : {} } as AskEvent;
    } catch {
      return null;
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let i = buf.indexOf("\n\n");
    while (i >= 0) {
      const ev = take(buf.slice(0, i));
      buf = buf.slice(i + 2);
      if (ev) yield ev;
      i = buf.indexOf("\n\n");
    }
    if (done) break;
  }
  if (buf.trim()) {
    const ev = take(buf);
    if (ev) yield ev;
  }
}

/** POST /v1/ask and yield its events as they arrive. Throws ApiError for a refusal before the stream. */
export async function* askStream(
  qtext: string,
  signal?: AbortSignal,
): AsyncGenerator<AskEvent, void, void> {
  if (MOCK) {
    const { mockAsk } = await import("../mock/uxv2");
    yield* mockAsk(qtext, getPersona(), signal);
    return;
  }
  const persona = getPersona();
  const res = await fetch("/v1/ask", {
    method: "POST",
    headers: {
      Accept: "text/event-stream",
      "Content-Type": "application/json",
      ...(persona ? { "X-Demo-Persona": persona } : {}),
    },
    body: JSON.stringify({ q: qtext }),
    credentials: "same-origin",
    signal,
  });
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { reason?: string; error?: string };
    throw new ApiError(
      res.status,
      data.reason ?? translate(getLang(), "err.failed", { status: res.status }),
    );
  }
  yield* parseSse(res.body);
}

/** Download the portable Markdown export of one workspace. */
export async function downloadExport(workspaceId: string): Promise<void> {
  let blob: Blob;
  if (MOCK) {
    blob = new Blob(
      [
        `Mock export for ${workspaceId}. The live API returns a zip of Markdown (index.md per folder).`,
      ],
      { type: "text/plain" },
    );
  } else {
    const persona = getPersona();
    const res = await fetch(`/v1/brain/export?workspaceId=${q(workspaceId)}`, {
      headers: persona ? { "X-Demo-Persona": persona } : {},
      credentials: "same-origin",
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { reason?: string };
      throw new ApiError(
        res.status,
        data.reason ?? translate(getLang(), "err.failed", { status: res.status }),
      );
    }
    blob = await res.blob();
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `brain-${workspaceId.replace(/[^a-z0-9_-]/gi, "_")}${MOCK ? ".txt" : ".zip"}`;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
