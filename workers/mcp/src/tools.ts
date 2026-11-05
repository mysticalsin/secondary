import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import { type CallToolResult, McpServer, requireScopes } from "@modelcontextprotocol/server";
import { z } from "zod";
import { ApiClient, type ApiResult, type Caller, q } from "./api-client.ts";
import { writeAudit } from "./audit.ts";
import type { Scope } from "./config.ts";
import { sanitizeViewPlan } from "./view/plan.ts";
import { resolveView } from "./view/resolve.ts";
import { viewToMarkdown } from "./view/text.ts";
import { VIEW_HTML, VIEW_URI } from "./view/ui.ts";

/** The contract's tool list, in full. B1 tools read or draft. None approves, deletes or changes membership. */
export const TOOL_NAMES = [
  "whoami",
  "search",
  "get_map",
  "get_node",
  "get_account",
  "list_review_queue",
  "personal_note_create",
  "contribute",
  "render_view",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/** Scopes each tool needs (all of them). Write tools also need the read baseline. */
export const TOOL_SCOPES: Record<ToolName, readonly [Scope, ...Scope[]]> = {
  whoami: ["secondary.read"],
  search: ["secondary.read"],
  get_map: ["secondary.read"],
  get_node: ["secondary.read"],
  get_account: ["secondary.read"],
  list_review_queue: ["secondary.read"],
  render_view: ["secondary.read"],
  personal_note_create: ["secondary.read", "secondary.personal.write"],
  contribute: ["secondary.read", "secondary.contribute"],
};

const MAX_TEXT = 60_000;
const nodeId = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9_.:-]{0,127}$/,
    "an id as returned by Secondary, for example c_bid:pricing-models",
  );
const lens = z.enum(["departments", "accounts", "topics", "governances"]);
const noInput = z.object({});

type Json = Record<string, unknown>;

interface Outcome {
  ok: true;
  text: string;
  structured?: Json;
  count: number;
}
type Failure = { ok: false; error: string; status: number };

