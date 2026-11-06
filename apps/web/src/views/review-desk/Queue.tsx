import { Clock, Inbox, UserCheck } from "lucide-react";
import { useI18n } from "../../i18n";
import { ago } from "../../lib/time";
import { Effort, RiskIcons, usePerson, useWho } from "./shared";
import type { Desk, DeskRow, Section } from "./types";

export const SELECTABLE: Exclude<Section, "fyi">[] = [
  "decision",
  "contradictions",
  "mentions",
  "snoozed",
];

function Row({ r, selected, onSelect }: { r: DeskRow; selected: boolean; onSelect: () => void }) {
  const { t, locale } = useI18n();
  const who = useWho();
  const by = who(r.author);
  const near = r.age.state !== "ok";
  return (
    <li>
      <button
        type="button"
        className={`rv-row${selected ? " is-on" : ""}`}
        aria-current={selected ? "true" : undefined}
        data-id={r.id}
        data-testid="rv-row"
        onClick={onSelect}
      >
        <span className="rv-row-title">{r.title}</span>
        <span className="rv-row-meta">
          <span className="rv-brain">{r.brain.name}</span>
          <span className="rv-what">{t(`v8r.what.${r.what}` as never)}</span>
          {by ? <span className="muted">{by}</span> : null}
        </span>
        <span className="rv-row-foot">
          <span className={`rv-age ${r.age.state}`} data-state={r.age.state}>
            <Clock size={12} aria-hidden />
            {ago(r.createdAt)}
            {near ? <b> · {t(`v8r.age.${r.age.state}` as never)}</b> : null}
          </span>
          <RiskIcons risk={r.risk} />
          <Effort n={r.effortMinutes} />
          {r.assignedToMe ? (
            <span className="rv-assigned">
              <UserCheck size={12} aria-hidden /> {t("v8r.assigned.me")}
            </span>
          ) : r.assignedTo ? (
            <span className="rv-assigned">
              <UserCheck size={12} aria-hidden /> {t("v8r.assigned.other")}
            </span>
          ) : null}
          {r.waitingOnAuthor ? (
            <span className="rv-assigned">{t("v8r.waiting.author")}</span>
          ) : null}
          {r.snoozedUntil ? (
            <span className="rv-assigned">
              {t("v8r.snoozed.until", {
                date: new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
                  new Date(r.snoozedUntil),
                ),
              })}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

export function Queue({
  desk,
  rows,
  selectedId,
  onSelect,
}: {
  desk: Desk;
  rows: Record<Exclude<Section, "fyi">, DeskRow[]>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  const person = usePerson();
  return (
    <nav className="rv-queue" aria-label={t("v8r.queue")}>
      {SELECTABLE.map((s) => {
        const list = rows[s];
        if (!list.length && s !== "decision") return null;
        return (
          <section key={s} aria-labelledby={`rv-sec-${s}`} className="rv-sec" data-section={s}>
            <h2 id={`rv-sec-${s}`}>
              {t(`v8r.sec.${s}` as never)} <span className="cnt">{list.length}</span>
            </h2>
            {list.length ? (
              <ul>
                {list.map((r) => (
                  <Row
                    key={r.id}
                    r={r}
                    selected={r.id === selectedId}
                    onSelect={() => onSelect(r.id)}
                  />
                ))}
              </ul>
            ) : (
              <p className="muted rv-none">
                <Inbox size={14} aria-hidden /> {t("v8r.sec.decision.none")}
              </p>
            )}
          </section>
        );
      })}
      {desk.sections.fyi.length ? (
        <section aria-labelledby="rv-sec-fyi" className="rv-sec" data-section="fyi">
          <h2 id="rv-sec-fyi">
            {t("v8r.sec.fyi")} <span className="cnt">{desk.sections.fyi.length}</span>
          </h2>
          <ul>
            {desk.sections.fyi.map((f) => (
              <li key={f.id} className="rv-fyi">
                <span className="rv-row-title">{f.title}</span>
                <span className="rv-row-meta">
                  <span className="rv-brain">{f.brainName}</span>
                  <span className="muted">
                    {t("v8r.fyi.by", { who: person(f.by) })}
                    {" · "}
                    {ago(f.decidedAt)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </nav>
  );
}
