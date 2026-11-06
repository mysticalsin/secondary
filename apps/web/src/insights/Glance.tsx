import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Await, Empty } from "../components/ui";
import { useI18n } from "../i18n";
import { brainLink } from "../lib/links";
import { useApi } from "../useApi";
import { insightsApi } from "./api";
import { CANVAS, layoutConstellation } from "./layout";
import { CARD } from "./palette";
import type { OverviewTile } from "./types";

function Spark({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(1, ...values);
  const w = 120;
  const h = 26;
  const pts = values.map(
    (v, i) => [(i / Math.max(1, values.length - 1)) * w, h - 3 - (v / max) * (h - 8)] as const,
  );
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="gl-spark" role="img" aria-label={label}>
      <path d={`${line} L${w} ${h} L0 ${h} Z`} fill={CARD.inZone} opacity={0.18} />
      <path d={line} fill="none" stroke={CARD.inZone} strokeWidth={1.6} strokeLinejoin="round" />
      <circle cx={pts.at(-1)?.[0] ?? 0} cy={pts.at(-1)?.[1] ?? 0} r={2.2} fill="#fff" />
    </svg>
  );
}

function MiniMap({ tile, label }: { tile: OverviewTile; label: string }) {
  const g = useMemo(() => {
    const sectorIds = Array.from({ length: Math.max(1, tile.sectors) }, (_, n) => String(n));
    const dots = tile.dots.map((d) => ({
      pageId: null,
      sector: String(d.s),
      r: d.r,
      score: Math.round(100 - d.r * d.r * 60),
      k: d.k,
      inZone: d.z,
    }));
    return { dots, geo: layoutConstellation(dots, sectorIds, [70], tile.seed, 20) };
  }, [tile]);
  return (
    <svg viewBox={`0 0 ${CANVAS.w} ${CANVAS.h}`} className="gl-map" role="img" aria-label={label}>
      <circle
        cx={CANVAS.cx}
        cy={CANVAS.cy}
        r={CANVAS.R}
        fill="none"
        stroke={CARD.grid}
        strokeWidth={3}
      />
      <circle
        cx={CANVAS.cx}
        cy={CANVAS.cy}
        r={g.geo.ringR[0] ?? 150}
        fill="none"
        stroke={CARD.inZone}
        strokeOpacity={0.6}
        strokeWidth={3}
        strokeDasharray="12 12"
      />
      {g.geo.placed.map((p, i) => (
        <circle
          key={p.i}
          cx={p.x}
          cy={p.y}
          r={g.dots[i]?.k && g.dots[i].k > 1 ? 9 : 7.5}
          fill={g.dots[i]?.inZone ? CARD.inZone : CARD.below}
          opacity={g.dots[i]?.inZone ? 1 : 0.75}
        />
      ))}
    </svg>
  );
}

function Tile({ b, name }: { b: OverviewTile; name: string }) {
  const { t, tn } = useI18n();
  return (
    <li className="gl-tile">
      <Link to={`${brainLink(b.id)}?tab=insights`} className="gl-link">
        <div className="gl-h">
          <b>{name}</b>
          <span className="gl-score mono">{t("v5.glance.health", { n: b.health.score })}</span>
        </div>
        <MiniMap tile={b} label={t("v5.glance.map", { name, z: b.zone.inZone, t: b.zone.total })} />
        <Spark values={b.sparkline} label={t("v5.glance.spark")} />
        <p className="gl-f">
          <span>{tn(b.pages, "v5.glance.pages.one", "v5.glance.pages.other")}</span>
          <span className="mono">{t("v5.glance.zone", { n: b.zone.inZone })}</span>
        </p>
      </Link>
    </li>
  );
}

/** "Your brains at a glance": one small constellation per brain the person can open. Each tile is one brain's own numbers. */
export function Glance({ minTiles = 1 }: { minTiles?: number }) {
  const { t } = useI18n();
  const state = useApi(() => insightsApi.overview(), []);
  if (state.data && state.data.brains.length < minTiles) return null;
  return (
    <section className="hsec glance" aria-labelledby="gl-h" data-testid="glance">
      <div className="sec-head">
        <div>
          <h2 id="gl-h">{t("v5.glance.title")}</h2>
          <p className="muted">{t("v5.glance.lead")}</p>
        </div>
      </div>
      <Await state={state} skeleton={2}>
        {({ brains }) =>
          brains.length ? (
            <ul className="gl-grid">
              {brains.map((b) => (
                <Tile key={b.id} b={b} name={b.id === "me" ? t("v4.personal") : b.name} />
              ))}
            </ul>
          ) : (
            <Empty title={t("v5.glance.none")} />
          )
        }
      </Await>
    </section>
  );
}
