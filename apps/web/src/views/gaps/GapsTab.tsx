import { AlertTriangle, Check, CircleHelp, FilePlus, GitMerge, UserPlus, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ErrorBox, Skeleton } from "../../components/ui";
import { type Key, useI18n } from "../../i18n";
import { InsightCard, TwinTable } from "../../insights/InsightCard";
import { KpiTile } from "../../insights/KpiTile";
import { Segmented } from "../../insights/Segmented";
import { ago } from "../../lib/time";
import { useApi } from "../../useApi";
import { gapsApi } from "./api";
import { AssignDialog, DismissDialog, MergeDialog, StartDialog } from "./Dialogs";
import { GapDots } from "./GapDots";
import type { Gap, GapKpi } from "./types";
import "./gaps.css";

type Filter = "active" | "closed" | "dismissed";
type Open = { kind: "start" | "assign" | "merge" | "dismiss"; gap: Gap } | null;

export const useDue = () => {
  const { locale } = useI18n();
  return (d: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
      new Date(`${d}T00:00:00Z`),
    );
};

export function Rate({ kpi }: { kpi: GapKpi }) {
  const { t } = useI18n();
  return kpi.closureRate === null ? t("v8g.kpi.rate.none") : `${kpi.closureRate}%`;
}

function Status({ g }: { g: Gap }) {
  const { t } = useI18n();
  const due = useDue();
  if (g.status === "closed")
    return (
      <span className="gp-st closed">
        <Check size={13} aria-hidden /> {t("v8g.status.closed")}
      </span>
    );
  if (g.status === "dismissed")
    return (
      <span className="gp-st dismissed">
        <X size={13} aria-hidden />{" "}
        {t("v8g.status.dismissed", {
          reason: g.dismissedReason ? t(`v8g.reason.${g.dismissedReason}` as Key) : "",
        })}
      </span>
    );
  if (g.status === "drafted")
    return (
      <span className="gp-st drafted">
        <FilePlus size={13} aria-hidden /> {t("v8g.status.drafted")}
        {g.proposalId ? (
          <>
            {" "}
            <Link to={`/waiting/${encodeURIComponent(g.proposalId)}`}>{t("v8g.draft.open")}</Link>
          </>
        ) : null}
      </span>
    );
  if (g.status === "assigned" && g.due)
    return g.overdue ? (
      <span className="gp-st overdue">
        <AlertTriangle size={13} aria-hidden /> {t("v8g.status.overdue", { due: due(g.due) })}
        {g.assignedTo?.name ? ` · ${g.assignedTo.name}` : ""}
      </span>
    ) : (
      <span className="gp-st assigned">
        <UserPlus size={13} aria-hidden />{" "}
        {g.assignedTo?.name
          ? t("v8g.status.assigned", { name: g.assignedTo.name, due: due(g.due) })
          : t("v8g.status.assigned.noname", { due: due(g.due) })}
      </span>
    );
  return (
    <span className="gp-st open">
      <CircleHelp size={13} aria-hidden /> {t("v8g.status.open")}
    </span>
  );
}

const SOURCES = ["ask", "agent", "search"] as const;

