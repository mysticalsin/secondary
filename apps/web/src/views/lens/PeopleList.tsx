import { useI18n } from "../../i18n";
import { ago } from "../../lib/time";
import { Avatar } from "./Avatar";
import type { PersonRow } from "./types";

/** People with their role and brain, ranked. The same list serves the page rail, the brain page and My Agent. */
export function PeopleList({
  people,
  showBrain = true,
  label,
}: {
  people: PersonRow[];
  showBrain?: boolean;
  label: string;
}) {
  const { t, tn } = useI18n();
  const top = Math.max(...people.map((p) => p.score), 0.01);
  return (
    <ol className="pl8" aria-label={label}>
      {people.map((p) => (
        <li key={`${p.brainId}:${p.id}`}>
          <Avatar name={p.name} role={p.role} />
          <div className="pl8-b">
            <p className="pl8-n">{p.name}</p>
            <p className="pl8-m">
              {t(`v8l.role.${p.role}` as "v8l.role.reader")}
              {showBrain ? ` · ${p.brainId === "me" ? t("v4.personal") : p.brainName}` : ""}
            </p>
            <p className="pl8-m">
              {tn(p.contributions, "v8l.who.changes.one", "v8l.who.changes.other")} ·{" "}
              {t("v8l.who.last", { when: ago(p.lastAt) })}
            </p>
          </div>
          <span className="pl8-bar" aria-hidden>
            <span style={{ width: `${Math.max(8, Math.round((p.score / top) * 100))}%` }} />
          </span>
        </li>
      ))}
    </ol>
  );
}
