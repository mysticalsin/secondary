import { CALLOUT_TEMPLATES, CATALOG_TYPES, type CatalogType, type ViewPlan } from "../types";

type Props = Record<string, unknown>;
const isObj = (v: unknown): v is Props => typeof v === "object" && v !== null && !Array.isArray(v);
const LENSES = ["departments", "accounts", "topics", "governances"];
const NODE_ID = /^[a-z0-9][a-z0-9_.:-]{0,127}$/;
const nodeId = (v: unknown): v is string => typeof v === "string" && NODE_ID.test(v);
const lens = (v: unknown): v is string => typeof v === "string" && LENSES.includes(v);
const oneOf = (v: unknown, list: readonly string[]) => typeof v === "string" && list.includes(v);
const int = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
/** No keys outside the schema (every props object has additionalProperties:false). */
const only = (p: Props, keys: readonly string[]) => Object.keys(p).every((k) => keys.includes(k));
const METRICS = ["items", "topics", "open", "gaps", "stars"];
const COLUMNS = ["label", "kind", "items", "open", "gaps", "freshness"];
const FILTER_KEYS = ["status", "evidence", "type", "tag"];

function filterOk(f: unknown): boolean {
  if (f === undefined) return true;
  if (!isObj(f) || !only(f, FILTER_KEYS)) return false;
  return (
    (f.status === undefined || oneOf(f.status, ["approved", "candidate", "draft"])) &&
    (f.evidence === undefined || oneOf(f.evidence, ["supported", "partial", "unsupported"])) &&
    (f.type === undefined ||
      (typeof f.type === "string" && /^[A-Za-z0-9 &-]{1,40}$/.test(f.type))) &&
    (f.tag === undefined || (typeof f.tag === "string" && /^[a-z0-9-]{1,40}$/.test(f.tag)))
  );
}

/** Prop validators per catalog type, mirroring packages/contracts view-plan.schema.json. Props are queries, never data. */
const VALIDATE: Record<CatalogType, (p: Props) => boolean> = {
  KpiRow: (p) =>
    only(p, ["nodeId", "lens", "metrics"]) &&
    (nodeId(p.nodeId) || lens(p.lens)) &&
    (p.nodeId === undefined || nodeId(p.nodeId)) &&
    (p.lens === undefined || lens(p.lens)) &&
    (p.metrics === undefined ||
      (Array.isArray(p.metrics) &&
        p.metrics.length >= 1 &&
        p.metrics.length <= 5 &&
        new Set(p.metrics).size === p.metrics.length &&
        p.metrics.every((m) => oneOf(m, METRICS)))),
  NodeCard: (p) => only(p, ["nodeId"]) && nodeId(p.nodeId),
  ItemList: (p) =>
    only(p, ["nodeId", "filter", "limit"]) &&
    nodeId(p.nodeId) &&
    filterOk(p.filter) &&
    (p.limit === undefined || int(p.limit, 1, 50)),
  AccountSummary: (p) => only(p, ["accountId"]) && nodeId(p.accountId),
  StageBoard: (p) =>
    only(p, ["governanceId"]) && (p.governanceId === undefined || nodeId(p.governanceId)),
  MapMini: (p) =>
    only(p, ["lens", "focusId", "hops"]) &&
    lens(p.lens) &&
    (p.focusId === undefined || nodeId(p.focusId)) &&
    (p.hops === undefined || int(p.hops, 1, 3)),
  Callout: (p) =>
    only(p, ["template", "tone", "nodeId"]) &&
    oneOf(p.template, CALLOUT_TEMPLATES) &&
    (p.tone === undefined || oneOf(p.tone, ["info", "warning", "success"])) &&
    (p.nodeId === undefined || nodeId(p.nodeId)),
  Table: (p) =>
    only(p, ["nodeId", "lens", "filter", "columns", "sort", "limit"]) &&
    (nodeId(p.nodeId) || lens(p.lens)) &&
    (p.nodeId === undefined || nodeId(p.nodeId)) &&
    (p.lens === undefined || lens(p.lens)) &&
    filterOk(p.filter) &&
    (p.columns === undefined ||
      (Array.isArray(p.columns) &&
        p.columns.length >= 1 &&
        p.columns.length <= 6 &&
        new Set(p.columns).size === p.columns.length &&
        p.columns.every((c) => oneOf(c, COLUMNS)))) &&
    (p.sort === undefined ||
      (isObj(p.sort) &&
        only(p.sort, ["by", "dir"]) &&
        oneOf(p.sort.by, ["label", "items", "open", "gaps", "freshness"]) &&
        (p.sort.dir === undefined || oneOf(p.sort.dir, ["asc", "desc"])))) &&
    (p.limit === undefined || int(p.limit, 1, 100)),
};

export const isCatalogType = (t: unknown): t is CatalogType =>
  typeof t === "string" && (CATALOG_TYPES as readonly string[]).includes(t);

const MAX_COMPONENTS = 12;

/**
 * Validates a plan received from the API. Unknown component types and components whose props do not
 * match their query shape are dropped. A plan cannot raise permission: it only names queries.
 */
export function sanitizePlan(input: unknown): ViewPlan | null {
  if (!isObj(input) || input.version !== 1 || !Array.isArray(input.components)) return null;
  const components: ViewPlan["components"] = [];
  for (const c of input.components) {
    if (!isObj(c) || !isCatalogType(c.type)) continue;
    const props = isObj(c.props) ? c.props : {};
    if (!VALIDATE[c.type](props)) continue;
    components.push({ type: c.type, props });
    if (components.length >= MAX_COMPONENTS) break;
  }
  return {
    version: 1,
    title: typeof input.title === "string" ? input.title.slice(0, 120) : "Secondary view",
    components,
  };
}
