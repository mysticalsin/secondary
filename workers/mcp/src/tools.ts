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
  "wiki_search",
  "wiki_read",
  "wiki_propose",
  "lp_compose",
  "lp_compose_batch",
  "lp_list",
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
  wiki_search: ["secondary.read"],
  wiki_read: ["secondary.read"],
  wiki_propose: ["secondary.read", "secondary.contribute"],
  lp_compose: ["secondary.read", "secondary.contribute"],
  lp_compose_batch: ["secondary.read", "secondary.contribute"],
  lp_list: ["secondary.read"],
};

const MAX_TEXT = 60_000;
const nodeId = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9_.:-]{0,127}$/,
    "an id as returned by Secondary, for example c_bid:pricing-models",
  );
/** A wiki workspace: a node id as returned by Secondary, or `me` for the user's own wiki. */
const wikiWs = z
  .string()
  .regex(/^(me|[a-z0-9][a-z0-9_.:-]{0,127})$/, "an account, circle or department id, or me");
const wikiPage = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "a wiki page id as returned by wiki_search");
const lpRow = z.object({
  firstName: z.string().trim().max(60).optional(),
  role: z.string().trim().min(2).max(120),
  company: z.string().trim().min(2).max(120),
  angle: z.string().trim().min(2).max(300),
  brand: z.enum(["amaris", "mantu"]).optional(),
  lang: z.enum(["en", "fr"]).optional(),
});
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
        "Tools read or draft only. Ask the user before calling personal_note_create, contribute or wiki_propose, and never include personal " +
        "or client-confidential details they have not confirmed. wiki_search and wiki_read answer from the workspace wikis the user may read, with citations; " +
        "wiki_propose only queues a page for human review. To show a visual, plan a view from the catalog " +
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

  server.registerTool(
    "wiki_search",
    {
      title: "Search the workspace wikis",
      description:
        "Search the wiki pages the user may read, with the cited claims that match. Searches every wiki the user is admitted to unless a workspace is given. Citations the user cannot read are already removed.",
      inputSchema: z.object({
        q: z.string().trim().min(1).max(200).describe("Search text"),
        workspace: z.union([z.literal("all"), wikiWs]).default("all"),
      }),
      annotations: read,
      scopeChallenge: challenge("wiki_search"),
    },
    ({ q: text, workspace }) =>
      run("wiki_search", workspace === "all" ? [] : [workspace], async (api) =>
        fromApi(await api.get(`/v1/wiki/${q(workspace)}/search?q=${q(text)}`), len("results")),
      ),
  );

  server.registerTool(
    "wiki_read",
    {
      title: "Read a wiki page",
      description:
        "One wiki page with its citations, as the signed-in user may see it. Claims whose sources the user cannot read are removed.",
      inputSchema: z.object({ workspace: wikiWs, page: wikiPage }),
      annotations: read,
      scopeChallenge: challenge("wiki_read"),
    },
    ({ workspace, page }) =>
      run("wiki_read", [workspace], async (api) =>
        fromApi(await api.get(`/v1/wiki/${q(workspace)}/pages/${q(page)}`), () => 1),
      ),
  );

  server.registerTool(
    "wiki_propose",
    {
      title: "Propose a wiki page",
      description:
        "Propose a new page or a new version of a page in a workspace wiki. This creates a review item and never publishes: a person approves it in the web app. Ask the user to confirm the text first.",
      inputSchema: z.object({
        workspace: wikiWs,
        title: z.string().trim().min(1).max(120),
        markdown: z.string().trim().min(1).max(20_000),
        pageId: wikiPage.optional(),
      }),
      annotations: draft,
      scopeChallenge: challenge("wiki_propose"),
    },
    ({ workspace, title, markdown, pageId }) =>
      run("wiki_propose", [workspace], async (api) =>
        fromApi(
          await api.post(`/v1/wiki/${q(workspace)}/propose`, {
            title,
            markdown,
            ...(pageId ? { pageId } : {}),
          }),
          () => 1,
        ),
      ),
  );

  const composeBody = (row: z.infer<typeof lpRow>) => ({
    prospect: {
      role: row.role,
      company: row.company,
      ...(row.firstName ? { firstName: row.firstName } : {}),
    },
    angle: row.angle,
    ...(row.brand ? { brand: row.brand } : {}),
    ...(row.lang ? { lang: row.lang } : {}),
  });

  server.registerTool(
    "lp_compose",
    {
      title: "Compose a landing page draft",
      description:
        "Compose a personalised landing page draft for a prospect (role, company, angle) from what the user may read in the brain. It creates a DRAFT only: the user edits it, the checks run, a different reviewer approves it and the user publishes it in the web app. This tool cannot approve or publish.",
      inputSchema: lpRow,
      annotations: draft,
      scopeChallenge: challenge("lp_compose"),
    },
    (row) =>
      run("lp_compose", [], async (api) =>
        fromApi(await api.post("/v1/lp/compose", composeBody(row)), () => 1),
      ),
  );

  server.registerTool(
    "lp_compose_batch",
    {
      title: "Compose landing page drafts in a batch",
      description:
        "Compose drafts for several prospects, for example from a pasted CSV of role, company and angle (at most 20 rows). Every row becomes a DRAFT that still needs the checks and a reviewer's approval. Nothing is submitted, approved or published.",
      inputSchema: z.object({ rows: z.array(lpRow).min(1).max(20) }),
      annotations: draft,
      scopeChallenge: challenge("lp_compose_batch"),
    },
    ({ rows }) =>
      run("lp_compose_batch", [], async (api) => {
        const results: Json[] = [];
        for (const [i, row] of rows.entries()) {
          const r = await api.post("/v1/lp/compose", composeBody(row));
          results.push(
            r.ok
              ? { row: i + 1, ok: true, draft: r.data as Json }
              : { row: i + 1, ok: false, error: r.error },
          );
        }
        const made = results.filter((x) => x.ok === true).length;
        const data = { drafts: made, failed: results.length - made, results };
        return { ok: true, text: toText(data), structured: { result: data } as Json, count: made };
      }),
  );

  server.registerTool(
    "lp_list",
    {
      title: "List my landing pages",
      description: "The user's landing pages with their status and weekly counts. Read only.",
      inputSchema: noInput,
      annotations: read,
      scopeChallenge: challenge("lp_list"),
    },
    () =>
      run("lp_list", [], async (api) =>
        fromApi(await api.get("/v1/lp"), (d) => (Array.isArray(d) ? d.length : 0)),
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
