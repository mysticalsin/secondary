import { RotateCcw } from "lucide-react";
import { type Key, useI18n } from "../i18n";
import { useRuleText } from "./text";
import type { PendingState, RuleDetail, VersionRow } from "./types";

/** Versions, newest first, with what changed in each and a two-person roll back. */
export function History({
  detail,
  canEdit,
  busy,
  onRollback,
}: {
  detail: RuleDetail;
  canEdit: boolean;
  busy: boolean;
  onRollback: (version: number) => void;
}) {
  const { t } = useI18n();
  const text = useRuleText();
  const rows = [...detail.history].sort((a, b) => b.version - a.version);
  const pending: PendingState | null = detail.pending?.kind === "rollback" ? detail.pending : null;
  const empty = (v: string) => (v ? v : t("v7.hist.empty.value"));
  return (
    <section className="rl-hist" aria-label={t("v7.hist.title")} data-testid="rule-history">
      <h3 className="rl-hist-h">{t("v7.hist.title")}</h3>
      <p className="muted">{t("v7.hist.lead")}</p>
      {rows.length === 0 ? <p className="muted">{t("v7.hist.empty")}</p> : null}
      <ol className="rl-vers">
        {rows.map((v: VersionRow) => {
          const live = v.version === detail.version;
          const mine = pending && pending.version === v.version;
          return (
            <li
              key={v.version}
              className={`rl-ver${live ? " live" : ""}`}
              data-testid="rule-version"
            >
              <div className="rl-ver-head">
                <b className="rl-ver-n">{t("v7.version", { n: v.version })}</b>
                {live ? <span className="rl-st enforced">{t("v7.hist.current")}</span> : null}
                <span className={`rl-st ${v.status}`}>{t(`v7.st.${v.status}` as Key)}</span>
                <span className="muted rl-ver-by">
                  {t("v7.hist.by", { who: text.who(v.by), when: text.ago(v.at) })}
                </span>
                {v.rolledBackFrom != null ? (
                  <span className="muted">{t("v7.hist.rolled", { n: v.rolledBackFrom })}</span>
                ) : null}
              </div>
              {v.changes.length ? (
                <dl className="rl-changes" aria-label={t("v7.hist.changes")}>
                  {v.changes.map((c) => (
                    <div key={c.part} className="rl-change">
                      <dt>{t(`v7.hist.part.${c.part}` as Key)}</dt>
                      <dd>
                        <span className="rl-from">
                          <small>{t("v7.hist.from")}</small> {empty(c.from)}
                        </span>
                        <span className="rl-to">
                          <small>{t("v7.hist.to")}</small> {empty(c.to)}
                        </span>
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="muted">{t("v7.hist.nochange")}</p>
              )}
              {canEdit && !live ? (
                <button
                  type="button"
                  className="btn sm"
                  disabled={busy || (!!pending && pending.by === "you")}
                  onClick={() => onRollback(v.version)}
                >
                  <RotateCcw size={14} aria-hidden />{" "}
                  {mine && pending?.by === "other"
                    ? t("v7.ed.confirm.rollback", { n: v.version })
                    : t("v7.hist.rollback", { n: v.version })}
                </button>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
