import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api";
import { useI18n } from "../i18n";
import { pageLink } from "../lib/links";
import { useApp } from "../state";
import { v3 } from "../views/brains/api";
import { QUESTIONS_CHANGED } from "../views/waiting/events";
import { ActivityGrid } from "./ActivityGrid";
import { FitBars } from "./FitBars";
import { useDate } from "./hooks";
import { InsightCard, TwinTable } from "./InsightCard";
import { TimelineBars } from "./TimelineBars";
import type { Focus } from "./types";

const STATUS_DOT = { active: "#34d399", watch: "#f59e0b", dormant: "#8a8896" } as const;
const STATUSES = ["active", "watch", "dormant"] as const;

/**
 * The right-hand card: coverage bars, the timeline and the activity grid of the brain (an account
 * brain also has a status) or of the page selected on the map.
 */
export function FocusPanel({
  brainId,
  brainName,
  focus,
  now,
  onBack,
  onStatusSent,
}: {
  brainId: string;
  brainName: string;
  focus: Focus;
  now: string;
  onBack: () => void;
  onStatusSent: () => void;
}) {
  const { t, td } = useI18n();
  const { say } = useApp();
  const fmt = useDate();
  const [busy, setBusy] = useState(false);
  const isPage = focus.kind === "page";
  const type = td("v5.type", focus.type, focus.type.replace(/_/g, " "));
  const ok = focus.coverage.filter((r) => r.state === "ok").length;
  const headline = focus.coverage.length ? `${ok}/${focus.coverage.length}` : undefined;
  const total = focus.activity.days.reduce((n, d) => n + d.count, 0);
  const summary = [
    isPage
      ? t("v5.focus.coverage.page")
      : `${t("v5.focus.coverage")}: ${ok}/${focus.coverage.length}.`,
    t("v5.act.summary", {
      n: total,
      d: focus.activity.days.length,
      from: fmt(focus.activity.from),
      to: fmt(focus.activity.to),
    }),
  ].join(" ");

  const setStatus = async (value: (typeof STATUSES)[number]) => {
    if (busy || value === focus.status?.value) return;
    setBusy(true);
    try {
      await v3.pushPage(brainId, {
        title: "Account status",
        markdown: `# Account status\n\n## Summary\n- Status: ${t(`v5.status.${value}` as "v5.status.active")}\n`,
      });
      say(t("v5.status.sent"));
      window.dispatchEvent(new Event(QUESTIONS_CHANGED));
      onStatusSent();
    } catch (x) {
      say(x instanceof ApiError ? x.reason : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <InsightCard
      className="focus"
      testId="insight-focus"
      round
      icon={<span>{focus.title.slice(0, 2).toUpperCase()}</span>}
      title={focus.title}
      subtitle={t("v5.focus.sub.brain", { type, brain: brainName })}
      control={
        isPage ? (
          <button type="button" className="icard-btn" onClick={onBack}>
            {t("v5.focus.back")}
          </button>
        ) : null
      }
      summary={summary}
      table={
        <>
          <TwinTable
            caption={isPage ? t("v5.focus.coverage.page") : t("v5.focus.coverage")}
            head={[t("v5.table.section"), t("v5.table.value"), t("v5.table.target")]}
            rows={focus.coverage.map((r) => [r.label, r.value, r.target])}
          />
          <TwinTable
            caption={
              isPage
                ? t("v5.focus.timeline.page")
                : focus.type === "account"
                  ? t("v5.focus.timeline.account")
                  : t("v5.focus.timeline")
            }
            head={[t("v5.table.bar"), t("v5.table.start"), t("v5.table.end")]}
            rows={focus.timeline.map((b) => [b.label, fmt(b.start), fmt(b.end)])}
          />
        </>
      }
      footer={
        <div className="icard-f focus-actions">
          <Link
            className="icard-btn"
            to={
              isPage && focus.pageId
                ? pageLink(brainId, focus.pageId)
                : `/brains/${encodeURIComponent(brainId)}`
            }
          >
            {isPage ? t("v5.focus.open.page") : t("v5.focus.open.brain")}
          </Link>
          <Link className="icard-btn solid" to="/?ask=1#ask">
            {t("v5.focus.ask")}
          </Link>
        </div>
      }
    >
      {focus.coverage.length ? (
        <FitBars
          rows={focus.coverage}
          title={isPage ? t("v5.focus.coverage.page") : t("v5.focus.coverage")}
          {...(headline ? { headline } : {})}
        />
      ) : null}
      {focus.timeline.length ? (
        <TimelineBars
          bars={focus.timeline}
          now={now}
          title={
            isPage
              ? t("v5.focus.timeline.page")
              : focus.type === "account"
                ? t("v5.focus.timeline.account")
                : t("v5.focus.timeline")
          }
          label={t("v5.focus.timeline")}
        />
      ) : null}
      <ActivityGrid
        data={focus.activity}
        title={t("v5.focus.activity")}
        sub={t("v5.focus.activity.sub")}
        label={t("v5.focus.activity")}
      />
      {focus.status ? (
        <label className="status5">
          <i style={{ background: STATUS_DOT[focus.status.value] }} aria-hidden />
          <span className="status5-l">{t("v5.status.label")}</span>
          <select
            value={focus.status.value}
            disabled={busy}
            aria-label={`${t("v5.status.label")}. ${t("v5.status.note")}`}
            onChange={(e) => setStatus(e.target.value as (typeof STATUSES)[number])}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`v5.status.${s}` as "v5.status.active")}
              </option>
            ))}
          </select>
          {focus.status.since ? (
            <span className="status5-s">
              {t("v5.status.since", { date: fmt(focus.status.since, { dateStyle: "medium" }) })}
            </span>
          ) : null}
          <ChevronDown size={16} aria-hidden className="status5-c" />
        </label>
      ) : null}
    </InsightCard>
  );
}
