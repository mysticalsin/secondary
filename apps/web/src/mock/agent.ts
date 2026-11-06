// Dev mock for My Agent (docs/API-CONTRACT.md "v6 My Agent"). Synthetic data only.
//
//   POST /v1/agent/turn   a real streaming Response (ReadableStream of SSE chunks, the lines a few
//                         ms apart): meta (deterministic, reason ai_disabled), line..., usage, done.
//                         The answer is the contract's deterministic planner (planProgram) over the
//                         brains the persona may read. "dense" and "funnel" refinements edit the
//                         previous program, as the AI path would.
//   /v1/views (+share)    saved views CRUD, share, shared lookup. Stored in localStorage so a page
//                         reload keeps them. Every read runs lockTree against the viewing persona's
//                         readable brains, so a lower-privilege persona sees Locked cards.
//
// Not covered: the AI path, tokens (always 0), rate limits, receipts.
import {
  type AgentNode,
  type BrainRef,
  lockTree,
  planProgram,
  SavedViewInput,
  TurnRequest,
  viewOfProgram,
} from "@secondary/contracts/agent-ui";
import { ApiError } from "../api";
import { roleOf } from "./policy";
import { NOT_HANDLED } from "./uxv2";
import { v3Brains } from "./v3";

const STORE = "secondary.mock.agent.views";
const MAX_VIEWS = 50;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The brains this persona may read, as the planner and lockTree see them. */
function readable(role: string): BrainRef[] {
  return v3Brains
    .filter((b) => b.sees.includes(role))
    .map((b) => ({ id: b.id, name: b.id === "me" ? "My Secondary" : b.name, type: b.type }));
}

// ---------- turn ----------

const quote = (s: string) => JSON.stringify(s);

