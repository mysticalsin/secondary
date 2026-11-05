import { ChevronRight, Lock, Star } from "lucide-react";
import { useMemo, useState } from "react";
import { flatten, sortedHubs } from "../map-layout";
import type { Hub, MapNode, MapView } from "../types";
import { Chip } from "./ui";

const LIMIT = 60;

function accessChip(a: MapNode["access"]) {
  if (a === "locked") {
    return (
      <span className="chip t-risk">
        <Lock size={11} aria-hidden /> Locked
      </span>
    );
  }
  if (a === "partial") return <Chip tone="progress">Structure</Chip>;
  return null;
}

function NodeLine({
  n,
  depth,
  onOpen,
}: {
  n: MapNode;
  depth: 1 | 2;
  onOpen: (id: string) => void;
}) {
  return (
    <li className={depth === 2 ? "d2" : ""}>
      <button type="button" className="linkbtn" onClick={() => onOpen(n.id)}>
        {n.label}
      </button>
      {n.signals.star ? (
        <span title="Approved success story" role="img" aria-label="Success story">
          <Star size={13} color="#f8f060" fill="#f8f060" aria-hidden />
        </span>
      ) : null}
      {n.signals.open ? <Chip tone="attn">Open</Chip> : null}
      {n.signals.gap ? <Chip tone="risk">Gap</Chip> : null}
      {accessChip(n.access)}
      <span className="sp" />
      <span className="muted num">{n.counts ? `${n.counts.items} items` : "hidden"}</span>
    </li>
  );
}

export function MapList({
  view,
  query,
  onOpen,
}: {
  view: MapView;
  query: string;
  onOpen: (id: string) => void;
}) {
  const q = query.trim().toLowerCase();
  const [openHubs, setOpenHubs] = useState<Record<string, boolean>>({});
  const [all, setAll] = useState<Record<string, boolean>>({});
  const hubs = sortedHubs(view);
  if (hubs.length === 0) return null;
  return (
    <div className="mapcols">
      {hubs.map((h: Hub) => {
        const nodes: { n: MapNode; d: 1 | 2 }[] = [];
        for (const c of h.children) {
          const kids = c.children ?? [];
          const cm = !q || c.label.toLowerCase().includes(q);
          const km = kids.filter((t) => !q || t.label.toLowerCase().includes(q));
          if (cm || km.length) nodes.push({ n: c, d: 1 });
          for (const t of cm && !q ? kids : km) nodes.push({ n: t, d: 2 });
        }
        if (q && nodes.length === 0 && !h.label.toLowerCase().includes(q)) return null;
        const expanded = q ? true : (openHubs[h.id] ?? hubs.length <= 4);
        const shown = all[h.id] ? nodes : nodes.slice(0, LIMIT);
        const lid = `hub-${h.id}`;
        return (
          <section className="hubsec" key={h.id} aria-labelledby={lid}>
            <div style={{ display: "flex", alignItems: "center" }}>
              <button
                type="button"
                className="hubhead"
                aria-expanded={expanded}
                aria-controls={`${lid}-list`}
                onClick={() => setOpenHubs((s) => ({ ...s, [h.id]: !expanded }))}
              >
                <ChevronRight
                  size={16}
                  aria-hidden
                  style={{ transform: expanded ? "rotate(90deg)" : "none" }}
                />
                <span id={lid}>{h.label}</span>
                {h.group ? (
                  <span className="muted" style={{ fontWeight: 400 }}>
                    {h.group}
                  </span>
                ) : null}
                {accessChip(h.access)}
                <span className="muted num" style={{ marginLeft: "auto", fontWeight: 400 }}>
                  {h.counts ? `${h.counts.items} items` : "hidden"}
                </span>
              </button>
              <button
                type="button"
                className="btn sm ghost"
                style={{ marginRight: 12 }}
                onClick={() => onOpen(h.id)}
              >
                Details
              </button>
            </div>
            {expanded ? (
              <ul id={`${lid}-list`}>
                {shown.length === 0 ? (
                  <li className="muted">Locked. Name only.</li>
                ) : (
                  shown.map(({ n, d }) => <NodeLine key={n.id} n={n} depth={d} onOpen={onOpen} />)
                )}
                {nodes.length > shown.length ? (
                  <li>
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => setAll((s) => ({ ...s, [h.id]: true }))}
                    >
                      Show all {nodes.length}
                    </button>
                  </li>
                ) : null}
              </ul>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

type SortKey = "label" | "hub" | "kind" | "items" | "open" | "gaps" | "fresh" | "access";

export function MapTable({
  view,
  query,
  onOpen,
}: {
  view: MapView;
  query: string;
  onOpen: (id: string) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "label", dir: 1 });
  const [showAll, setShowAll] = useState(false);
  const q = query.trim().toLowerCase();
  const data = useMemo(() => {
    const all = [
      ...sortedHubs(view).map((h) => ({
        id: h.id,
        label: h.label,
        hub: h.label,
        kind: h.kind,
        items: h.counts?.items ?? -1,
        open: h.counts?.open ?? -1,
        gaps: h.counts?.gaps ?? -1,
        fresh: -1,
        access: h.access,
      })),
      ...flatten(view).map((f) => ({
        id: f.node.id,
        label: f.node.label,
        hub: f.hub.label,
        kind: f.node.kind,
        items: f.node.counts?.items ?? -1,
        open: f.node.counts?.open ?? -1,
        gaps: f.node.counts?.gaps ?? -1,
        fresh: f.node.freshnessDays ?? -1,
        access: f.node.access,
      })),
    ].filter((r) => !q || r.label.toLowerCase().includes(q) || r.hub.toLowerCase().includes(q));
    const { key, dir } = sort;
    return all.sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      return (
        (typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv))) * dir
      );
    });
  }, [view, q, sort]);

  const shown = showAll ? data : data.slice(0, 120);
  const cols: [SortKey, string][] = [
    ["label", "Name"],
    ["hub", "Group"],
    ["kind", "Kind"],
    ["items", "Items"],
    ["open", "Open"],
    ["gaps", "Gaps"],
    ["fresh", "Days since update"],
    ["access", "Access"],
  ];
  const num = (v: number) => (v < 0 ? "hidden" : String(v));
  return (
    <div>
      <div className="tablewrap">
        <table className="t">
          <caption className="sr-only">Every node in your view, sortable</caption>
          <thead>
            <tr>
              {cols.map(([k, label]) => (
                <th
                  key={k}
                  scope="col"
                  aria-sort={
                    sort.key === k ? (sort.dir === 1 ? "ascending" : "descending") : "none"
                  }
                >
                  <button
                    type="button"
                    onClick={() =>
                      setSort((s) => ({ key: k, dir: s.key === k ? (s.dir === 1 ? -1 : 1) : 1 }))
                    }
                  >
                    {label}
                    {sort.key === k ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td>
                  <button type="button" className="linkbtn" onClick={() => onOpen(r.id)}>
                    {r.label}
                  </button>
                </td>
                <td>{r.hub}</td>
                <td>{r.kind}</td>
                <td className="num">{num(r.items)}</td>
                <td className="num">{num(r.open)}</td>
                <td className="num">{num(r.gaps)}</td>
                <td className="num">{num(r.fresh)}</td>
                <td>{r.access}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.length > shown.length ? (
        <p style={{ marginTop: 12 }}>
          <button type="button" className="btn sm" onClick={() => setShowAll(true)}>
            Show all {data.length} rows
          </button>
        </p>
      ) : null}
    </div>
  );
}
