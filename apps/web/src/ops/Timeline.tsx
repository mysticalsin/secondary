import { type KeyboardEvent, type PointerEvent, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { useUid } from "../insights/hooks";
import { TwinTable } from "../insights/InsightCard";
import { dayLabel, hm, ruleName } from "./format";
import type { ActivityBucket, ActivityWindow, Callout, OpsStatus } from "./types";

/** Stack order from the bottom: published, needs review, retrying, blocked, failed. */
const ORDER: OpsStatus[] = ["published", "needs_review", "retrying", "blocked", "failed"];
const MAX_DOTS = 14;
const W = 1000;
const ROW = 8;
const R = 2.8;
const H = MAX_DOTS * ROW + 6;

export type Range = [number, number];

/** Dots per status for one column: at most 14 in all, and one at least for any status that occurred. */
export function dotsOf(
  counts: Record<OpsStatus, number>,
  perDot: number,
): Record<OpsStatus, number> {
  const out: Record<OpsStatus, number> = {
    published: 0,
    needs_review: 0,
    retrying: 0,
    blocked: 0,
    failed: 0,
  };
  const total = ORDER.reduce((n, s) => n + counts[s], 0);
  if (!total) return out;
  const want = Math.min(MAX_DOTS, Math.ceil(total / perDot));
  const exact = ORDER.map((s) => (counts[s] * want) / total);
  let left = want;
  ORDER.forEach((s, i) => {
    out[s] = Math.floor(exact[i] as number);
    left -= out[s];
  });
  const frac = (s: OpsStatus) => (exact[ORDER.indexOf(s)] as number) % 1;
  for (const s of [...ORDER].sort((a, b) => frac(b) - frac(a))) {
    if (left > 0 && counts[s] > 0) {
      out[s]++;
      left--;
    }
  }
  for (const s of ORDER) {
    if (counts[s] > 0 && out[s] === 0) {
      const big = ORDER.reduce((m, k) => (out[k] > out[m] ? k : m), ORDER[0] as OpsStatus);
      if (out[big] > 1) {
        out[big]--;
        out[s] = 1;
      }
    }
  }
  return out;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** The brush moves with the arrow keys. Pure, so it can be tested without a DOM. */
export function brushKey(
  key: string,
  mods: { shift: boolean; alt: boolean },
  range: Range | null,
  n: number,
): Range | null | undefined {
  if (key === "Escape") return range ? null : undefined;
  if (key !== "ArrowLeft" && key !== "ArrowRight") return undefined;
  const dir = key === "ArrowRight" ? 1 : -1;
  const w = Math.max(1, Math.round(n / 12));
  if (!range) return dir > 0 ? [0, w] : [n - w, n];
  let [a, b] = range;
  if (mods.shift) b = clamp(b + dir, a + 1, n);
  else if (mods.alt) a = clamp(a + dir, 0, b - 1);
  else if (a + dir >= 0 && b + dir <= n) {
    a += dir;
    b += dir;
  }
  return [a, b];
}

export function useStamp(win: ActivityWindow): (iso: string) => string {
  const { lang } = useI18n();
  return (iso) => (win === "7d" ? `${dayLabel(iso, lang)} ${hm(iso)}` : hm(iso));
}

/**
 * The dot timeline: one column per bucket, dots stacked from the bottom, a brush to pick a window
 * (pointer drag, or the keyboard: arrows move, Shift resizes the right edge, Alt the left, Escape
 * clears). The whole window always shows; the brush narrows the table, not the timeline.
 */
export function Timeline({
  buckets,
  perDot,
  win,
  callout,
  range,
  onRange,
}: {
  buckets: ActivityBucket[];
  perDot: number;
  win: ActivityWindow;
  callout: Callout | null;
  range: Range | null;
  onRange: (r: Range | null) => void;
}) {
  const { t, td } = useI18n();
  const stamp = useStamp(win);
  const uid = useUid();
  const n = buckets.length;
  const pitch = W / n;
  const surface = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    mode: "make" | "move" | "l" | "r";
    anchor: number;
    a: number;
    b: number;
    moved: boolean;
  } | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const cols = useMemo(
    () =>
      buckets.map((b) => {
        const d = dotsOf(b.counts, perDot);
        const list: OpsStatus[] = [];
        for (const s of ORDER) for (let k = 0; k < d[s]; k++) list.push(s);
        return list;
      }),
    [buckets, perDot],
  );

  const colAt = (clientX: number): number => {
    const box = surface.current?.getBoundingClientRect();
    if (!box?.width) return 0;
    return clamp(Math.floor(((clientX - box.left) / box.width) * n), 0, n - 1);
  };

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const c = colAt(e.clientX);
    const h = (e.target as HTMLElement).dataset.h;
    if (h === "l" && range)
      drag.current = { mode: "l", anchor: c, a: range[0], b: range[1], moved: false };
    else if (h === "r" && range)
      drag.current = { mode: "r", anchor: c, a: range[0], b: range[1], moved: false };
    else if (range && c >= range[0] && c < range[1])
      drag.current = { mode: "move", anchor: c, a: range[0], b: range[1], moved: false };
    else {
      drag.current = { mode: "make", anchor: c, a: c, b: c + 1, moved: false };
      onRange([c, c + 1]);
    }
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const c = colAt(e.clientX);
    setHover(c);
    const d = drag.current;
    if (!d) return;
    if (c !== d.anchor) d.moved = true;
    if (d.mode === "make") onRange([Math.min(d.anchor, c), Math.max(d.anchor, c) + 1]);
    else if (d.mode === "l") onRange([Math.min(c, d.b - 1), d.b]);
    else if (d.mode === "r") onRange([d.a, Math.max(c + 1, d.a + 1)]);
    else {
      const w = d.b - d.a;
      const a = clamp(d.a + (c - d.anchor), 0, n - w);
      onRange([a, a + w]);
    }
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    // A plain click inside the selection clears it.
    if (d && d.mode === "move" && !d.moved) onRange(null);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = brushKey(e.key, { shift: e.shiftKey, alt: e.altKey }, range, n);
    if (next === undefined) return;
    e.preventDefault();
    onRange(next);
  };

  const ticks = [0, 0.25, 0.5, 0.75].map((f) => Math.round(f * n));
  const last = buckets[n - 1] as ActivityBucket;
  const hb = hover !== null ? (buckets[hover] as ActivityBucket) : null;
  const sel = range ? rangeText(buckets, range, stamp) : "";
  const hoverText = hb
    ? t("v7o.tl.tip", {
        time: stamp(hb.start),
        n: hb.total,
        bad: hb.counts.blocked + hb.counts.failed + hb.counts.retrying,
      })
    : "";

  return (
    <div className="opx-tl">
      <div className="opx-tl-area">
        {callout ? (
          <div className="opx-callout" role="note">
            <span>
              {t(callout.kind === "blocked" ? "v7o.callout.blocked" : "v7o.callout.failed", {
                time: stamp(callout.since),
              })}
            </span>
            <b>
              {callout.label.includes("@")
                ? t("v7o.callout.rule", { name: ruleName(callout.label) })
                : td("v7o.reason", callout.label, callout.label)}
            </b>
          </div>
        ) : null}
        <div
          ref={surface}
          className="opx-brush"
          role="group"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the brush is a keyboard control
          tabIndex={0}
          aria-label={t("v7o.brush.label")}
          aria-describedby="opx-brush-help"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerLeave={() => setHover(null)}
          onKeyDown={key}
        >
          <svg viewBox={`0 0 ${W} ${H}`} className="opx-tl-svg" aria-hidden focusable="false">
            <defs>
              <pattern
                id={`${uid}-grid`}
                patternUnits="userSpaceOnUse"
                x={0}
                y={(((H - 4 - ROW / 2) % ROW) + ROW) % ROW}
                width={pitch}
                height={ROW}
              >
                <circle cx={pitch / 2} cy={ROW / 2} r={1.15} className="d-grid" />
              </pattern>
            </defs>
            <rect x={0} y={0} width={W} height={H} fill={`url(#${uid}-grid)`} />
            {cols.map((list, i) => (
              <g key={buckets[i]?.start} transform={`translate(${i * pitch + pitch / 2},0)`}>
                {list.map((s, k) => (
                  <circle
                    // biome-ignore lint/suspicious/noArrayIndexKey: dots are stacked by position
                    key={k}
                    cx={0}
                    cy={H - 4 - k * ROW}
                    r={R}
                    className={`d-${s}`}
                  />
                ))}
              </g>
            ))}
          </svg>
          {range ? (
            <div
              className="opx-sel"
              style={{
                left: `${(range[0] / n) * 100}%`,
                width: `${((range[1] - range[0]) / n) * 100}%`,
              }}
            >
              <i className="h l" data-h="l" />
              <i className="h r" data-h="r" />
            </div>
          ) : null}
          {hb && hover !== null ? (
            <div
              className="opx-tip"
              style={{ left: `clamp(110px, ${((hover + 0.5) / n) * 100}%, calc(100% - 110px))` }}
              aria-hidden
            >
              {hoverText}
            </div>
          ) : null}
        </div>
        <p id="opx-brush-help" className="sr-only">
          {t("v7o.brush.help")}
        </p>
      </div>
      <div className="opx-axis" aria-hidden>
        {ticks.map((i) => (
          <span key={i} style={{ left: `${(i / n) * 100}%` }}>
            {stamp((buckets[i] as ActivityBucket).start)}
          </span>
        ))}
        <span className="end">{stamp(last.end)}</span>
      </div>
      <span className="sr-only" role="status">
        {range ? t("v7o.brush.selected", { range: sel }) : ""}
      </span>
    </div>
  );
}

/** The selection as the readout text, for example `11:00-11:05`. */
export function rangeText(
  buckets: ActivityBucket[],
  range: Range,
  stamp: (iso: string) => string,
): string {
  return `${stamp((buckets[range[0]] as ActivityBucket).start)}-${stamp((buckets[range[1] - 1] as ActivityBucket).end)}`;
}

/** The table twin of the timeline: counts per bucket. */
export function TimelineTwin({ buckets, win }: { buckets: ActivityBucket[]; win: ActivityWindow }) {
  const { t, td } = useI18n();
  const stamp = useStamp(win);
  return (
    <TwinTable
      caption={t("v7o.tl.twin")}
      head={[
        t("v7o.tl.col.time"),
        ...(["published", "needs_review", "blocked", "failed", "retrying"] as OpsStatus[]).map(
          (s) => td("v7o.status", s),
        ),
        t("v7o.tl.col.total"),
      ]}
      rows={buckets.map((b) => [
        stamp(b.start),
        b.counts.published,
        b.counts.needs_review,
        b.counts.blocked,
        b.counts.failed,
        b.counts.retrying,
        b.total,
      ])}
    />
  );
}
