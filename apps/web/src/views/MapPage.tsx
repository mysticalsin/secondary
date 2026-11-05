import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { MapCanvas, type Projection } from "../components/MapCanvas";
import { MapList, MapTable } from "../components/MapLists";
import { Await, Empty, PageHead } from "../components/ui";
import { type Key, useI18n } from "../i18n";
import { flatten } from "../map-layout";
import { useApp } from "../state";
import type { Lens, MapView } from "../types";
import { useApi } from "../useApi";
import { wikiApi } from "./wiki/api";

const LENSES: [Lens, Key][] = [
  ["departments", "map.lens.departments"],
  ["accounts", "map.lens.accounts"],
  ["topics", "map.lens.topics"],
  ["governances", "map.lens.governances"],
];
type Proj = Projection | "list" | "table";
const PROJS: [Proj, Key][] = [
  ["ring", "map.proj.ring"],
  ["clusters", "map.proj.clusters"],
  ["list", "map.proj.list"],
  ["table", "map.proj.table"],
];

export function MapPage() {
  const { t } = useI18n();
  const [sp, setSp] = useSearchParams();
  const { openNode, drawerId } = useApp();
  const lens = (LENSES.find((l) => l[0] === sp.get("lens"))?.[0] ?? "departments") as Lens;
  const small = typeof window !== "undefined" && window.matchMedia?.("(max-width: 640px)").matches;
  const proj = (PROJS.find((p) => p[0] === sp.get("view"))?.[0] ??
    (small ? "list" : "ring")) as Proj;
  const [query, setQuery] = useState("");
  const state = useApi(() => api.map(lens), [lens]);
  // The wiki health signal is a hint. If it cannot be read the map still works.
  const health = useApi(() => wikiApi.health().catch(() => []), []);
  const wikiHealth = Object.fromEntries(
    (health.data ?? []).map((h) => [h.nodeId, { score: h.score, openFindings: h.openFindings }]),
  );
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    n.set(k, v);
    setSp(n, { replace: true });
  };

  return (
    <div className="page">
      <PageHead
        eyebrow={t("map.eyebrow")}
        title={
          <>
            {t("map.title.a")} <em>{t("map.title.b")}</em>
          </>
        }
        lead={t("map.lead")}
      />
      <div className="toolbar">
        <div className="pills" role="group" aria-label={t("map.lens")}>
          {LENSES.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className="pill"
              aria-pressed={lens === id}
              onClick={() => set("lens", id)}
            >
              {t(label)}
            </button>
          ))}
        </div>
        <span className="sp" />
        <div className="pills" role="group" aria-label={t("map.proj")}>
          {PROJS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className="pill"
              aria-pressed={proj === id}
              onClick={() => set("view", id)}
            >
              {t(label)}
            </button>
          ))}
        </div>
      </div>
      <div className="toolbar">
        <div className="field toolbar-search">
          <label htmlFor="mapq" className="sr-only">
            {t("map.find")}
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
              placeholder={t("map.find")}
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
            <Empty title={t("map.empty.title")}>{t("map.empty.body")}</Empty>
          ) : proj === "ring" || proj === "clusters" ? (
            <>
              <MapCanvas
                view={v}
                projection={proj}
                query={query}
                selectedId={drawerId}
                focusId={drawerId}
                onOpen={openNode}
                wiki={wikiHealth}
              />
              <Legend />
            </>
          ) : proj === "list" ? (
            <MapList view={v} query={query} onOpen={openNode} />
          ) : (
            <MapTable view={v} query={query} onOpen={openNode} />
          )
        }
      </Await>
    </div>
  );
}

function MapMeta({ view, lens, selected }: { view: MapView; lens: Lens; selected: string | null }) {
  const { t } = useI18n();
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
  const label = t(LENSES.find((l) => l[0] === lens)?.[1] ?? "map.lens.departments");
  return (
    <nav className="crumbs" aria-label={t("map.crumbs")}>
      <span>{t("nav.map")}</span>
      <span aria-hidden>/</span>
      <span>{label}</span>
      {info.hub ? (
        <>
          <span aria-hidden>/</span>
          <strong>{info.hub}</strong>
        </>
      ) : null}
      <span className="muted">· {t("map.nodes", { n: info.n })}</span>
    </nav>
  );
}

function Legend() {
  const { t } = useI18n();
  return (
    <div className="legend" style={{ marginTop: 12 }}>
      <span>
        <i className="dotk" style={{ background: "#6600ae", border: "1px solid #b764ff" }} />
        {t("map.lg.hub")}
      </span>
      <span>
        <i className="dotk" style={{ background: "#b764ff" }} />
        {t("map.lg.circle")}
      </span>
      <span>
        <i className="dotk" style={{ background: "#e2c8ff" }} />
        {t("map.lg.topic")}
      </span>
      <span>
        <i className="dotk" style={{ border: "2px solid #f8f060" }} />
        {t("map.lg.open")}
      </span>
      <span>
        <i className="dotk" style={{ border: "1.5px dashed #e2c8ff" }} />
        {t("map.lg.gap")}
      </span>
      <span>
        <i className="dotk" style={{ background: "#4a3d58" }} />
        {t("map.lg.locked")}
      </span>
      <span aria-hidden style={{ color: "#f8f060" }}>
        ★ {t("map.lg.star")}
      </span>
    </div>
  );
}
