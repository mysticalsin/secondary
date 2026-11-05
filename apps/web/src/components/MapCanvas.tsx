import { Maximize2, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clusterLayout, type Layout, type PNode, ringLayout } from "../map-layout";
import type { MapView } from "../types";

export type Projection = "ring" | "clusters";

interface Xf {
  x: number;
  y: number;
  k: number;
}
const FIT: Xf = { x: 0, y: 0, k: 1 };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const STAR = "0,-5 1.5,-1.6 5,-1.5 2.2,0.8 3.1,4.5 0,2.4 -3.1,4.5 -2.2,0.8 -5,-1.5 -1.5,-1.6";

function fill(p: PNode, projection: Projection): { fill: string; stroke: string; sw: number } {
  const locked = p.node.access === "locked";
  if (locked) return { fill: "#4a3d58", stroke: "#6d6080", sw: 1 };
  if (projection === "clusters") {
    if (p.depth === 0) return { fill: "rgba(102,0,174,0.30)", stroke: "#8e3fe0", sw: 1.2 };
    if (p.depth === 1 && p.node.children?.length)
      return { fill: "rgba(183,100,255,0.20)", stroke: "#b764ff", sw: 0.8 };
  }
  if (p.depth === 0) return { fill: "#6600ae", stroke: "#b764ff", sw: 1.4 };
  if (p.depth === 1) return { fill: "#b764ff", stroke: "#e2c8ff", sw: 0.8 };
  return { fill: "#e2c8ff", stroke: "none", sw: 0 };
}

function opacityOf(p: PNode): number {
  const d = p.node.freshnessDays;
  if (d === null || p.node.access === "locked") return 0.95;
  return clamp(1 - d / 170, 0.38, 1);
}

function wrap(label: string, max = 15): string[] {
  const words = label.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max && cur) {
      lines.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  if (lines.length > 2) {
    const first = lines[0] as string;
    const rest = lines.slice(1).join(" ");
    return [first, rest.length > max + 2 ? `${rest.slice(0, max)}…` : rest];
  }
  return lines;
}

function Padlock({ s = 1 }: { s?: number }) {
  return (
    <g transform={`scale(${s})`} aria-hidden>
      <rect x="-5" y="-1" width="10" height="8" rx="2" fill="#d9d0e4" />
      <path d="M-3 -1 v-2.5 a3 3 0 0 1 6 0 v2.5" fill="none" stroke="#d9d0e4" strokeWidth="1.6" />
    </g>
  );
}

interface Props {
  view: MapView;
  projection: Projection;
  query?: string;
  selectedId?: string | null;
  focusId?: string | null;
  onOpen: (id: string) => void;
  compact?: boolean;
}

