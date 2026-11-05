import { CATALOG_TYPES, type CatalogType, type ViewPlan } from "../types";

type Props = Record<string, unknown>;
const isObj = (v: unknown): v is Props => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length < 300;
const LENSES = ["departments", "accounts", "topics", "governances"];

/** Prop validators per catalog type. Props are queries, never data. */
const VALIDATE: Record<CatalogType, (p: Props) => boolean> = {
  KpiRow: (p) => (str(p.lens) && LENSES.includes(p.lens)) || str(p.nodeId),
  NodeCard: (p) => str(p.nodeId),
  ItemList: (p) =>
    str(p.nodeId) &&
    (p.limit === undefined || (typeof p.limit === "number" && p.limit > 0 && p.limit <= 20)),
  AccountSummary: (p) => str(p.accountId),
  StageBoard: (p) => str(p.governanceId),
  MapMini: (p) => str(p.lens) && LENSES.includes(p.lens),
  Callout: (p) =>
    str(p.text) && (p.tone === undefined || ["info", "attention", "risk"].includes(String(p.tone))),
  Table: (p) => str(p.lens) && LENSES.includes(p.lens),
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
