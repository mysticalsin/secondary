// Resolves a validated ViewPlan into display data, as the caller, through workers/api.
// The plan holds queries only. Every datum here comes from an API response that the API already
// filtered by policy, so a plan cannot raise permission. A 403 or 404 becomes a status on that one
// component and carries no data.

import type { ViewPlan, ViewPlanComponent } from "../../../../packages/contracts/src/view-plan.ts";
import { type ApiClient, type ApiResult, q } from "../api-client.ts";

export type ComponentStatus = "ok" | "denied" | "missing" | "error";

export interface ResolvedComponent {
  type: ViewPlanComponent["type"];
  props: Record<string, unknown>;
  status: ComponentStatus;
  data?: Record<string, unknown>;
}

export interface ResolvedView {
  version: 1;
  title: string;
  /** Catalog-unknown component types that were dropped before validation. */
  dropped: { index: number; type: string }[];
  components: ResolvedComponent[];
  /** Ids the plan asked about, for the audit receipt (ids only). */
  ids: string[];
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Json) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export const CALLOUTS: Record<string, { tone: "info" | "warning" | "success"; message: string }> = {
  no_access: {
    tone: "warning",
    message: "You do not have access to this. Request access from the owner.",
  },
  empty: { tone: "info", message: "Nothing here yet." },
  stale: {
    tone: "warning",
    message: "This has not been reviewed recently and may be out of date.",
  },
  gap: { tone: "warning", message: "Knowledge gap: this topic has open gaps." },
  nda_locked: {
    tone: "warning",
    message: "Locked by an NDA. A named grant is needed to see the content.",
  },
  personal_private: { tone: "info", message: "Personal Brain: visible to its owner only." },
  candidate_pending: { tone: "info", message: "Candidate: in review, not yet published." },
};

const METRIC_LABELS: Record<string, string> = {
  items: "Items",
  topics: "Topics",
  open: "Open",
  gaps: "Gaps",
  stars: "Stars",
};
const DEFAULT_METRICS = ["items", "topics", "open", "gaps", "stars"];

const statusOf = (r: ApiResult): ComponentStatus =>
  r.ok
    ? "ok"
    : r.status === 403 || r.status === 401
      ? "denied"
      : r.status === 404
        ? "missing"
        : "error";

function counts(c: unknown): Json | null {
  return c === null || c === undefined ? null : obj(c);
}

function nodeSummary(n: Json): Json {
  return {
    id: str(n.id),
    label: str(n.label),
    kind: str(n.kind),
    plane: str(n.plane),
    access: str(n.access),
    counts: counts(n.counts),
    freshnessDays: num(n.freshnessDays),
    signals: obj(n.signals),
    facts: obj(n.facts),
    badges: arr(n.badges).filter((b): b is string => typeof b === "string"),
  };
}

function flattenMap(map: Json, depth: number): Json[] {
  const walk = (nodes: unknown[], d: number): Json[] =>
    nodes.flatMap((raw) => {
      const n = obj(raw);
      const row = { ...nodeSummary(n), hasChildren: arr(n.children).length > 0 };
      return d > 1 ? [row, ...walk(arr(n.children), d - 1)] : [row];
    });
  return walk(arr(map.hubs), depth);
}

const sortKey = (row: Json, by: string): string | number => {
  if (by === "label") return String(row.label ?? "").toLowerCase();
  if (by === "freshness") return num(row.freshnessDays) ?? Number.POSITIVE_INFINITY;
  return num(obj(row.counts)[by]) ?? -1;
};

function tableRow(n: Json): Json {
  const c = obj(n.counts);
  return {
    label: n.label ?? null,
    kind: n.kind ?? null,
    items: num(c.items),
    open: num(c.open),
    gaps: num(c.gaps),
    freshness: num(n.freshnessDays),
    id: n.id ?? null,
    locked: n.counts === null,
  };
}