const toText = (data: unknown): string => {
  const s = JSON.stringify(data, null, 1);
  return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}\n... truncated` : s;
};

const fail = (error: string, extra?: Json): CallToolResult => ({
  isError: true,
  content: [{ type: "text", text: JSON.stringify({ error, ...extra }) }],
  structuredContent: { error, ...extra },
});

function fromApi(r: ApiResult, count: (d: unknown) => number): Outcome | Failure {
  if (!r.ok) return { ok: false, error: r.error, status: r.status };
  return {
    ok: true,
    text: toText(r.data),
    structured: { result: r.data } as Json,
    count: count(r.data),
  };
}

const len = (key: string) => (d: unknown) => {
  const v = (d as Json | null)?.[key];
  return Array.isArray(v) ? v.length : 0;
};

export interface ServerDeps {
  env: Env;
  caller: Caller;
}

export function buildServer({ env, caller }: ServerDeps): McpServer {
  const server = new McpServer(
    { name: "secondary", version: "0.1.0" },
    {
      instructions:
        "Secondary is Mantu's governed knowledge map. Every answer is limited to what the signed-in user's role allows. " +
        "Tools read or draft only. Ask the user before calling personal_note_create or contribute, and never include personal " +
        "or client-confidential details they have not confirmed. To show a visual, plan a view from the catalog " +
        "(KpiRow, NodeCard, ItemList, AccountSummary, StageBoard, MapMini, Callout, Table) and call render_view; props are queries (ids, lens, filters), never data.",
    },
  );

  /** Scope check, execution, audit receipt, result shaping. Audit failure fails closed. */
  async function run(
    tool: ToolName,
    ids: string[],
    exec: (api: ApiClient) => Promise<Outcome | Failure>,
  ): Promise<CallToolResult> {
    const base = {
      kind: "mcp.tool_call" as const,
      action: tool,
      who: caller.sub,
      client_id: caller.clientId,
      oauth_scopes: caller.scopes,
    };
    const required = TOOL_SCOPES[tool];
    if (!required.every((s) => caller.scopes.includes(s))) {
      await writeAudit(env, {
        ...base,
        scope_ids: ids,
        outcome: "denied",
        reason: "insufficient_scope",
        result_count: 0,
      });
      return fail("insufficient_scope", { required_scopes: [...required] });
    }
    const out = await exec(new ApiClient(env, caller, tool));
    if (!out.ok) {
      const denied = out.status === 403 || out.status === 404;
      const audited = await writeAudit(env, {
        ...base,
        scope_ids: ids,
        outcome: denied ? "denied" : "error",
        reason: out.error.slice(0, 80),
        result_count: 0,
      });
      return fail(audited ? out.error : "audit_unavailable");
    }
    const audited = await writeAudit(env, {
      ...base,
      scope_ids: ids,
      outcome: "ok",
      result_count: out.count,
    });
    if (!audited) return fail("audit_unavailable");
    return {
      content: [{ type: "text", text: out.text }],
      ...(out.structured ? { structuredContent: out.structured } : {}),
    };
  }

  const read = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  } as const;
  const draft = {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  } as const;
  const challenge = (t: ToolName) => requireScopes(...TOOL_SCOPES[t]);

  server.registerTool(
    "whoami",
    {
      title: "Who am I",
      description:
        "Show the signed-in user, their role, and what they can see, do and never do in Secondary.",
      inputSchema: noInput,
      annotations: read,
      scopeChallenge: challenge("whoami"),
    },
    () => run("whoami", [], async (api) => fromApi(await api.get("/v1/me"), () => 1)),
  );

  server.registerTool(
    "search",
    {
      title: "Search Secondary",
      description: "Search nodes the user may see. Returns ids, labels, kinds and planes only.",
      inputSchema: z.object({ q: z.string().trim().min(1).max(200).describe("Search text") }),
      annotations: read,
      scopeChallenge: challenge("search"),
    },
    ({ q: text }) =>
      run("search", [], async (api) =>
        fromApi(await api.get(`/v1/search?q=${q(text)}`), len("results")),
      ),
  );

  server.registerTool(
    "get_map",
    {
      title: "Get the Company Map",
      description:
        "The Company Map through one lens, limited to what the user may see. Locked areas show structure only.",
      inputSchema: z.object({ lens: lens.default("departments") }),
      annotations: read,
      scopeChallenge: challenge("get_map"),
    },
    ({ lens: l }) =>
      run("get_map", [], async (api) =>
        fromApi(await api.get(`/v1/map?lens=${q(l)}`), len("hubs")),
      ),
  );

  server.registerTool(
    "get_node",
    {
      title: "Get a node",
      description: "One node: facts, items, backlinks and which actions the user may take on it.",
      inputSchema: z.object({ id: nodeId }),
      annotations: read,
      scopeChallenge: challenge("get_node"),
    },
    ({ id }) =>
      run("get_node", [id], async (api) =>
        fromApi(await api.get(`/v1/nodes/${q(id)}`), len("items")),
      ),
  );

  server.registerTool(
    "get_account",
    {
      title: "Get an account workspace",
      description: "An account workspace the user is admitted to, by section.",
      inputSchema: z.object({ id: nodeId }),
      annotations: read,
      scopeChallenge: challenge("get_account"),
    },
    ({ id }) =>
      run("get_account", [id], async (api) =>
        fromApi(await api.get(`/v1/accounts/${q(id)}`), len("sections")),
      ),
  );

  server.registerTool(
    "list_review_queue",
    {
      title: "List the review queue",
      description:
        "Candidates waiting in the user's review scope. Read only: reviewing is done in the web app.",
      inputSchema: noInput,
      annotations: read,
      scopeChallenge: challenge("list_review_queue"),
    },
    () =>
      run("list_review_queue", [], async (api) => {
        const r = await api.get("/v1/review");
        return fromApi(r, (d) =>
          Array.isArray(d) ? d.length : len("candidates")(d) || len("items")(d),
        );
      }),
  );

  server.registerTool(
    "personal_note_create",
    {
      title: "Save a personal note",
      description:
        "Save a note to the user's private Personal Brain. Only the owner can see it. Ask the user to confirm the text first.",
      inputSchema: z.object({
        title: z.string().trim().min(1).max(200),
        body: z.string().trim().min(1).max(20_000),
      }),
      annotations: draft,
      scopeChallenge: challenge("personal_note_create"),
    },
    ({ title, body }) =>
      run("personal_note_create", [], async (api) =>
        fromApi(await api.post("/v1/personal/items", { kind: "note", title, body }), () => 1),
      ),
  );

  server.registerTool(
    "contribute",
    {
      title: "Contribute a personal item",
      description:
        "Propose one of the user's personal items to a Company scope. This creates a candidate that enters review. It never publishes, and the personal original stays private.",
      inputSchema: z.object({ personalItemId: nodeId, targetScopeId: nodeId }),
      annotations: draft,
      scopeChallenge: challenge("contribute"),
    },
    ({ personalItemId, targetScopeId }) =>
      run("contribute", [targetScopeId], async (api) =>
        fromApi(
          await api.post(`/v1/personal/items/${q(personalItemId)}/contribute`, { targetScopeId }),
          () => 1,
        ),
      ),
  );

  const renderView = registerAppTool(
    server,
    "render_view",
    {
      title: "Render a view",
      description:
        "Render a ViewPlan as a visual. You plan, the server resolves data as the user. A plan is {version:1,title,components:[{type,props}]} " +
        "with type one of KpiRow, NodeCard, ItemList, AccountSummary, StageBoard, MapMini, Callout, Table. " +
        "props hold queries only (nodeId, accountId, lens, filter, metrics, columns, limit), never data or text. Unknown component types are dropped. " +
        "Data props are rejected. A plan cannot show more than the user may see.",
      inputSchema: z.object({
        viewPlan: z.object({
          version: z.literal(1),
          title: z.string().min(1).max(120),
          components: z
            .array(z.object({ type: z.string(), props: z.record(z.string(), z.unknown()) }))
            .min(1)
            .max(24),
        }),
      }),
      annotations: read,
      _meta: { ui: { resourceUri: VIEW_URI, visibility: ["model", "app"] } },
    },
    ({ viewPlan }) => {
      const ids: string[] = [];
      return run("render_view", ids, async (api) => {
        const plan = sanitizeViewPlan(viewPlan);
        if (!plan.ok) {
          return {
            ok: false,
            status: 400,
            error: `invalid_view_plan: ${plan.errors.join("; ")}`.slice(0, 600),
          };
        }
        const view = await resolveView(plan.plan, api, plan.dropped);
        ids.push(...view.ids);
        return {
          ok: true,
          text: viewToMarkdown(view),
          structured: { view } as unknown as Json,
          count: view.components.filter((c) => c.status === "ok").length,
        };
      });
    },
  );

  // registerAppTool's config type has no scopeChallenge, the registered tool does.
  renderView.update({ scopeChallenge: challenge("render_view") });

  registerAppResource(
    server,
    "Secondary view",
    VIEW_URI,
    {
      description:
        "Renders a Secondary ViewPlan with trusted components. No external scripts or network.",
    },
    async () => ({
      contents: [
        {
          uri: VIEW_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: VIEW_HTML,
          _meta: { ui: { csp: {}, prefersBorder: false } },
        },
      ],
    }),
  );

  return server;
}
