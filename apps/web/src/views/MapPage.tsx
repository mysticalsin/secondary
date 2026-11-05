import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { MapCanvas, type Projection } from "../components/MapCanvas";
import { MapList, MapTable } from "../components/MapLists";
import { Await, Empty, PageHead } from "../components/ui";
import { flatten } from "../map-layout";
import { useApp } from "../state";
import type { Lens, MapView } from "../types";
import { useApi } from "../useApi";

const LENSES: [Lens, string][] = [
  ["departments", "Departments"],
  ["accounts", "Accounts"],
  ["topics", "Topics"],
  ["governances", "Governances"],
];
type Proj = Projection | "list" | "table";
const PROJS: [Proj, string][] = [
  ["ring", "Ring"],
  ["clusters", "Clusters"],
  ["list", "List"],
  ["table", "Table"],
];

export function MapPage() {
  const [sp, setSp] = useSearchParams();
  const { openNode, drawerId } = useApp();
  const lens = (LENSES.find((l) => l[0] === sp.get("lens"))?.[0] ?? "departments") as Lens;
  const small = typeof window !== "undefined" && window.matchMedia?.("(max-width: 640px)").matches;
  const proj = (PROJS.find((p) => p[0] === sp.get("view"))?.[0] ??
    (small ? "list" : "ring")) as Proj;
  const [query, setQuery] = useState("");
  const state = useApi(() => api.map(lens), [lens]);
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    n.set(k, v);
    setSp(n, { replace: true });
  };

  return (
    <div className="page">
      <PageHead
        eyebrow="Company map"
        title={
          <>
            Where the knowledge <em>lives.</em>
          </>
        }
        lead="Only what your role admits is drawn. Locked scopes show their name and nothing else."
      />
      <div className="toolbar">
        <div className="pills" role="group" aria-label="Lens">
          {LENSES.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className="pill"
              aria-pressed={lens === id}
              onClick={() => set("lens", id)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="sp" />
        <div className="pills" role="group" aria-label="Projection">
          {PROJS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className="pill"
              aria-pressed={proj === id}
              onClick={() => set("view", id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="toolbar">
        <div className="field" style={{ flex: 1, maxWidth: 360 }}>
          <label htmlFor="mapq" className="sr-only">
            Find in this map
          </label>
          <div style={{ position: "relative" }}>
            <Search
              size={15}
              aria-hidden
              style={{ position: "absolute", left: 12, top: 13, color: "var(--mute)" }}
            />
            <input
              id="mapq"
              className="input"
              style={{ paddingLeft: 34, borderRadius: 999 }}
              placeholder="Find in this map"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        <Await state={state}>{(v) => <MapMeta view={v} lens={lens} selected={drawerId} />}</Await>
      </div>
      <Await state={state} skeleton={4}>
        {(v) =>
          v.hubs.length === 0 ? (
            <Empty title="Nothing in this lens for your role">
              Switch lens, or ask a steward for access. Hidden scopes never appear as gaps.
            </Empty>
          ) : (
            <>
              {proj === "ring" || proj === "clusters" ? (
                <>
                  <MapCanvas
                    view={v}
                    projection={proj}
                    query={query}
                    selectedId={drawerId}
                    focusId={drawerId}
                    onOpen={openNode}
                  />
                  <Legend />
                </>
              ) : proj === "list" ? (
                <MapList view={v} query={query} onOpen={openNode} />
              ) : (
                <MapTable view={v} query={query} onOpen={openNode} />
              )}
            </>
          )
        }
      </Await>
    </div>
  );
}

function MapMeta({ view, lens, selected }: { view: MapView; lens: Lens; selected: string | null }) {
  const info = useMemo(() => {
    const hub = selected
      ? view.hubs.find(
          (h) =>
            h.id === selected ||
            h.children.some((c) => c.id === selected || c.children?.some((t) => t.id === selected)),
        )
      : undefined;
    return { n: view.hubs.length + flatten(view).length, hub: hub?.label };
  }, [view, selected]);
  const label = LENSES.find((l) => l[0] === lens)?.[1] ?? lens;
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      <span>Map</span>
      <span aria-hidden>/</span>
      <span>{label}</span>
      {info.hub ? (
        <>
          <span aria-hidden>/</span>
          <strong>{info.hub}</strong>
        </>
      ) : null}
      <span className="muted">· {info.n} nodes in your view</span>
    </nav>
  );
}

function Legend() {
  return (
    <div className="legend" style={{ marginTop: 12 }}>
      <span>
        <i className="dotk" style={{ background: "#6600ae", border: "1px solid #b764ff" }} />
        Hub
      </span>
      <span>
        <i className="dotk" style={{ background: "#b764ff" }} />
        Circle or group
      </span>
      <span>
        <i className="dotk" style={{ background: "#e2c8ff" }} />
        Topic or item
      </span>
      <span>
        <i className="dotk" style={{ border: "2px solid #f8f060" }} />
        Open decision or overdue
      </span>
      <span>
        <i className="dotk" style={{ border: "1.5px dashed #e2c8ff" }} />
        Gap
      </span>
      <span>
        <i className="dotk" style={{ background: "#4a3d58" }} />
        Locked, name only
      </span>
      <span aria-hidden style={{ color: "#f8f060" }}>
        ★ Approved success story
      </span>
    </div>
  );
}
