import { Info, TriangleAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { MapCanvas } from "../components/MapCanvas";
import { StageBoard } from "../components/StageBoard";
import { Await, Chip, PlaneBadge, statusTone } from "../components/ui";
import { useApp } from "../state";
import type { Counts, Lens } from "../types";
import { useApi } from "../useApi";

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

export function KpiRow({ props }: { props: P }) {
  const state = useApi<Counts | null>(async () => {
    if (typeof props.nodeId === "string") return (await api.node(props.nodeId)).node.counts;
    const v = await api.map(props.lens as Lens);
    return sum(v.hubs.map((h) => h.counts));
  }, [props.nodeId, props.lens]);
  return (
    <Await state={state} skeleton={1}>
      {(c) => {
        const cells: [string, string][] = c
          ? [
              ["Items", c.items],
              ["Topics or accounts", c.topics],
              ["Open", c.open],
              ["Gaps", c.gaps],
              ["Success stories", c.stars],
            ].map(([l, v]) => [String(l), String(v)])
          : [["Counts", "hidden"]];
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
  const state = useApi(() => api.node(String(props.nodeId)), [props.nodeId]);
  return (
    <Await state={state} skeleton={1}>
      {(d) => (
        <div className="card">
          <div className="row" style={{ marginBottom: 8 }}>
            <PlaneBadge plane={d.node.plane} />
            <span className="chip t-open">{d.node.kind}</span>
            {d.node.access === "locked" ? <Chip tone="risk">Locked</Chip> : null}
          </div>
          <h3 style={{ marginBottom: 6 }}>{d.node.label}</h3>
          <p className="muted">
            {d.node.counts
              ? `${d.node.counts.items} items, ${d.node.counts.open} open, ${d.node.counts.gaps} gaps.`
              : "Counts are hidden for your role."}
          </p>
          <p style={{ marginTop: 12 }}>
            <button type="button" className="btn sm" onClick={() => openNode(d.node.id)}>
              Open details
            </button>
          </p>
        </div>
      )}
    </Await>
  );
}

export function ItemList({ props }: { props: P }) {
  const state = useApi(() => api.node(String(props.nodeId)), [props.nodeId]);
  const limit = typeof props.limit === "number" ? props.limit : 5;
  return (
    <Await state={state} skeleton={2}>
      {(d) => (
        <div className="card">
          <h3>Top items in {d.node.label}</h3>
          {d.items.length === 0 ? <p className="muted">No items visible for your role.</p> : null}
          {d.items.slice(0, limit).map((it) => (
            <div className="itemrow" key={`${it.title}${it.revision}`}>
              <strong>{it.title}</strong>
              <div className="meta">
                <Chip tone={statusTone(it.evidence)}>Evidence: {it.evidence}</Chip>
                <span>{it.source}</span>
                <span>{it.revision}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Await>
  );
}

export function AccountSummary({ props }: { props: P }) {
  const state = useApi(() => api.account(String(props.accountId)), [props.accountId]);
  return (
    <Await state={state} skeleton={1}>
      {(d) => (
        <div className="card">
          <div className="row" style={{ marginBottom: 8 }}>
            <PlaneBadge plane={d.account.plane} />
            <Chip tone={statusTone(d.account.status)}>{d.account.status}</Chip>
            <Chip tone={statusTone(d.account.aiProcessing)}>
              AI processing: {d.account.aiProcessing}
            </Chip>
          </div>
          <h3 style={{ marginBottom: 6 }}>{d.account.name}</h3>
          <p className="muted">
            {d.account.country} · {d.account.sector} · {d.account.openItems} open items ·{" "}
            {d.account.stars} success stories
          </p>
          <p style={{ marginTop: 12 }}>
            <Link className="btn sm" to={`/accounts/${d.account.id}`}>
              Open workspace
            </Link>
          </p>
        </div>
      )}
    </Await>
  );
}

export function StageBoardBlock({ props }: { props: P }) {
  const { openNode } = useApp();
  const state = useApi(() => api.governance(String(props.governanceId)), [props.governanceId]);
  return (
    <Await state={state} skeleton={2}>
      {(d) => (
        <div className="stack">
          <h3>
            {d.governance.label}: {d.governance.useCases} use cases
          </h3>
          <StageBoard useCases={d.useCases} onOpen={openNode} limit={4} />
        </div>
      )}
    </Await>
  );
}

export function MapMini({ props }: { props: P }) {
  const { openNode } = useApp();
  const state = useApi(() => api.map(props.lens as Lens), [props.lens]);
  return (
    <Await state={state} skeleton={2}>
      {(v) => (
        <div>
          <MapCanvas view={v} projection="ring" onOpen={openNode} compact />
          <p className="muted" style={{ marginTop: 6, fontSize: 14 }}>
            Open the Map view for zoom, clusters and the keyboard list.
          </p>
        </div>
      )}
    </Await>
  );
}

export function Callout({ props }: { props: P }) {
  const tone = typeof props.tone === "string" ? props.tone : "info";
  const Icon = tone === "info" ? Info : TriangleAlert;
  return (
    <div className={`callout ${tone}`} role="note">
      <Icon size={18} aria-hidden style={{ flex: "none", marginTop: 2 }} />
      <div>{String(props.text)}</div>
    </div>
  );
}

export function TableBlock({ props }: { props: P }) {
  const { openNode } = useApp();
  const state = useApi(() => api.map(props.lens as Lens), [props.lens]);
  const filter = typeof props.filter === "string" ? props.filter.toLowerCase() : "";
  return (
    <Await state={state} skeleton={2}>
      {(v) => (
        <div className="tablewrap">
          <table className="t">
            <caption className="sr-only">{String(props.lens)} overview</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Items</th>
                <th scope="col">Open</th>
                <th scope="col">Gaps</th>
                <th scope="col">Access</th>
              </tr>
            </thead>
            <tbody>
              {v.hubs
                .filter((h) => !filter || h.label.toLowerCase().includes(filter))
                .map((h) => (
                  <tr key={h.id}>
                    <td>
                      <button type="button" className="linkbtn" onClick={() => openNode(h.id)}>
                        {h.label}
                      </button>
                    </td>
                    <td className="num">{h.counts ? h.counts.items : "hidden"}</td>
                    <td className="num">{h.counts ? h.counts.open : "hidden"}</td>
                    <td className="num">{h.counts ? h.counts.gaps : "hidden"}</td>
                    <td>{h.access}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </Await>
  );
}