/** Edit the previous program for "make this denser" and "add the funnel". */
function refine(previous: string, text: string, brains: BrainRef[]): string | null {
  const lines = previous.split("\n").filter((l) => l.trim());
  const root = lines.find((l) => /^root\s*=\s*Stack\(\[/.test(l));
  if (!root) return null;
  const kids = (root.match(/\[(.*)\]/)?.[1] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const rest = lines.filter((l) => l !== root);
  if (/\b(dens|compact|serr)/i.test(text)) {
    return ["root = Stack([dense])", `dense = Grid([${kids.join(", ")}], 2)`, ...rest].join("\n");
  }
  if (/\b(funnel|entonnoir)/i.test(text)) {
    const brain = (previous.match(/(?:Funnel|Beeswarm|DotConstellation|FitBars)\("([^"]+)"/)?.[1] ??
      brains[0]?.id) as string | undefined;
    if (!brain) return null;
    return [
      `root = Stack([${[...kids, "cx"].join(", ")}])`,
      ...rest,
      `cx = InsightCard(${quote(/entonnoir/i.test(text) ? "Flux de connaissances" : "Knowledge flow")}, [fx])`,
      `fx = Funnel(${quote(brain)}, "30d")`,
    ].join("\n");
  }
  return null;
}

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

export async function agentTurnResponse(
  body: unknown,
  persona: string | null,
  signal?: AbortSignal,
): Promise<Response> {
  await wait(30);
  const parsed = TurnRequest.safeParse(body);
  const json = (status: number, data: unknown) =>
    new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  if (!parsed.success || (!parsed.data.text && !parsed.data.action))
    return json(400, { error: "invalid_request" });
  const req = parsed.data;
  const brains = readable(roleOf(persona));
  const edited = req.previous && req.text ? refine(req.previous, req.text, brains) : null;
  const program =
    edited ??
    planProgram({
      ...(req.text ? { text: req.text } : {}),
      ...(req.action ? { action: { action: req.action.action, values: req.action.values } } : {}),
      brains,
      lang: req.lang ?? "en",
    }).program;
  const lines = program.split("\n").filter((l) => l.trim());
  const turnId = `t_${Math.random().toString(36).slice(2, 10)}`;
  const enc = new TextEncoder();
  let stopped = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(ctl) {
      const send = (s: string) => ctl.enqueue(enc.encode(s));
      const onAbort = () => {
        stopped = true;
        try {
          ctl.error(new DOMException("Aborted", "AbortError"));
        } catch {
          /* already closed */
        }
      };
      signal?.addEventListener("abort", onAbort);
      try {
        send(sse("meta", { turnId, mode: "deterministic", reason: "ai_disabled" }));
        for (const l of lines) {
          await wait(70);
          if (stopped) return;
          send(sse("line", { text: l }));
        }
        await wait(20);
        if (stopped) return;
        send(sse("usage", { inputTokens: 0, outputTokens: 0, model: null }));
        send(sse("done", { turnId, lines: lines.length }));
        ctl.close();
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }
    },
    cancel() {
      stopped = true;
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

// ---------- saved views ----------

interface Stored {
  id: string;
  owner: string;
  name: string;
  pin: "home" | { brain: string };
  layout?: { x: number; y: number; w: number; h: number };
  program: string;
  updatedAt: string;
  shareId?: string;
}

const read = (): Stored[] => {
  try {
    const v: unknown = JSON.parse(window.localStorage.getItem(STORE) ?? "[]");
    return Array.isArray(v) ? (v as Stored[]) : [];
  } catch {
    return [];
  }
};
const write = (all: Stored[]) => {
  try {
    window.localStorage.setItem(STORE, JSON.stringify(all));
  } catch {
    /* kept for this page load only */
  }
};

const treeFor = (program: string, role: string): AgentNode | null => {
  const ok = new Set(readable(role).map((b) => b.id));
  return lockTree(viewOfProgram(program).root, (id) => ok.has(id)).tree;
};

const wire = (v: Stored, role: string) => ({
  id: v.id,
  name: v.name,
  pin: v.pin,
  ...(v.layout ? { layout: v.layout } : {}),
  program: v.program,
  updatedAt: v.updatedAt,
  shared: !!v.shareId,
  tree: treeFor(v.program, role),
});

const notFound = () => new ApiError(404, "Not found.", { error: "not_found" });
const hash = (s: string) => {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h.toString(36);
};

export function handleAgentViews(
  method: string,
  p: string,
  search: URLSearchParams,
  body: Record<string, unknown>,
  role: string,
  persona: string | null,
): unknown {
  if (!p.startsWith("/v1/views")) return NOT_HANDLED;
  const me = persona ?? "ceo";
  const all = read();
  const mine = all.filter((v) => v.owner === me);

  if (p === "/v1/views" && method === "GET") {
    const pin = search.get("pin");
    const rows = mine.filter((v) =>
      !pin
        ? true
        : pin === "home"
          ? v.pin === "home"
          : typeof v.pin === "object" && v.pin.brain === pin,
    );
    return { views: rows.map((v) => wire(v, role)) };
  }
  if (p === "/v1/views" && method === "POST") {
    const r = SavedViewInput.safeParse(body);
    if (!r.success || !viewOfProgram(r.data.program).root)
      throw new ApiError(400, "Invalid view.", { error: "invalid_view" });
    if (mine.length >= MAX_VIEWS)
      throw new ApiError(409, "Too many views.", { error: "too_many_views" });
    const v: Stored = {
      id: `v_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      owner: me,
      name: r.data.name,
      pin: r.data.pin,
      ...(r.data.layout ? { layout: r.data.layout } : {}),
      program: r.data.program,
      updatedAt: new Date().toISOString(),
    };
    write([...all, v]);
    return wire(v, role);
  }
  const shared = p.match(/^\/v1\/views\/shared\/([^/]+)$/);
  if (shared && method === "GET") {
    const v = all.find((x) => x.shareId === decodeURIComponent(shared[1] as string));
    if (!v) throw notFound();
    return { name: v.name, tree: treeFor(v.program, role) };
  }
  const m = p.match(/^\/v1\/views\/([^/]+)(\/share)?$/);
  if (!m) return NOT_HANDLED;
  const id = decodeURIComponent(m[1] as string);
  const v = mine.find((x) => x.id === id);
  if (!v) throw notFound();
  const save = (next: Stored) => write(all.map((x) => (x.id === id ? next : x)));
  if (m[2]) {
    if (method === "POST") {
      const shareId =
        v.shareId ?? `s_${hash(v.id + v.owner)}${Math.random().toString(36).slice(2, 6)}`;
      save({ ...v, shareId });
      return { shareId, path: `/agent/shared/${shareId}` };
    }
    if (method === "DELETE") {
      const { shareId: _drop, ...rest } = v;
      save(rest);
      return null;
    }
    return NOT_HANDLED;
  }
  if (method === "GET") return wire(v, role);
  if (method === "DELETE") {
    write(all.filter((x) => x.id !== id));
    return null;
  }
  if (method === "PUT") {
    const merged = {
      name: v.name,
      program: v.program,
      pin: v.pin,
      ...(v.layout ? { layout: v.layout } : {}),
      ...body,
    };
    const r = SavedViewInput.safeParse(merged);
    if (!r.success || !viewOfProgram(r.data.program).root)
      throw new ApiError(400, "Invalid view.", { error: "invalid_view" });
    const next: Stored = {
      ...v,
      name: r.data.name,
      program: r.data.program,
      pin: r.data.pin,
      ...(r.data.layout ? { layout: r.data.layout } : {}),
      updatedAt: new Date().toISOString(),
    };
    save(next);
    return wire(next, role);
  }
  return NOT_HANDLED;
}
