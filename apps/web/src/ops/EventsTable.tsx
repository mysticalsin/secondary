import { useI18n } from "../i18n";
import { hms } from "./format";
import type { OpEvent } from "./types";
import { AttemptDots, LatencyBar, StatusChip } from "./ui";

/** The event table. A row is selected with the mouse or with Enter on its first cell. */
export function EventsTable({
  events,
  selectedId,
  onSelect,
}: {
  events: OpEvent[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { t } = useI18n();
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region needs a keyboard stop
    <div className="opx-tablewrap" role="region" aria-label={t("v7o.table.label")} tabIndex={0}>
      <table className="opx-table">
        <thead>
          <tr>
            <th scope="col">{t("v7o.col.event")}</th>
            <th scope="col" className="c-source">
              {t("v7o.col.source")}
            </th>
            <th scope="col">{t("v7o.col.status")}</th>
            <th scope="col" className="c-att">
              {t("v7o.col.attempts")}
            </th>
            <th scope="col" className="c-lat">
              {t("v7o.col.latency")}
            </th>
            <th scope="col" className="r">
              {t("v7o.col.time")}
            </th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => {
            const on = e.id === selectedId;
            return (
              <tr
                key={e.id}
                className={on ? "sel" : undefined}
                data-event={e.id}
                onClick={() => onSelect(on ? null : e.id)}
              >
                <td>
                  <button
                    type="button"
                    className="opx-ev"
                    aria-expanded={on}
                    aria-controls="opx-detail"
                  >
                    <code>{e.type}</code>
                    <span>{e.id}</span>
                  </button>
                </td>
                <td className="c-source">{e.source.label}</td>
                <td>
                  <StatusChip status={e.status} />
                </td>
                <td className="c-att">
                  <AttemptDots attempts={e.attempts} />
                </td>
                <td className="c-lat">
                  <LatencyBar ms={e.latencyMs} status={e.status} />
                </td>
                <td className="r">
                  <time dateTime={e.at} className="opx-time">
                    {hms(e.at)}
                  </time>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
