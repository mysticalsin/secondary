/**
 * NEW RECONSTRUCTION. Not a recovered route and not the delivered shell.
 *
 * The recovered API ViewPlan catalog (KpiRow, NodeCard, ItemList, AccountSummary,
 * StageBoard, MapMini, Callout, Table) is not the delivered renderer catalog
 * (KpiTile, DotConstellation, Beeswarm, Funnel, FitBars, TimelineBars,
 * ActivityGrid, PageList, PageCard, Table, Callout, Buttons). KpiRow is a query
 * row. KpiTile is one brain metric. This module does not rename one to the other.
 * Callout and Table share a name and still have different props, so a renderer
 * tree is not accepted as an API plan.
 *
 * Permission comes only from the server context argument. Query strings and
 * headers on the input object are ignored.
 */
import validatePlan from "../../recovered-source/worker/src/generated/view-plan.validator.js";
import { ROLE_ORDER } from "../../recovered-source/shared/packages/policy/src/roles.ts";

export const API_CATALOG = [
  "KpiRow",
  "NodeCard",
  "ItemList",
  "AccountSummary",
  "StageBoard",
  "MapMini",
  "Callout",
  "Table",
] as const;

export const RENDERER_LEAVES = [
  "KpiTile",
  "DotConstellation",
  "Beeswarm",
  "Funnel",
  "FitBars",
  "TimelineBars",
  "ActivityGrid",
  "PageList",
  "PageCard",
  "Table",
  "Callout",
  "Buttons",
] as const;

const RENDERER_ONLY = new Set<string>(RENDERER_LEAVES.filter((name) => !API_CATALOG.includes(name as (typeof API_CATALOG)[number])));
const API_SET = new Set<string>(API_CATALOG);
const TENANT = /^[a-z0-9_]{3,64}$/;
const ROLES = new Set<string>(ROLE_ORDER);

type ValidateFn = ((data: unknown) => boolean) & {
  errors?: { instancePath?: string; keyword?: string; message?: string }[] | null;
};
const validate = validatePlan as ValidateFn;

export interface ServerViewContext {
  environment: string;
  tenantId: string;
  principalId: string;
  sessionTenantId: string;
  scope: "personal" | "company";
  persona: string | null;
  admittedNodeIds: readonly string[];
}

export interface BoundaryResult {
  ok: boolean;
  code: string;
  html: string;
  dropped: { index: number; type: string; reason: string }[];
}

const ERROR_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>View unavailable</title></head>
<body><p>This view is not available.</p>
<p>NEW reconstruction harness. Not the original shell.</p></body></html>`;

const esc = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function readContext(input: unknown): ServerViewContext | null {
  if (!isObject(input)) return null;
  const environment = input.environment;
  const tenantId = input.tenantId;
  const principalId = input.principalId;
  const sessionTenantId = input.sessionTenantId;
  const scope = input.scope;
  const persona = input.persona;
  const admitted = input.admittedNodeIds;
  if (typeof environment !== "string" || environment.length === 0) return null;
  if (typeof tenantId !== "string" || typeof sessionTenantId !== "string") return null;
  if (typeof principalId !== "string" || principalId.length === 0) return null;
  if (scope !== "personal" && scope !== "company") return null;
  if (persona !== null && typeof persona !== "string") return null;
  if (!Array.isArray(admitted) || admitted.some((id) => typeof id !== "string")) return null;
  return {
    environment,
    tenantId,
    principalId,
    sessionTenantId,
    scope,
    persona,
    admittedNodeIds: admitted as string[],
  };
}

function contextKey(ctx: ServerViewContext): string {
  return [ctx.environment, ctx.tenantId, ctx.principalId, ctx.scope, ctx.persona ?? ""].join("\n");
}

function deny(code: string): BoundaryResult {
  return { ok: false, code, html: ERROR_HTML, dropped: [] };
}

function nodeIdsOf(component: Record<string, unknown>): string[] {
  const props = isObject(component.props) ? component.props : {};
  const ids: string[] = [];
  for (const key of ["nodeId", "accountId", "governanceId", "focusId"]) {
    const value = props[key];
    if (typeof value === "string") ids.push(value);
  }
  return ids;
}

function render(ctx: ServerViewContext, plan: { title: string; components: Record<string, unknown>[] }): string {
  const parts = plan.components.map((component) => {
    const props = isObject(component.props) ? component.props : {};
    const fields = Object.entries(props)
      .filter(([, value]) => typeof value === "string" || typeof value === "number" || typeof value === "boolean")
      .map(([key, value]) => `<li>${esc(key)}=${esc(String(value))}</li>`)
      .join("");
    return `<section><h2>${esc(String(component.type))}</h2><ul>${fields}</ul></section>`;
  });
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(plan.title)}</title></head>
<body>
<p>NEW reconstruction harness. Not the original shell.</p>
<p data-context="${esc(contextKey(ctx))}">${esc(ctx.scope)} view for ${esc(ctx.principalId)}</p>
<h1>${esc(plan.title)}</h1>
${parts.join("\n")}
</body></html>`;
}

export class ViewBoundary {
  private cache: { key: string; html: string } | null = null;

  show(input: unknown, plan: unknown): BoundaryResult {
    const ctx = readContext(input);
    if (!ctx) {
      this.cache = null;
      return deny("context_denied");
    }
    if (!TENANT.test(ctx.tenantId) || ctx.sessionTenantId !== ctx.tenantId) {
      this.cache = null;
      return deny("tenant_mismatch");
    }
    if (ctx.persona !== null && ctx.environment !== "dev") {
      this.cache = null;
      return deny("persona_not_dev");
    }
    if (ctx.persona !== null && !ROLES.has(ctx.persona)) {
      this.cache = null;
      return deny("unknown_persona");
    }
    const key = contextKey(ctx);
    if (this.cache && this.cache.key !== key) this.cache = null;

    if (!isObject(plan) || !Array.isArray(plan.components)) {
      this.cache = null;
      return deny("schema_rejected");
    }
    const dropped: BoundaryResult["dropped"] = [];
    const kept: Record<string, unknown>[] = [];
    plan.components.forEach((component, index) => {
      if (!isObject(component) || typeof component.type !== "string" || !API_SET.has(component.type)) {
        const type = isObject(component) && typeof component.type === "string" ? component.type : "invalid";
        dropped.push({
          index,
          type,
          reason: RENDERER_ONLY.has(type) ? "renderer_catalog" : "not_in_api_catalog",
        });
        return;
      }
      const missing = nodeIdsOf(component).filter((id) => !ctx.admittedNodeIds.includes(id));
      if (missing.length > 0) {
        dropped.push({ index, type: component.type, reason: "node_not_admitted" });
        return;
      }
      kept.push(component);
    });
    if (kept.length === 0) {
      this.cache = null;
      return { ...deny("schema_rejected"), dropped };
    }
    const candidate = { ...plan, components: kept };
    if (!validate(candidate)) {
      this.cache = null;
      return { ...deny("schema_rejected"), dropped };
    }
    const title = typeof candidate.title === "string" ? candidate.title : "";
    const html = render(ctx, { title, components: kept });
    this.cache = { key, html };
    return { ok: true, code: "ok", html, dropped };
  }
}