function Row({
  g,
  steward,
  act,
}: {
  g: Gap;
  steward: boolean;
  act: (kind: NonNullable<Open>["kind"], g: Gap) => void;
}) {
  const { t, tn } = useI18n();
  const live = g.status === "open" || g.status === "assigned";
  const label = (k: Key) => t("v8g.act.for", { action: t(k), text: g.text });
  return (
    <li className="gp-row" data-testid="gap-row" data-status={g.status}>
      <div className="gp-main">
        <p className="gp-q">{g.text}</p>
        <p className="gp-meta">
          <span className="mono">{tn(g.count, "v8g.asks.one", "v8g.asks.other")}</span>
          <span className="mono">{tn(g.askers, "v8g.askers.one", "v8g.askers.other")}</span>
          <span>{t("v8g.last", { when: ago(g.lastAt) })}</span>
          {g.mergedFrom ? <span>{t("v8g.merged", { n: g.mergedFrom })}</span> : null}
          {g.reopened ? <span>{t("v8g.reopened")}</span> : null}
        </p>
        <p className="gp-chips">
          {SOURCES.filter((s) => g.bySource[s] > 0).map((s) => (
            <span key={s} className={`gp-chip src-${s}`}>
              {t(`v8g.source.${s}` as Key)} <b className="mono">{g.bySource[s]}</b>
            </span>
          ))}
          <Status g={g} />
        </p>
      </div>
      <div className="gp-side">
        <GapDots days={g.days} />
        {live || g.status === "drafted" ? (
          <div className="gp-acts">
            {live ? (
              <button
                type="button"
                className="icard-btn solid sm"
                aria-label={label("v8g.act.start")}
                onClick={() => act("start", g)}
              >
                <FilePlus size={14} aria-hidden /> {t("v8g.act.start")}
              </button>
            ) : null}
            {steward ? (
              <>
                {live ? (
                  <button
                    type="button"
                    className="icard-btn sm"
                    aria-label={label("v8g.act.assign")}
                    onClick={() => act("assign", g)}
                  >
                    <UserPlus size={14} aria-hidden /> {t("v8g.act.assign")}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="icard-btn sm"
                  aria-label={label("v8g.act.merge")}
                  onClick={() => act("merge", g)}
                >
                  <GitMerge size={14} aria-hidden /> {t("v8g.act.merge")}
                </button>
                <button
                  type="button"
                  className="icard-btn sm"
                  aria-label={label("v8g.act.dismiss")}
                  onClick={() => act("dismiss", g)}
                >
                  <X size={14} aria-hidden /> {t("v8g.act.dismiss")}
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function EmptyArt() {
  return (
    <svg className="gp-art" viewBox="0 0 120 56" width="120" height="56" aria-hidden>
      {Array.from({ length: 14 }, (_, i) => (
        <circle
          key={`d${i}`}
          cx={8 + i * 8}
          cy={28 + Math.sin(i * 0.9) * 12}
          r={i === 9 ? 5 : 2.2}
          fill={i === 9 ? "#8b5cf6" : "#4a4a55"}
        />
      ))}
      <path d="M72 20 q8 -10 16 0 q8 10 0 16" fill="none" stroke="#8b5cf6" strokeWidth="1.5" />
    </svg>
  );
}

export function GapsTab({ brainId }: { brainId: string }) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<Filter>("active");
  const [open, setOpen] = useState<Open>(null);
  const list = useApi(() => gapsApi.list(brainId, filter), [brainId, filter]);
  const d = list.data;
  const rate = d
    ? d.kpi.closureRate === null
      ? t("v8g.kpi.rate.none")
      : `${d.kpi.closureRate}%`
    : "";
  const close = () => setOpen(null);
  const dueOf = useDue();
  const statusText = (g: Gap) =>
    t(`v8g.status.${g.status === "assigned" && g.overdue ? "overdue" : g.status}` as Key, {
      name: g.assignedTo?.name ?? "",
      due: g.due ? dueOf(g.due) : "",
      reason: g.dismissedReason ? t(`v8g.reason.${g.dismissedReason}` as Key) : "",
    });
  return (
    <div className="gaps" data-testid="gaps-tab">
      {list.error ? <ErrorBox message={list.error} onRetry={list.reload} /> : null}
      {list.loading && !d ? (
        <Skeleton n={3} />
      ) : d ? (
        <InsightCard
          testId="insight-gaps"
          icon={<CircleHelp size={20} aria-hidden />}
          title={t("v8g.title")}
          subtitle={t("v8g.sub")}
          control={
            <Segmented<Filter>
              label={t("v8g.filter")}
              value={filter}
              onChange={setFilter}
              options={[
                { value: "active", label: t("v8g.filter.active") },
                { value: "closed", label: t("v8g.filter.closed") },
                { value: "dismissed", label: t("v8g.filter.dismissed") },
              ]}
            />
          }
          summary={
            d.gaps.length
              ? t("v8g.summary", {
                  n: d.gaps.length,
                  days: d.kpi.windowDays,
                  rate,
                  open: d.kpi.open,
                  assigned: d.kpi.assigned,
                  drafted: d.kpi.drafted,
                  closed: d.kpi.closed,
                  overdue: d.kpi.overdue,
                })
              : t("v8g.summary.empty")
          }
          table={
            <TwinTable
              caption={t("v8g.table.caption")}
              head={[
                t("v8g.table.q"),
                t("v8g.table.asks"),
                t("v8g.table.people"),
                t("v8g.table.last"),
                t("v8g.table.sources"),
                t("v8g.table.status"),
              ]}
              rows={d.gaps.map((g) => [
                g.text,
                g.days.reduce((a, x) => a + x.count, 0),
                g.askers,
                ago(g.lastAt),
                SOURCES.filter((s) => g.bySource[s] > 0)
                  .map((s) => `${t(`v8g.source.${s}` as Key)} ${g.bySource[s]}`)
                  .join(", "),
                statusText(g),
              ])}
            />
          }
        >
          <div className="kpis gp-kpis">
            <KpiTile testId="gap-rate" value={rate} label={t("v8g.kpi.rate")} />
            <KpiTile value={String(d.kpi.open)} label={t("v8g.kpi.open")} />
            <KpiTile value={String(d.kpi.assigned)} label={t("v8g.kpi.assigned")} />
            <KpiTile value={String(d.kpi.drafted)} label={t("v8g.kpi.drafted")} />
            <KpiTile value={String(d.kpi.closed)} label={t("v8g.kpi.closed")} />
            <KpiTile value={String(d.kpi.overdue)} label={t("v8g.kpi.overdue")} />
          </div>
          <p className="gp-window mono">{t("v8g.window", { n: d.kpi.windowDays })}</p>
          {d.gaps.length ? (
            <ol className="gp-rows" aria-label={t("v8g.list")}>
              {d.gaps.map((g) => (
                <Row
                  key={g.id}
                  g={g}
                  steward={d.canSteward}
                  act={(kind, gap) => setOpen({ kind, gap })}
                />
              ))}
            </ol>
          ) : (
            <div className="icard-empty gp-empty">
              <EmptyArt />
              <p>
                <b>
                  {filter === "active" && !d.kpi.closed && !d.kpi.dismissed
                    ? t("v8g.empty.title")
                    : t("v8g.empty.filtered")}
                </b>
              </p>
              <p>
                {filter === "active" && !d.kpi.closed && !d.kpi.dismissed
                  ? t("v8g.empty.lead")
                  : t("v8g.empty.filtered.lead")}
              </p>
            </div>
          )}
        </InsightCard>
      ) : null}
      {d && open?.kind === "start" ? (
        <StartDialog brain={brainId} gap={open.gap} onClose={close} onDone={list.reload} />
      ) : null}
      {d && open?.kind === "assign" ? (
        <AssignDialog
          brain={brainId}
          gap={open.gap}
          eligible={d.eligible}
          onClose={close}
          onDone={list.reload}
        />
      ) : null}
      {d && open?.kind === "merge" ? (
        <MergeDialog
          brain={brainId}
          gap={open.gap}
          others={d.gaps.filter((g) => g.id !== open.gap.id && g.status !== "dismissed")}
          onClose={close}
          onDone={list.reload}
        />
      ) : null}
      {d && open?.kind === "dismiss" ? (
        <DismissDialog brain={brainId} gap={open.gap} onClose={close} onDone={list.reload} />
      ) : null}
    </div>
  );
}
