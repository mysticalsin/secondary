import { Brain } from "lucide-react";
import {
  type KeyboardEvent,
  memo,
  type PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useI18n } from "../i18n";
import { initials, useUid } from "./hooks";
import {
  type Box,
  buildGrid,
  CANVAS,
  dotRadius,
  type Geometry,
  layoutConstellation,
  nearest,
  PILL_H,
  type PillIn,
  placePills,
} from "./layout";
import { CARD, cat } from "./palette";
import type { Constellation } from "./types";

/** Above this many dots the dot layer is drawn on a canvas; rings, names and hover stay SVG. */
export const CANVAS_ABOVE = 2000;
const pct = (n: number): string => `${n}%`;
interface Pill {
  id: number;
  l: number;
  y: number;
  w: number;
  text: string;
  score: number;
  leader: { x1: number; y1: number; x2: number; y2: number } | null;
}

/** Name pills for the named nodes: none touches a node, the centre, a collection name or another pill. */
function pillsFor(
  g: Geometry,
  data: Constellation,
  named: number[],
  names: Map<string, string>,
): Pill[] {
  const avoid: Box[] = g.labels.map((l) => {
    const w = (names.get(l.id)?.length ?? 6) * 8.6;
    const left = l.anchor === "start" ? l.x : l.anchor === "end" ? l.x - w : l.x - w / 2;
    return { l: left - 4, r: left + w + 4, t: l.y - 16, b: l.y + 6 };
  });
  const info = new Map<number, { text: string; score: number }>();
  const ins: PillIn[] = named.map((i, rank) => {
    const p = g.placed[i] as (typeof g.placed)[0];
    const d = data.dots[i] as (typeof data.dots)[0];
    const full = d.label ?? d.title ?? "";
    const text = full.length > 26 ? `${full.slice(0, 25)}\u2026` : full;
    info.set(i, { text, score: d.score });
    return {
      id: i,
      x: p.x,
      y: p.y,
      w: Math.min(290, 28 + text.length * 7.9 + pct(d.score).length * 8.5),
      priority: named.length - rank,
    };
  });
  return placePills(ins, {
    w: g.w,
    h: g.h,
    cx: g.cx,
    cy: g.cy,
    centreR: 34,
    avoid,
  }).map((p) => ({ ...p, ...(info.get(p.id) as { text: string; score: number }) }));
}

const DotsLayer = memo(function DotsLayer({
  g,
  data,
  animate,
}: {
  g: Geometry;
  data: Constellation;
  animate: boolean;
}) {
  // One group per band so a ring of dots fades in together (centre first).
  const bands = useMemo(() => {
    const by = new Map<number, number[]>();
    g.placed.forEach((p, i) => {
      const list = by.get(p.band);
      if (list) list.push(i);
      else by.set(p.band, [i]);
    });
    return [...by.entries()].sort((a, z) => a[0] - z[0]);
  }, [g]);
  return (
    <g aria-hidden>
      {bands.map(([band, list]) => (
        <g
          key={band}
          className={animate ? "dc-band" : undefined}
          style={animate ? { animationDelay: `${Math.min(band * 16, 420)}ms` } : undefined}
        >
          {list.map((i) => {
            const p = g.placed[i] as (typeof g.placed)[0];
            const d = data.dots[i] as (typeof data.dots)[0];
            return (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={dotRadius(Math.hypot(p.x - g.cx, p.y - g.cy))}
                fill={d.inZone ? CARD.inZone : CARD.below}
                opacity={
                  d.inZone
                    ? 0.55 + Math.min(1, (d.score - data.legend.threshold) / 30) * 0.45
                    : 0.78
                }
              />
            );
          })}
        </g>
      ))}
    </g>
  );
});

function CanvasDots({ g, data }: { g: Geometry; data: Constellation }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    cv.width = g.w * ratio;
    cv.height = g.h * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, g.w, g.h);
    for (const zone of [false, true]) {
      ctx.fillStyle = zone ? CARD.inZone : CARD.below;
      ctx.globalAlpha = zone ? 0.9 : 0.78;
      ctx.beginPath();
      g.placed.forEach((p, i) => {
        if ((data.dots[i] as (typeof data.dots)[0]).inZone !== zone) return;
        const dr = dotRadius(Math.hypot(p.x - g.cx, p.y - g.cy));
        ctx.moveTo(p.x + dr, p.y);
        ctx.arc(p.x, p.y, dr, 0, Math.PI * 2);
      });
      ctx.fill();
    }
  }, [g, data]);
  return <canvas ref={ref} className="dc-canvas" aria-hidden />;
}

/**
 * The brain as a field of dots: a collection per sector, the distance from the centre is the score,
 * one dot a page (or k pages when the brain is dense). Layout is seeded, so it never jumps.
 */
