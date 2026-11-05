import { env } from "cloudflare:workers";
import { GraphClient } from "../src/graph.ts";
import { stateStub } from "../src/state.ts";
import type { ApiItem, ApiSink, SourceDef, Store } from "../src/types.ts";

export const DRIVE = "b!drive1";
export const DELTA = `https://graph.microsoft.com/v1.0/drives/${DRIVE}/root/delta?$top=200`;
const base = "https://graph.microsoft.com/v1.0";
export const link = (rest: string) => `${base}/drives/${DRIVE}/${rest}`;

let n = 0;
/** A fresh tenant per test, so Durable Object state never leaks between tests. */
export const freshTenant = () => `tenant_t${++n}x${Math.floor(Math.random() * 1e6)}`;
export const storeOf = (tenant: string) => stateStub(env, tenant) as unknown as Store;

export const sourceDef = (over: Partial<SourceDef> = {}): SourceDef => ({
  id: "srcbid01",
  provider: "sharepoint_drive",
  siteId: null,
  driveId: DRIVE,
  folderPath: "",
  scope: {
    kind: "circle",
    scopeId: "c_bid",
    gateNodeId: "c_bid",
    plane: "TEAM_RESTRICTED",
    classification: "internal_confidential",
    ownerRef: "owner_bid_circle",
  },
  enabled: true,
  createdAt: 1,
  ...over,
});

type Factory = () => Response | Promise<Response>;

/** A recorded Graph: scripted answers per URL (the last one repeats), plus the log of every request. */
export function graphMock() {
  const script = new Map<string, Factory[]>();
  const log: string[] = [];
  const auth: (string | null)[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    log.push(url);
    if (url.startsWith("https://login.microsoftonline.com/"))
      return Response.json({ access_token: "tok", expires_in: 3600 });
    auth.push(new Headers(init?.headers).get("Authorization"));
    const q = script.get(url);
    if (!q?.length) return new Response("unexpected", { status: 599 });
    const f = q.length > 1 ? (q.shift() as Factory) : (q[0] as Factory);
    return f();
  };
  const on = (url: string, ...rs: (Response | Factory | unknown)[]) => {
    script.set(
      url,
      rs.map((r) =>
        r instanceof Response
          ? () => r.clone()
          : typeof r === "function"
            ? (r as Factory)
            : () => Response.json(r),
      ),
    );
  };
  const sleeps: number[] = [];
  const graph = new GraphClient({
    tenantId: "contoso.example.invalid",
    clientId: "00000000-0000-0000-0000-000000000001",
    clientSecret: "test-secret-not-real",
    fetch: fetchFn,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return {
    graph,
    on,
    log,
    sleeps,
    auth,
    downloads: () => log.filter((u) => u.includes("download.example.invalid")),
  };
}

/** An in-memory stand-in for workers/api: keeps what the connector wrote so tests can assert on it. */
export function fakeWorkspace() {
  const items = new Map<string, ApiItem>();
  const calls: string[] = [];
  const state = { fail: false };
  const sink: ApiSink = {
    async upsert(_t, _s, rows) {
      calls.push("upsert");
      if (state.fail) throw new Error("api_503");
      for (const r of rows) items.set(r.id, r);
    },
    async remove(_t, _s, ids) {
      calls.push("remove");
      if (state.fail) throw new Error("api_503");
      for (const id of ids) items.delete(id);
    },
    async purge(_t, s) {
      calls.push("purge");
      for (const [k] of items) if (k.startsWith(`src:${s.id}:`)) items.delete(k);
    },
  };
  return { sink, items, calls, state };
}

export const file = (
  id: string,
  name: string,
  eTag: string,
  over: Record<string, unknown> = {},
) => ({
  id,
  name,
  size: 24,
  eTag,
  cTag: `c-${eTag}`,
  webUrl: `https://contoso.example.invalid/sites/bid/${name}`,
  file: { mimeType: name.endsWith(".md") ? "text/markdown" : "application/octet-stream" },
  parentReference: { id: "folder-root", path: `/drives/${DRIVE}/root:/Docs` },
  "@microsoft.graph.downloadUrl": `https://download.example.invalid/${id}`,
  ...over,
});
export const deleted = (id: string) => ({ id, deleted: { state: "deleted" } });
export const folder = (id: string, parent = "root-id", path = `/drives/${DRIVE}/root:`) => ({
  id,
  name: `f-${id}`,
  folder: { childCount: 1 },
  eTag: `fe-${id}`,
  parentReference: { id: parent, path },
});
export const page = (value: unknown[], opts: { next?: string; delta?: string }) => ({
  value,
  ...(opts.next ? { "@odata.nextLink": opts.next } : {}),
  ...(opts.delta ? { "@odata.deltaLink": opts.delta } : {}),
});
export const text = (s: string) => () =>
  new Response(new TextEncoder().encode(s), {
    headers: { "Content-Length": String(new TextEncoder().encode(s).length) },
  });
