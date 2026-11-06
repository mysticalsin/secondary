import { type KeyboardEvent, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { TwinTable } from "../insights/InsightCard";
import { dayLabel, hm, ruleName } from "./format";
import type { HealthResponse, HealthWindow, HeatCell } from "./types";

/** The tooltip for a cell: `Bid & Pre-sales · 11:00 · 12 blocked · client-name rule`. */
export function useCellText(win: HealthWindow) {
  const { t, td, lang } = useI18n();
  const col = (iso: string) => (win === "7d" ? `${dayLabel(iso, lang)} ${hm(iso)}` : hm(iso));
  return {
    col,
    text(label: string, iso: string, c: HeatCell): string {
      const head = `${label} · ${col(iso)}`;
      if (c.failed === 0) return `${head} · ${t("v7o.heat.tip.attempts", { n: c.attempts })}`;
      if (c.topReason === "blocked_by_rule")
        return `${head} · ${t("v7o.heat.tip.blocked", { n: c.failed })}${
          c.ruleRef ? ` · ${t("v7o.callout.rule", { name: ruleName(c.ruleRef) })}` : ""
        }`;
      return `${head} · ${t("v7o.heat.tip.failed", { n: c.failed })}${
        c.topReason ? ` · ${td("v7o.reason", c.topReason)}` : ""
      }`;
    },
  };
}

const CELL_H = 26;

/**
 * Attempts by brain or source and column: a bar per cell (height is the attempts), magenta for a failing
 * hour. One tab stop; arrow keys, Home and End move between cells, and the tooltip follows focus.
 */
export function Heatmap({ heat, win }: { heat: HealthResponse["heatmap"]; win: HealthWindow }) {
  const { t } = useI18n();
  const { col, text } = useCellText(win);
  const rows = heat.rows;
  const n = heat.columns.length;
  const [pos, setPos] = useState<[number, number]>(() => {
    // Start on the first failing cell, else the top left one.
    for (let r = 0; r < rows.length; r++) {
      const c = (rows[r]?.cells ?? []).findIndex((x) => x.failing);
      if (c >= 0) return [r, c];
    }
    return [0, 0];
  });
  const [tip, setTip] = useState<[number, number] | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const max = useMemo(
    () => Math.max(1, ...rows.flatMap((r) => r.cells.map((c) => c.attempts))),
    [rows],
  );
  const maxRow = useMemo(() => Math.max(1, ...rows.map((r) => r.total)), [rows]);
  const every = win === "1h" ? 3 : win === "24h" ? 6 : 4;

  const focusCell = (r: number, c: number) => {
    setPos([r, c]);
    setTip([r, c]);
    grid.current?.querySelector<HTMLElement>(`[data-cell="${r}-${c}"]`)?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const [r, c] = pos;
    const move: Record<string, [number, number]> = {
      ArrowRight: [r, Math.min(n - 1, c + 1)],
      ArrowLeft: [r, Math.max(0, c - 1)],
      ArrowDown: [Math.min(rows.length - 1, r + 1), c],
      ArrowUp: [Math.max(0, r - 1), c],
      Home: [r, 0],
      End: [r, n - 1],
    };
    const to = move[e.key];
    if (!to) return;
    e.preventDefault();
    focusCell(to[0], to[1]);
  };
  const tipRow = tip ? rows[tip[0]] : undefined;
  const tipCell = tip && tipRow ? tipRow.cells[tip[1]] : undefined;
  const tipIso = tip ? heat.columns[tip[1]] : undefined;
  const tipText = tipRow && tipCell && tipIso ? text(tipRow.label, tipIso, tipCell) : "";
  const left = tip
    ? `clamp(120px, calc(var(--opx-lab) + (100% - var(--opx-lab) - var(--opx-end)) * ${(tip[1] + 0.5) / n}), calc(100% - 120px))`
    : "0";

  return (
    <div className="opx-heat">
      <div className="opx-heat-scroll" role="region" aria-label={t("v7o.heat.region")}>
        <div
          ref={grid}
          className="opx-heat-grid"
          role="grid"
          aria-label={t("v7o.heat.label")}
          aria-rowcount={rows.length}
          aria-colcount={n}
          onKeyDown={onKey}
          onMouseLeave={() => setTip(null)}
        >
          {tip && tipText ? (
            <div
              className="opx-heat-tip"
              style={{ left, top: `${46 + tip[0] * 34 - 6}px` }}
              role="tooltip"
              data-testid="heat-tip"
            >
              {tipText}
            </div>
          ) : null}
          {rows.map((r, ri) => (
            <div
              key={`${r.kind}:${r.id}`}
              className="opx-heat-row"
              role="row"
              aria-rowindex={ri + 1}
            >
              <span className="opx-heat-lab" role="rowheader">
                {r.label}
                <i className="sr-only">
                  {" "}
                  ({r.kind === "brain" ? t("v7o.heat.brain") : t("v7o.heat.source")})
                </i>
              </span>
              <div className="opx-heat-cells">
                {r.cells.map((c, ci) => {
                  const iso = heat.columns[ci] as string;
                  const h =
                    c.attempts === 0 ? 0 : Math.max(3, Math.round((c.attempts / max) * CELL_H));
                  const active = ri === pos[0] && ci === pos[1];
                  return (
                    <span
                      key={iso}
                      role="gridcell"
                      aria-colindex={ci + 1}
                      aria-label={`${text(r.label, iso, c)}${c.failing ? ` (${t("v7o.heat.failing")})` : ""}`}
                      data-cell={`${ri}-${ci}`}
                      data-failing={c.failing || undefined}
                      tabIndex={active ? 0 : -1}
                      className={`opx-hc${c.failing ? " failing" : ""}`}
                      onFocus={() => {
                        setPos([ri, ci]);
                        setTip([ri, ci]);
                      }}
                      onMouseEnter={() => setTip([ri, ci])}
                    >
                      {h ? <i style={{ height: h }} /> : null}
                      {!c.failing && c.failed > 1 && c.failed / c.attempts >= 0.05 ? <b /> : null}
                    </span>
                  );
                })}
              </div>
              <span className="opx-heat-end" aria-hidden>
                <i
                  className={r.cells.some((c) => c.failing) ? "bad" : ""}
                  style={{ width: `${Math.max(8, (r.total / maxRow) * 100)}%` }}
                />
              </span>
            </div>
          ))}
          <div className="opx-heat-axis" aria-hidden>
            <span className="opx-heat-lab" />
            <div className="opx-heat-ticks">
              {heat.columns.map((iso, i) =>
                i % every === 0 ? (
                  <span key={iso} style={{ left: `${(i / n) * 100}%` }}>
                    {col(iso)}
                  </span>
                ) : null,
              )}
            </div>
            <span className="opx-heat-end" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** The heatmap as a table: one row per brain or source, one column per time, `attempts (failed)`. */
export function HeatTwin({ heat, win }: { heat: HealthResponse["heatmap"]; win: HealthWindow }) {
  const { t } = useI18n();
  const { col } = useCellText(win);
  return (
    <TwinTable
      caption={t("v7o.heat.twin")}
      head={[t("v7o.heat.col.row"), ...heat.columns.map((c) => col(c))]}
      rows={heat.rows.map((r) => [
        r.label,
        ...r.cells.map((c) =>
          c.failed > 0 ? t("v7o.heat.cell", { a: c.attempts, f: c.failed }) : String(c.attempts),
        ),
      ])}
    />
  );
}