export async function resolveView(
  plan: ViewPlan,
  api: ApiClient,
  dropped: ResolvedView["dropped"],
): Promise<ResolvedView> {
  // One API read per distinct path, even when several components share it.
  const memo = new Map<string, Promise<ApiResult>>();
  const get = (path: string) => {
    let p = memo.get(path);
    if (!p) {
      p = api.get(path);
      memo.set(path, p);
    }
    return p;
  };
  const ids = new Set<string>();

  const resolveOne = async (c: ViewPlanComponent): Promise<ResolvedComponent> => {
    const props = c.props as Record<string, unknown>;
    const done = (status: ComponentStatus, data?: Json): ResolvedComponent => ({
      type: c.type,
      props,
      status,
      ...(data ? { data } : {}),
    });

    switch (c.type) {
      case "Callout": {
        const spec = CALLOUTS[c.props.template];
        if (c.props.nodeId) ids.add(c.props.nodeId);
        return done("ok", {
          message: spec?.message ?? "",
          tone: c.props.tone ?? spec?.tone ?? "info",
        });
      }
      case "KpiRow": {
        const metrics = c.props.metrics ?? DEFAULT_METRICS;
        if (c.props.nodeId) {
          ids.add(c.props.nodeId);
          const r = await get(`/v1/nodes/${q(c.props.nodeId)}`);
          if (!r.ok) return done(statusOf(r));
          const node = obj(obj(r.data).node);
          const cn = counts(node.counts);
          return done("ok", {
            label: str(node.label) ?? c.props.nodeId,
            locked: cn === null,
            metrics: metrics.map((k) => ({
              key: k,
              label: METRIC_LABELS[k],
              value: cn ? num(cn[k]) : null,
            })),
          });
        }
        const lens = c.props.lens ?? "departments";
        const r = await get(`/v1/map?lens=${q(lens)}`);
        if (!r.ok) return done(statusOf(r));
        const hubs = arr(obj(r.data).hubs).map(obj);
        const total = (k: string) => hubs.reduce((acc, h) => acc + (num(obj(h.counts)[k]) ?? 0), 0);
        return done("ok", {
          label: `${lens} lens`,
          locked: false,
          metrics: metrics.map((k) => ({ key: k, label: METRIC_LABELS[k], value: total(k) })),
        });
      }
      case "NodeCard": {
        ids.add(c.props.nodeId);
        const r = await get(`/v1/nodes/${q(c.props.nodeId)}`);
        if (!r.ok) return done(statusOf(r));
        return done("ok", nodeSummary(obj(obj(r.data).node)));
      }
      case "ItemList": {
        ids.add(c.props.nodeId);
        const r = await get(`/v1/nodes/${q(c.props.nodeId)}`);
        if (!r.ok) return done(statusOf(r));
        const d = obj(r.data);
        const f = c.props.filter;
        const items = arr(d.items)
          .map(obj)
          // Only the filters the item shape carries are applied here; the rest are ignored, never guessed.
          .filter((i) => (f?.evidence ? i.evidence === f.evidence : true))
          .slice(0, c.props.limit ?? 20)
          .map((i) => ({
            title: str(i.title) ?? "",
            source: str(i.source) ?? null,
            ownerRole: str(i.ownerRole) ?? null,
            revision: num(i.revision),
            evidence: str(i.evidence) ?? null,
            plane: str(i.plane) ?? null,
            reviewedBy2: i.reviewedBy2 === true,
          }));
        return done("ok", {
          nodeId: c.props.nodeId,
          label: str(obj(d.node).label) ?? c.props.nodeId,
          items,
        });
      }
      case "AccountSummary": {
        ids.add(c.props.accountId);
        const r = await get(`/v1/accounts/${q(c.props.accountId)}`);
        if (!r.ok) return done(statusOf(r));
        const d = obj(r.data);
        const sections = arr(d.sections).map((raw) => {
          const s = obj(raw);
          const items = arr(s.items);
          return {
            label: str(s.title) ?? str(s.label) ?? str(s.id) ?? "Section",
            count: num(s.count) ?? (items.length ? items.length : null),
            lines: items
              .slice(0, 5)
              .map((i) => str(i) ?? str(obj(i).title) ?? str(obj(i).label) ?? ""),
          };
        });
        const acct = obj(d.account);
        return done("ok", {
          id: c.props.accountId,
          label: str(d.label) ?? str(d.title) ?? str(acct.label) ?? c.props.accountId,
          sections,
        });
      }
      case "StageBoard": {
        const r = await get("/v1/governances");
        if (!r.ok) return done(statusOf(r));
        const raw = obj(r.data);
        const list = Array.isArray(r.data) ? (r.data as unknown[]) : arr(raw.governances);
        const governances = list
          .map(obj)
          .filter((g) => (c.props.governanceId ? g.id === c.props.governanceId : true))
          .map((g) => {
            const st = g.stages;
            const stages = Array.isArray(st)
              ? st.map(obj).map((s) => ({
                  stage: str(s.stage) ?? str(s.label) ?? "",
                  count: num(s.count) ?? 0,
                }))
              : Object.entries(obj(st)).map(([stage, count]) => ({
                  stage,
                  count: num(count) ?? 0,
                }));
            return { id: str(g.id) ?? "", label: str(g.label) ?? str(g.id) ?? "", stages };
          });
        if (c.props.governanceId) ids.add(c.props.governanceId);
        return done("ok", { governances });
      }
      case "MapMini": {
        if (c.props.focusId) ids.add(c.props.focusId);
        const r = await get(`/v1/map?lens=${q(c.props.lens)}`);
        if (!r.ok) return done(statusOf(r));
        const d = obj(r.data);
        let hubs = arr(d.hubs).map(obj);
        const focus = c.props.focusId;
        if (focus) {
          const inTree = (n: Json): boolean =>
            n.id === focus || arr(n.children).map(obj).some(inTree);
          hubs = hubs.filter(inTree);
        }
        const hops = c.props.hops ?? 1;
        return done("ok", {
          lens: c.props.lens,
          core: { id: str(obj(d.core).id) ?? "core", label: str(obj(d.core).label) ?? "Secondary" },
          hubs: hubs.slice(0, 16).map((h) => ({
            ...nodeSummary(h),
            children: hops > 1 ? arr(h.children).slice(0, 8).map(obj).map(nodeSummary) : [],
          })),
          focusId: focus ?? null,
        });
      }
      case "Table": {
        const columns = c.props.columns ?? ["label", "kind", "items", "open", "gaps", "freshness"];
        let rows: Json[];
        if (c.props.nodeId) {
          ids.add(c.props.nodeId);
          const r = await get(`/v1/nodes/${q(c.props.nodeId)}`);
          if (!r.ok) return done(statusOf(r));
          rows = arr(obj(obj(r.data).node).children)
            .map(obj)
            .map(nodeSummary);
        } else {
          const r = await get(`/v1/map?lens=${q(c.props.lens ?? "departments")}`);
          if (!r.ok) return done(statusOf(r));
          rows = flattenMap(obj(r.data), 1);
        }
        const sort = c.props.sort;
        if (sort) {
          const dir = sort.dir === "desc" ? -1 : 1;
          rows.sort((a, b) => {
            const ka = sortKey(a, sort.by);
            const kb = sortKey(b, sort.by);
            return ka < kb ? -dir : ka > kb ? dir : 0;
          });
        }
        return done("ok", { columns, rows: rows.slice(0, c.props.limit ?? 50).map(tableRow) });
      }
    }
  };

  const components = await Promise.all(plan.components.map(resolveOne));
  return { version: 1, title: plan.title, dropped, components, ids: [...ids] };
}
