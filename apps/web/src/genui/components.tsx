import { Info, TriangleAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { MapCanvas } from "../components/MapCanvas";
import { StageBoard } from "../components/StageBoard";
import { Await, Chip, fmtRev, PlaneBadge, statusTone, useStatus } from "../components/ui";
import { type Key, useI18n } from "../i18n";
import { useApp } from "../state";
import type { CalloutTemplate, Counts, Hub, Lens, MapNode } from "../types";
import { useApi } from "../useApi";
import { MaturityBar } from "../views/Governances";

type P = Record<string, unknown>;

function sum(counts: (Counts | null)[]): Counts | null {
  const live = counts.filter((c): c is Counts => c !== null);
  if (live.length === 0) return null;
  return live.reduce((a, c) => ({
    items: a.items + c.items,
    topics: a.topics + c.topics,
    open: a.open + c.open,
    gaps: a.gaps + c.gaps,
    stars: a.stars + c.stars,
  }));
}

const METRIC_LABEL: Record<string, Key> = {
  items: "dr.counts.items",
  topics: "dr.counts.topics",
  open: "dr.counts.open",
  gaps: "dr.counts.gaps",
  stars: "gen.stars",
};
const DEFAULT_METRICS = ["items", "topics", "open", "gaps", "stars"];

export function KpiRow({ props }: { props: P }) {
  const { t } = useI18n();
  const state = useApi<Counts | null>(async () => {
    if (typeof props.nodeId === "string") return (await api.node(props.nodeId)).node.counts;
    const v = await api.map(props.lens as Lens);
    return sum(v.hubs.map((h) => h.counts));
  }, [props.nodeId, props.lens]);
  return (
    <Await state={state} skeleton={1}>
      {(c) => {
        const metrics = Array.isArray(props.metrics)
          ? (props.metrics as string[])
          : DEFAULT_METRICS;
        const cells: [string, string][] = c
          ? metrics.map((m) => [
              METRIC_LABEL[m] ? t(METRIC_LABEL[m] as Key) : m,
              String(c[m as keyof Counts]),
            ])
          : [[t("dr.counts"), t("common.hidden")]];
        return (
          <div className="kpis">
            {cells.map(([l, v]) => (
              <div className="kpi" key={l}>
                <b>{v}</b>
                <span className="muted">{l}</span>
              </div>
            ))}
          </div>
        );
      }}
    </Await>
  );
}

export function NodeCard({ props }: { props: P }) {
  const { openNode } = useApp();
  const { t, td } = useI18n();
  const state = useApi(() => api.node(String(props.nodeId)), [props.nodeId]);
  return (
    <Await state={state} skeleton={1}>
      {(d) => (
        <div className="card">
          <div className="row" style={{ marginBottom: 8 }}>
            <PlaneBadge plane={d.node.plane} />
            <span className="chip t-open">{td("nodekind", d.node.kind, d.node.kind)}</span>
            {d.node.access === "locked" ? <Chip tone="risk">{t("common.locked")}</Chip> : null}
          </div>
          <h3 style={{ marginBottom: 6 }}>{d.node.label}</h3>
          <p className="muted">
            {d.node.counts
              ? t("gen.node.counts", {
                  items: d.node.counts.items,
                  open: d.node.counts.open,
                  gaps: d.node.counts.gaps,
                })
              : t("gen.node.hidden")}
          </p>
          <p style={{ marginTop: 12 }}>
            <button type="button" className="btn sm" onClick={() => openNode(d.node.id)}>
              {t("gen.open")}
            </button>
          </p>
        </div>
      )}
    </Await>
  );
}

export function ItemList({ props }: { props: P }) {
  const { t } = useI18n();
  const sl = useStatus();
  const state = useApi(() => api.node(String(props.nodeId)), [props.nodeId]);
  const limit = typeof props.limit === "number" ? props.limit : 5;
  const want = (props.filter as { evidence?: string } | undefined)?.evidence;
  return (
    <Await state={state} skeleton={2}>
      {(d) => (
        <div className="card">
          <h3>{t("gen.items.title", { name: d.node.label })}</h3>
          {d.items.length === 0 ? <p className="muted">{t("gen.items.none")}</p> : null}
          {d.items
            .filter((it) => !want || it.evidence === want)
            .slice(0, limit)
            .map((it) => (
              <div className="itemrow" key={`${it.title}${it.revision}`}>
                <strong>{it.title}</strong>
                <div className="meta">
                  <Chip tone={statusTone(it.evidence)}>
                    {t("dr.evidence", { state: sl(it.evidence) })}
                  </Chip>
                  <span>{it.source}</span>
                  <span>{fmtRev(it.revision)}</span>
                </div>
              </div>
            ))}
        </div>
      )}
    </Await>
  );
}

export function AccountSummary({ props }: { props: P }) {
  const { t } = useI18n();
  const sl = useStatus();
  const state = useApi(() => api.account(String(props.accountId)), [props.accountId]);
  return (
    <Await state={state} skeleton={1}>
      {(d) => (
        <div className="card">
          <div className="row" style={{ marginBottom: 8 }}>
            <PlaneBadge plane={d.account.plane} />
            <Chip tone={statusTone(d.account.status)}>{d.account.status}</Chip>
            <Chip tone={statusTone(d.account.aiProcessing)}>
              {t("acc.ai", { state: sl(d.account.aiProcessing) })}
            </Chip>
          </div>
          <h3 style={{ marginBottom: 6 }}>{d.account.name}</h3>
          <p className="muted">
            {t("gen.account.summary", {
              country: d.account.country,
              sector: d.account.sector,
              open: d.account.openItems,
              stars: d.account.stars,
            })}
          </p>
          <p style={{ marginTop: 12 }}>
            <Link className="btn sm" to={`/accounts/${d.account.id}`}>
              {t("gen.account.open")}
            </Link>
          </p>
        </div>
      )}
    </Await>
  );
}

export function StageBoardBlock({ props }: { props: P }) {
  const { openNode } = useApp();
  const id = typeof props.governanceId === "string" ? props.governanceId : null;
  if (!id) return <AllGovernances />;
  return <OneGovernance id={id} onOpen={openNode} />;
}

function OneGovernance({ id, onOpen }: { id: string; onOpen: (id: string) => void }) {
  const { t } = useI18n();
  const state = useApi(() => api.governance(id), [id]);
  return (
    <Await state={state} skeleton={2}>
      {(d) => (
        <div className="stack">
          <h3>{t("gen.gov.title", { name: d.governance.label, n: d.governance.useCases })}</h3>
          <StageBoard useCases={d.useCases} onOpen={onOpen} limit={4} />
        </div>
      )}
    </Await>
  );
}

/** No governance named: one maturity bar per governance the viewer may see. */
function AllGovernances() {
  const { t } = useI18n();
  const state = useApi(() => api.governances(), []);
  return (
    <Await state={state} skeleton={2}>
      {(list) => (
        <div className="stack">
          {list
            .filter((g) => g.useCases > 0)
            .map((g) => (
              <div key={g.id}>
                <Link to={`/governances/${g.id}`} className="linkbtn">
                  {g.label}
                </Link>{" "}
                <span className="muted">{t("gen.gov.n", { n: g.useCases })}</span>
                <MaturityBar g={g} />
              </div>
            ))}
          {list.every((g) => g.useCases === 0) ? (
            <p className="muted">{t("gen.gov.none")}</p>
          ) : null}
        </div>
      )}
    </Await>
  );
}

export function MapMini({ props }: { props: P }) {
  const { openNode } = useApp();
  const { t } = useI18n();
  const state = useApi(() => api.map(props.lens as Lens), [props.lens]);
  return (
    <Await state={state} skeleton={2}>
      {(v) => (
        <div>
          <MapCanvas view={v} projection="ring" onOpen={openNode} compact />
          <p className="muted" style={{ marginTop: 6, fontSize: 14 }}>
            {t("gen.map.hint")}
          </p>
        </div>
      )}
    </Await>
  );
}

const CALLOUT_TEXT: Record<CalloutTemplate, Key> = {
  no_access: "gen.callout.no_access",
  empty: "gen.callout.empty",
  stale: "gen.callout.stale",
  gap: "gen.callout.gap",
  nda_locked: "gen.callout.nda_locked",
  personal_private: "gen.callout.personal_private",
  candidate_pending: "gen.callout.candidate_pending",
};
const TONE_CLASS: Record<string, string> = { info: "info", warning: "attention", success: "info" };

/** A fixed message chosen by key. A plan cannot put free text on screen. */
export function Callout({ props }: { props: P }) {
  const { t } = useI18n();
  const tone = typeof props.tone === "string" ? props.tone : "info";
  const Icon = tone === "info" || tone === "success" ? Info : TriangleAlert;
  return (
    <div className={`callout ${TONE_CLASS[tone] ?? "info"}`} role="note">
      <Icon size={18} aria-hidden style={{ flex: "none", marginTop: 2 }} />
      <div>
        {CALLOUT_TEXT[props.template as CalloutTemplate]
          ? t(CALLOUT_TEXT[props.template as CalloutTemplate])
          : null}
      </div>
    </div>
  );
}

interface Row {
  id: string;
  label: string;
  kind: string;
  items: number | null;
  open: number | null;
  gaps: number | null;
  freshness: number | null;
}

const COLUMN_LABEL: Record<string, Key> = {
  label: "map.col.name",
  kind: "map.col.kind",
  items: "dr.counts.items",
  open: "dr.counts.open",
  gaps: "dr.counts.gaps",
  freshness: "map.col.fresh",
};
const DEFAULT_COLUMNS = ["label", "kind", "items", "open", "gaps"];

export function TableBlock({ props }: { props: P }) {
  const { openNode } = useApp();
  const { t } = useI18n();
  const nodeIdProp = typeof props.nodeId === "string" ? props.nodeId : null;
  const state = useApi<Row[]>(async () => {
    if (nodeIdProp) {
      const d = await api.node(nodeIdProp);
      return d.items.map((it, i) => ({
        id: `${nodeIdProp}#${i}`,
        label: it.title,
        kind: it.evidence,
        items: null,
        open: null,
        gaps: null,
        freshness: null,
      }));
    }
    const v = await api.map(props.lens as Lens);
    const nodes: (MapNode | Hub)[] = v.hubs.flatMap((h): (MapNode | Hub)[] =>
      h.children.length ? h.children : [h],
    );
    return nodes.map(
      (n): Row => ({
        id: n.id,
        label: n.label,
        kind: n.kind,
        items: n.counts ? n.counts.items : null,
        open: n.counts ? n.counts.open : null,
        gaps: n.counts ? n.counts.gaps : null,
        freshness: "freshnessDays" in n ? n.freshnessDays : null,
      }),
    );
  }, [nodeIdProp, props.lens]);
  const columns = Array.isArray(props.columns) ? (props.columns as string[]) : DEFAULT_COLUMNS;
  const sort = props.sort as { by: keyof Row; dir?: "asc" | "desc" } | undefined;
  const limit = typeof props.limit === "number" ? props.limit : 25;
  return (
    <Await state={state} skeleton={2}>
      {(rows) => {
        const ordered = sort
          ? [...rows].sort((a, b) => {
              const x = a[sort.by];
              const y = b[sort.by];
              const c =
                typeof x === "string" || typeof y === "string"
                  ? String(x ?? "").localeCompare(String(y ?? ""))
                  : (x ?? -1) - (y ?? -1);
              return sort.dir === "asc" ? c : -c;
            })
          : rows;
        return (
          <div className="tablewrap">
            <table className="t">
              <caption className="sr-only">
                {t("gen.table.caption", { name: nodeIdProp ?? String(props.lens) })}
              </caption>
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th scope="col" key={c}>
                      {COLUMN_LABEL[c] ? t(COLUMN_LABEL[c] as Key) : c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ordered.slice(0, limit).map((r) => (
                  <tr key={r.id}>
                    {columns.map((c) =>
                      c === "label" ? (
                        <td key={c}>
                          {nodeIdProp ? (
                            r.label
                          ) : (
                            <button
                              type="button"
                              className="linkbtn"
                              onClick={() => openNode(r.id)}
                            >
                              {r.label}
                            </button>
                          )}
                        </td>
                      ) : (
                        <td key={c} className={c === "kind" ? undefined : "num"}>
                          {r[c as keyof Row] === null
                            ? t("common.hidden")
                            : String(r[c as keyof Row])}
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }}
    </Await>
  );
}