export function DotConstellation({
  data,
  name,
  selected,
  onSelect,
  animate = true,
  summary,
}: {
  data: Constellation;
  name: string;
  selected: string | null;
  onSelect: (pageId: string) => void;
  animate?: boolean;
  summary: string;
}) {
  const { t, tn } = useI18n();
  const uid = useUid();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState(-1);
  const sectorIds = useMemo(() => data.sectors.map((s) => s.id), [data.sectors]);
  const g = useMemo(
    () => layoutConstellation(data.dots, sectorIds, data.rings, data.seed),
    [data.dots, sectorIds, data.rings, data.seed],
  );
  const grid = useMemo(() => buildGrid(g.placed, 16, CANVAS.w), [g]);
  const sectorLabel = useMemo(
    () => new Map(data.sectors.map((s) => [s.id, s.label])),
    [data.sectors],
  );
  const sectorIndex = useMemo(() => new Map(sectorIds.map((s, n) => [s, n])), [sectorIds]);
  const named = useMemo(
    () =>
      data.dots
        .map((d, i) => (d.highlight ? i : -1))
        .filter((i) => i >= 0)
        .sort((a, z) => (data.dots[z]?.score ?? 0) - (data.dots[a]?.score ?? 0)),
    [data.dots],
  );
  const pills = useMemo(() => pillsFor(g, data, named, sectorLabel), [g, data, named, sectorLabel]);
  const nodeRefs = useRef<(SVGGElement | null)[]>([]);
  const zoneR = g.ringR[data.rings.indexOf(data.legend.threshold)] ?? g.ringR[1] ?? 150;
  const canvas = data.dots.length > CANVAS_ABOVE;

  const at = (e: PointerEvent<SVGSVGElement>): number => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box || !box.width) return -1;
    const k = CANVAS.w / box.width;
    return nearest(grid, g.placed, (e.clientX - box.left) * k, (e.clientY - box.top) * k, 7);
  };
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const i = at(e);
    setHover((h) => (h === i ? h : i));
  };
  const onClick = (e: PointerEvent<SVGSVGElement>) => {
    const i = at(e);
    const id = i >= 0 ? data.dots[i]?.pageId : null;
    if (id) onSelect(id);
  };
  const onKey = (e: KeyboardEvent<SVGGElement>, n: number) => {
    const dir =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    if (dir) {
      e.preventDefault();
      const to = (n + dir + named.length) % named.length;
      nodeRefs.current[to]?.focus();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const id = data.dots[named[n] as number]?.pageId;
      if (id) onSelect(id);
    }
  };

  const hd = hover >= 0 ? data.dots[hover] : undefined;
  const hp = hover >= 0 ? g.placed[hover] : undefined;
  const hoverText = hd
    ? hd.k > 1
      ? t("v5.con.hover.bucket", { k: hd.k, score: hd.score })
      : `${hd.title ?? sectorLabel.get(hd.sector) ?? ""} ${hd.score}%`
    : "";
  const hoverW = Math.min(260, 18 + hoverText.length * 7);

  return (
    <div className="dc">
      {/* Keyboard users reach the named pages, which are real buttons; the pointer click is a shortcut to the same call. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the named nodes carry the keyboard path */}
      <svg
        ref={svgRef}
        className="dc-svg"
        viewBox={`0 0 ${g.w} ${g.h}`}
        role="group"
        aria-label={t("v5.con.group", { name })}
        aria-describedby={`${uid}-keys`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(-1)}
        onClick={onClick}
      >
        <title>{t("v5.con.group", { name })}</title>
        <desc>{summary}</desc>
        <defs>
          <radialGradient id={`${uid}-zone`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={CARD.inZone} stopOpacity="0.2" />
            <stop offset="100%" stopColor={CARD.inZone} stopOpacity="0.05" />
          </radialGradient>
        </defs>
        <circle cx={g.cx} cy={g.cy} r={g.R} fill="none" stroke={CARD.grid} strokeWidth={1} />
        {g.ringR.map((r, n) => (
          <circle
            key={data.rings[n]}
            cx={g.cx}
            cy={g.cy}
            r={r}
            fill="none"
            stroke={CARD.grid}
            strokeWidth={1}
            strokeDasharray="1 5"
          />
        ))}
        <circle
          cx={g.cx}
          cy={g.cy}
          r={zoneR}
          fill={`url(#${uid}-zone)`}
          stroke={CARD.inZone}
          strokeOpacity={0.7}
          strokeWidth={1.2}
          strokeDasharray="5 5"
        />
        {canvas ? (
          <foreignObject x={0} y={0} width={g.w} height={g.h} aria-hidden>
            <CanvasDots g={g} data={data} />
          </foreignObject>
        ) : (
          <DotsLayer g={g} data={data} animate={animate} />
        )}
        {g.ringR.map((r, n) => (
          <text
            key={`l${data.rings[n]}`}
            className="dc-ring"
            x={g.cx - r * 0.7 + 2}
            y={g.cy + r * 0.72 + 4}
            textAnchor="middle"
          >
            {data.rings[n]}%
          </text>
        ))}
        {g.labels.map((l) => (
          <text key={l.id} className="dc-sector" x={l.x} y={l.y} textAnchor={l.anchor}>
            {sectorLabel.get(l.id)}
          </text>
        ))}
        <circle cx={g.cx} cy={g.cy} r={22} fill="#6b46e5" aria-hidden />
        <circle
          cx={g.cx}
          cy={g.cy}
          r={29}
          fill="none"
          stroke={CARD.inZone}
          strokeOpacity={0.35}
          aria-hidden
        />
        <Brain x={g.cx - 11} y={g.cy - 11} width={22} height={22} color="#fff" aria-hidden />

        {hp && hd && hover >= 0 ? (
          <g className="dc-hover" pointerEvents="none" aria-hidden>
            <circle cx={hp.x} cy={hp.y} r={6.5} fill="none" stroke="#fff" strokeWidth={1.6} />
            <g
              transform={`translate(${Math.max(4, Math.min(g.w - hoverW - 4, hp.x - hoverW / 2))},${Math.max(4, hp.y - 38)})`}
            >
              <rect width={hoverW} height={26} rx={8} fill="#2b2b32" stroke="#44444d" />
              <text x={hoverW / 2} y={17} textAnchor="middle" className="dc-pilltext">
                {hoverText}
              </text>
            </g>
          </g>
        ) : null}

        {pills.map((p) =>
          p.leader ? (
            <line
              key={`lead${p.id}`}
              className="dc-leader"
              x1={p.leader.x1}
              y1={p.leader.y1}
              x2={p.leader.x2}
              y2={p.leader.y2}
              aria-hidden
            />
          ) : null,
        )}
        {pills.map((p) => (
          <g key={`pill${p.id}`} aria-hidden pointerEvents="none">
            <rect
              x={p.l}
              y={p.y - PILL_H / 2}
              width={p.w}
              height={PILL_H}
              rx={8}
              className="dc-pill"
            />
            <text x={p.l + 10} y={p.y + 5} className="dc-pilltext">
              {p.text} <tspan className="dc-pillscore">{pct(p.score)}</tspan>
            </text>
          </g>
        ))}
        {named.map((i, n) => {
          const p = g.placed[i] as (typeof g.placed)[0];
          const d = data.dots[i] as (typeof data.dots)[0];
          const tone = cat(sectorIndex.get(d.sector) ?? 0);
          const label = d.label ?? d.title ?? "";
          const on = selected !== null && d.pageId === selected;
          return (
            <g
              key={`node${i}`}
              ref={(el) => {
                nodeRefs.current[n] = el;
              }}
              className={`dc-node${on ? " on" : ""}`}
              role="button"
              tabIndex={n === 0 ? 0 : -1}
              aria-label={t("v5.con.node", { title: label, score: d.score })}
              aria-pressed={on}
              onKeyDown={(e) => onKey(e, n)}
              onClick={(e) => {
                e.stopPropagation();
                if (d.pageId) onSelect(d.pageId);
              }}
              onPointerMove={(e) => e.stopPropagation()}
            >
              <circle cx={p.x} cy={p.y} r={16} fill="transparent" />
              <circle className="dc-ava" cx={p.x} cy={p.y} r={14} fill={tone.fill} />
            </g>
          );
        })}
        {/* The initials sit outside the buttons: they are decoration, the button's name is the title. */}
        <g aria-hidden pointerEvents="none">
          {named.map((i) => {
            const p = g.placed[i] as (typeof g.placed)[0];
            const d = data.dots[i] as (typeof data.dots)[0];
            return (
              <text key={`ini${i}`} x={p.x} y={p.y + 4} textAnchor="middle" className="dc-ini">
                {initials(d.label ?? d.title ?? "")}
              </text>
            );
          })}
        </g>
      </svg>
      <p id={`${uid}-keys`} className="sr-only">
        {t("v5.con.keys")}
      </p>
      <p className="dc-legend">
        <span className="lg">
          <i className="dotz" aria-hidden />
          {t("v5.con.zone")} <b className="mono">{data.legend.inZone.toLocaleString()}</b>
        </span>
        <span className="lg">
          <i className="dotb" aria-hidden />
          {t("v5.con.below", { n: data.legend.threshold })}{" "}
          <b className="mono">{data.legend.below.toLocaleString()}</b>
        </span>
        <span className="lg perdot">
          {tn(data.legend.perDot, "v5.con.perdot.one", "v5.con.perdot.other", {
            k: data.legend.perDot,
          })}
        </span>
      </p>
    </div>
  );
}
