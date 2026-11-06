import { Activity, ChartNoAxesColumn, Search, Table2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { useUid } from "../insights/hooks";
import { Segmented } from "../insights/Segmented";
import { useApi } from "../useApi";
import { ops } from "./api";
import { EventDetailPanel } from "./EventDetail";
import { EventsTable } from "./EventsTable";
import { num } from "./format";
import { type Range, rangeText, Timeline, TimelineTwin, useStamp } from "./Timeline";
import type { ActivityWindow, StatusFilter } from "./types";
import { StateBox, Swatch, SyntheticChip, useDebounced } from "./ui";

type Props =
  | { mode: "brain"; brainId: string; host?: undefined }
  | { mode: "agent"; brainId?: undefined; host?: string | undefined };

/** True when a key press should open search: "/" outside any text field. */
export function isSlashTarget(
  e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "target">,
): boolean {
  if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return false;
  const el = e.target as HTMLElement | null;
  if (!el) return true;
  const tag = el.tagName;
  return !(tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable);
}

/**
 * The activity log: dot timeline with a brush, filters, search, the event table and a detail panel.
 * `mode="brain"` is Brain > Activity (managers, with retry). `mode="agent"` is the person's own
 * agent calls in Settings (no retry, no brain).
 */
export function ActivityPanel(props: Props) {
  const { t, td, locale } = useI18n();
  const uid = useUid();
  const search = useRef<HTMLInputElement>(null);
  const [win, setWin] = useState<ActivityWindow>("60m");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [raw, setRaw] = useState("");
  const q = useDebounced(raw);
  const [range, setRange] = useState<Range | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [asTable, setAsTable] = useState(false);
  const stamp = useStamp(win);
  const brainId = props.brainId;
  const host = props.host;
  const agent = props.mode === "agent";

  // The brush selects columns of the last answer. Its span goes to the API as from/to.
  const [span, setSpan] = useState<{ from: string; to: string } | null>(null);
  const act = useApi(() => {
    const base = { window: win, status, q, from: span?.from, to: span?.to, host };
    return agent ? ops.agentActivity(base) : ops.brainActivity(brainId as string, base);
  }, [agent, brainId, host, win, status, q, span?.from, span?.to]);
  const data = act.data;

  // "/" focuses search, as in the reference.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isSlashTarget(e)) return;
      e.preventDefault();
      search.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const buckets = data?.buckets;
  const pickRange = (r: Range | null) => {
    setRange(r);
    if (r && buckets) {
      setSpan({
        from: (buckets[r[0]] as { start: string }).start,
        to: (buckets[r[1] - 1] as { end: string }).end,
      });
    } else setSpan(null);
  };
  const pickWindow = (w: ActivityWindow) => {
    setWin(w);
    setRange(null);
    setSpan(null);
    setSelected(null);
  };
  const reset = () => {
    setStatus("all");
    setRaw("");
    setRange(null);
    setSpan(null);
  };

  const selectedEvent = useMemo(
    () => data?.events.find((e) => e.id === selected) ?? null,
    [data, selected],
  );
  const winLabel = t(`v7o.win.${win}` as "v7o.win.60m");
  const filters: { value: StatusFilter; label: string }[] = [
    { value: "all", label: t("v7o.filter.all") },
    { value: "needs_review", label: t("v7o.filter.needs_review") },
    { value: "blocked", label: t("v7o.filter.blocked") },
    { value: "failed", label: t("v7o.filter.failed") },
  ];
  const wins: { value: ActivityWindow; label: string }[] = [
    { value: "60m", label: t("v7o.win.short.60m") },
    { value: "24h", label: t("v7o.win.short.24h") },
    { value: "7d", label: t("v7o.win.short.7d") },
  ];
  const err403 = act.status === 403 || act.status === 404;

  return (
    <section
      className="icard opx opx-act"
      aria-labelledby={`${uid}-h`}
      data-testid={agent ? "agent-activity" : "ops-activity"}
      aria-busy={act.loading}
    >
      <header className="icard-h">
        <span className="icard-ico" aria-hidden>
          <Activity size={20} />
        </span>
        <div className="icard-t">
          <h3 id={`${uid}-h`}>
            <span className="crumb">
              {agent ? t("v7o.act.crumb.agent") : t("v7o.act.crumb.brain")}
            </span>
            <span className="slash" aria-hidden>
              /
            </span>{" "}
            {t("v7o.act.title")}
          </h3>
          {data?.synthetic ? <SyntheticChip /> : null}
        </div>
        <div className="opx-ctl">
          <label className="opx-search">
            <Search size={16} aria-hidden />
            <input
              ref={search}
              type="search"
              value={raw}
              maxLength={80}
              onChange={(e) => setRaw(e.target.value)}
              aria-label={t("v7o.search.label")}
              placeholder={t("v7o.search.ph")}
              aria-keyshortcuts="/"
            />
            <kbd aria-hidden>/</kbd>
          </label>
          <Segmented
            value={status}
            options={filters}
            onChange={(v) => {
              setStatus(v);
              setSelected(null);
            }}
            label={t("v7o.filter.label")}
          />
        </div>
      </header>

      {act.error && !data ? (
        <div className="icard-b">
          <StateBox
            kind="error"
            title={err403 ? t("v7o.err.forbidden") : t("v7o.err.load")}
            hint={err403 ? t("v7o.err.forbidden.hint") : act.error}
            action={
              err403 ? undefined : (
                <button type="button" className="icard-btn" onClick={act.reload}>
                  {t("v7o.retry")}
                </button>
              )
            }
          />
        </div>
      ) : !data ? (
        <div className="icard-b">
          <StateBox kind="loading" title={t("v7o.loading.activity")} />
        </div>
      ) : (
        <>
          <div className="opx-tl-head">
            <p className="opx-cap">
              <span>{t("v7o.tl.last", { win: winLabel })}</span>{" "}
              <span className="mute">{t("v7o.tl.perdot", { k: num(data.perDot, locale) })}</span>
            </p>
            <div className="opx-tl-ctl">
              <Segmented
                value={win}
                options={wins}
                onChange={pickWindow}
                label={t("v7o.win.label")}
              />
              <button
                type="button"
                className="icard-tw"
                aria-pressed={asTable}
                aria-label={asTable ? t("v5.chart.show") : t("v5.table.show")}
                title={asTable ? t("v5.chart.show") : t("v5.table.show")}
                onClick={() => setAsTable((x) => !x)}
              >
                {asTable ? (
                  <ChartNoAxesColumn size={16} aria-hidden />
                ) : (
                  <Table2 size={16} aria-hidden />
                )}
              </button>
            </div>
            <p className="opx-selected" data-testid="selected-range">
              {range ? t("v7o.tl.selected", { range: rangeText(data.buckets, range, stamp) }) : ""}
            </p>
          </div>
          <div className="opx-tl-wrap">
            {asTable ? (
              <TimelineTwin buckets={data.buckets} win={win} />
            ) : (
              <Timeline
                buckets={data.buckets}
                perDot={data.perDot}
                win={win}
                callout={data.callout}
                range={range}
                onRange={pickRange}
              />
            )}
          </div>

          {data.events.length === 0 ? (
            <StateBox
              kind="empty"
              title={t("v7o.empty.title")}
              hint={t("v7o.empty.hint")}
              action={
                <button type="button" className="icard-btn" onClick={reset}>
                  {t("v7o.empty.reset")}
                </button>
              }
            />
          ) : (
            <EventsTable events={data.events} selectedId={selected} onSelect={setSelected} />
          )}
          {act.error ? (
            <p className="opx-err" role="alert">
              {act.error}
            </p>
          ) : null}

          {selectedEvent ? (
            <EventDetailPanel
              key={selectedEvent.id}
              event={selectedEvent}
              load={(id) => (agent ? ops.agentEvent(id) : ops.brainEvent(brainId as string, id))}
              retry={agent ? undefined : (id) => ops.retryEvent(brainId as string, id)}
            />
          ) : null}

          <footer className="opx-foot">
            <ul className="opx-legend" aria-label={t("v7o.legend")}>
              <li>
                <Swatch kind="ok" /> {td("v7o.status", "published")}
              </li>
              <li>
                <Swatch kind="warn" /> {td("v7o.status", "needs_review")}
              </li>
              <li>
                <Swatch kind="fail" /> {t("v7o.legend.badfail")}
              </li>
              <li>
                <Swatch kind="retry" /> {td("v7o.status", "retrying")}
              </li>
            </ul>
            <p className="mute mono" data-testid="shown-count">
              {t("v7o.act.count", {
                n: num(data.events.length, locale),
                total: num(data.totals.matching, locale),
                win: winLabel,
              })}
            </p>
          </footer>
        </>
      )}
    </section>
  );
}