export function MapCanvas({
  view,
  projection,
  query = "",
  selectedId,
  focusId,
  onOpen,
  compact,
}: Props) {
  const layout: Layout = useMemo(
    () => (projection === "ring" ? ringLayout(view) : clusterLayout(view)),
    [view, projection],
  );
  const [xf, setXf] = useState<Xf>(FIT);
  const [drag, setDrag] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const moved = useRef(0);
  const last = useRef<{ x: number; y: number } | null>(null);
  const xfRef = useRef(xf);
  xfRef.current = xf;

  useEffect(() => setXf(FIT), [layout]);

  const scale = useCallback(() => {
    const el = boxRef.current;
    if (!el) return 1;
    const r = el.getBoundingClientRect();
    return Math.min(r.width, r.height) / (2 * layout.extent);
  }, [layout.extent]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || compact) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const s = scale();
      const px = (e.clientX - rect.left - rect.width / 2) / s;
      const py = (e.clientY - rect.top - rect.height / 2) / s;
      const cur = xfRef.current;
      const k = clamp(cur.k * Math.exp(-e.deltaY * 0.0016), 0.6, 9);
      const f = k / cur.k;
      setXf({ k, x: px - (px - cur.x) * f, y: py - (py - cur.y) * f });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [compact, scale]);

  const zoomBy = (f: number) =>
    setXf((c) => ({ ...c, k: clamp(c.k * f, 0.6, 9), x: c.x * f, y: c.y * f }));

  useEffect(() => {
    if (!focusId || compact) return;
    const p = layout.byId.get(focusId);
    if (!p) return;
    let k = 2.2;
    let tx = p.x;
    let ty = p.y;
    if (projection === "ring") {
      const out = p.isHub ? 90 : 0;
      tx = p.x + Math.cos(p.angle) * out;
      ty = p.y + Math.sin(p.angle) * out;
    } else {
      k = clamp((layout.extent * 0.8) / Math.max(p.r, 1), 1.2, 6);
    }
    setXf({ k, x: -tx * k, y: -ty * k });
  }, [focusId, layout, projection, compact]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return null;
    return new Set(layout.items.filter((p) => p.label.toLowerCase().includes(q)).map((p) => p.id));
  }, [q, layout]);

  const depth1Count = useMemo(() => layout.items.filter((p) => p.depth === 1).length, [layout]);
  const k = compact ? 1 : xf.k;
  const fs = (base: number) => base / Math.sqrt(Math.max(k, 0.8));

  const onPointerDown = (e: React.PointerEvent) => {
    if (compact) return;
    moved.current = 0;
    last.current = { x: e.clientX, y: e.clientY };
    setDrag(true);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!last.current) return;
    const s = scale();
    const dx = e.clientX - last.current.x;
    const dy = e.clientY - last.current.y;
    moved.current += Math.abs(dx) + Math.abs(dy);
    last.current = { x: e.clientX, y: e.clientY };
    setXf((c) => ({ ...c, x: c.x + dx / s, y: c.y + dy / s }));
  };
  const onPointerUp = () => {
    last.current = null;
    setDrag(false);
  };
  const open = (id: string) => {
    if (moved.current > 5) return;
    onOpen(id);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (compact || e.target !== e.currentTarget) return;
    const step = 40 / k;
    if (e.key === "+" || e.key === "=") zoomBy(1.25);
    else if (e.key === "-") zoomBy(0.8);
    else if (e.key === "0") setXf(FIT);
    else if (e.key === "ArrowLeft") setXf((c) => ({ ...c, x: c.x + step }));
    else if (e.key === "ArrowRight") setXf((c) => ({ ...c, x: c.x - step }));
    else if (e.key === "ArrowUp") setXf((c) => ({ ...c, y: c.y + step }));
    else if (e.key === "ArrowDown") setXf((c) => ({ ...c, y: c.y - step }));
    else return;
    e.preventDefault();
  };

  const ex = layout.extent;
  const link = view.links[0];
  const la = link ? layout.byId.get(link.from) : undefined;
  const lb = link ? layout.byId.get(link.to) : undefined;

  return (
    <div
      ref={boxRef}
      className={`mapbox${compact ? " compact" : ""}${drag ? " dragging" : ""}`}
      tabIndex={compact ? undefined : 0}
      role="group"
      aria-label={`Map, ${projection} projection. Use the List or Table view for keyboard browsing of every node. Press plus, minus, 0 and arrows to move the camera.`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    >
      <svg
        viewBox={`${-ex} ${-ex} ${2 * ex} ${2 * ex}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Company map"
      >
        <g className="zoomable" transform={`translate(${xf.x} ${xf.y}) scale(${xf.k})`}>
          {projection === "ring" ? (
            <>
              {layout.bands.map((b) => (
                <g key={b.label}>
                  <path d={b.path} fill="rgba(215,145,255,0.22)" />
                  <text
                    className="svg-label mono"
                    x={b.lx}
                    y={b.ly}
                    textAnchor="middle"
                    fontSize={fs(10)}
                  >
                    {b.label}
                  </text>
                </g>
              ))}
              {layout.items
                .filter((p) => p.isHub)
                .map((h) => (
                  <line
                    key={`l-${h.id}`}
                    x1="0"
                    y1="0"
                    x2={h.x}
                    y2={h.y}
                    stroke="#b764ff"
                    strokeOpacity="0.16"
                  />
                ))}
              <g>
                <circle r={layout.coreR} fill="#6600ae" stroke="#e2c8ff" strokeOpacity="0.6" />
                <text
                  className="svg-label"
                  textAnchor="middle"
                  y="-2"
                  fontSize="11"
                  fontWeight="700"
                  style={{ stroke: "none" }}
                >
                  {view.core.label}
                </text>
                <text
                  className="svg-label"
                  textAnchor="middle"
                  y="13"
                  fontSize="10"
                  style={{ stroke: "none", fill: "#e2c8ff" }}
                >
                  {view.core.topicCount} topics
                </text>
              </g>
            </>
          ) : null}

          {projection === "ring" && la && lb ? (
            <path
              d={`M${la.x},${la.y} Q${((la.x + lb.x) / 2) * 0.7},${((la.y + lb.y) / 2) * 0.7} ${lb.x},${lb.y}`}
              fill="none"
              stroke="#f8f060"
              strokeOpacity="0.55"
              strokeDasharray="4 4"
            />
          ) : null}

          {layout.items.map((p) => {
            const f = fill(p, projection);
            const locked = p.node.access === "locked";
            const dim = matches ? !matches.has(p.id) : false;
            const hit = matches?.has(p.id) ?? false;
            const sel = selectedId === p.id;
            const showLabel =
              hit ||
              sel ||
              (p.depth === 0 && (projection === "ring" || p.r > 46 || k > 1.5)) ||
              (p.depth === 1 && (k >= 1.7 || (depth1Count <= 14 && projection === "ring"))) ||
              (p.depth === 2 && k >= 3);
            const lines = wrap(p.label, p.depth === 0 ? 15 : 22);
            const hubRing = p.isHub && projection === "ring";
            const lx = hubRing ? -Math.cos(p.angle) * (p.r + 18) : 0;
            const ly = hubRing
              ? -Math.sin(p.angle) * (p.r + 18)
              : p.depth === 0
                ? -p.r + fs(14)
                : p.r + fs(12);
            const summary =
              p.node.counts && !locked
                ? `${p.label}. ${p.node.counts.items} items, ${p.node.counts.open} open.`
                : `${p.label}. ${locked ? "Locked." : "Counts hidden."}`;
            return (
              <g
                key={p.id}
                transform={`translate(${p.x} ${p.y})`}
                className="node-hit"
                opacity={dim ? 0.14 : 1}
                {...(p.isHub
                  ? {
                      role: "button",
                      tabIndex: 0,
                      "aria-label": summary,
                      onKeyDown: (e: React.KeyboardEvent) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onOpen(p.id);
                        }
                      },
                    }
                  : { role: "presentation" })}
                onClick={() => open(p.id)}
              >
                <title>{summary}</title>
                {p.node.signals.open && !locked ? (
                  <circle
                    r={p.r + (p.depth === 2 ? 2.4 : 3.4)}
                    fill="none"
                    stroke="#f8f060"
                    strokeWidth={p.depth === 2 ? 1.3 : 1.8}
                  />
                ) : null}
                <circle
                  className="node-main"
                  r={p.r}
                  fill={f.fill}
                  fillOpacity={opacityOf(p)}
                  stroke={sel || hit ? "#ffffff" : f.stroke}
                  strokeWidth={sel || hit ? 2 : f.sw}
                  strokeDasharray={p.node.signals.gap && !locked ? "3 2.5" : undefined}
                />
                {p.node.signals.star && !locked && p.depth !== 2 ? (
                  <g transform={`translate(${p.r * 0.75} ${-p.r * 0.75})`}>
                    <polygon points={STAR} fill="#f8f060" stroke="#140c1c" strokeWidth="0.8" />
                  </g>
                ) : null}
                {locked && p.depth !== 2 ? <Padlock s={p.depth === 0 ? 1 : 0.7} /> : null}
                {showLabel ? (
                  <text
                    className="svg-label"
                    textAnchor="middle"
                    x={lx}
                    y={ly}
                    fontSize={fs(
                      p.depth === 0
                        ? projection === "clusters"
                          ? clamp(p.r / 6, 11.5, 22)
                          : 11.5
                        : p.depth === 1
                          ? 10
                          : 9,
                    )}
                    fontWeight={p.depth === 0 ? 700 : 400}
                  >
                    {lines.map((ln, i) => (
                      <tspan key={ln} x={lx} dy={i === 0 ? 0 : fs(12)}>
                        {ln}
                      </tspan>
                    ))}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>
      {compact ? null : (
        <>
          <div className="maphint" aria-hidden>
            Drag to pan, scroll to zoom. Size: items. Fade: freshness.
          </div>
          <div className="mapctl">
            <button
              type="button"
              className="icon-btn"
              aria-label="Zoom in"
              onClick={() => zoomBy(1.3)}
            >
              <Plus size={16} aria-hidden />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Zoom out"
              onClick={() => zoomBy(0.77)}
            >
              <Minus size={16} aria-hidden />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Fit to screen"
              onClick={() => setXf(FIT)}
            >
              <Maximize2 size={16} aria-hidden />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
