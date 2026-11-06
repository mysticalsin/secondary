import { Users } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import { Skeleton } from "../../components/ui";
import { useI18n } from "../../i18n";
import { InsightCard, TwinTable } from "../../insights/InsightCard";
import { ago } from "../../lib/time";
import { useApi } from "../../useApi";
import { lensApi } from "./api";
import { EmptyArt } from "./art";
import { PeopleList } from "./PeopleList";
import type { PersonRow } from "./types";

/** Presentational: a card of people. `people` is null while loading. */
export function WhoKnowsCard({
  people,
  subtitle,
  summaryOf,
  showBrain = false,
  testId = "who-knows",
  control,
}: {
  people: PersonRow[] | null;
  subtitle: string;
  summaryOf: string;
  showBrain?: boolean;
  testId?: string;
  control?: ReactNode;
}) {
  const { t, tn } = useI18n();
  return (
    <InsightCard
      testId={testId}
      icon={<Users size={20} aria-hidden />}
      title={t("v8l.who.title")}
      subtitle={subtitle}
      control={control}
      summary={
        people?.length
          ? t("v8l.who.summary", { n: people.length, of: summaryOf })
          : t("v8l.who.none.t")
      }
      table={
        people?.length ? (
          <TwinTable
            caption={t("v8l.who.table")}
            head={[
              t("v8l.who.person"),
              t("v8l.who.rolecol"),
              t("v8l.table.brain"),
              t("v8l.who.changes"),
              t("v8l.who.lastcol"),
            ]}
            rows={people.map((p) => [
              p.name,
              t(`v8l.role.${p.role}` as "v8l.role.reader"),
              p.brainId === "me" ? t("v4.personal") : p.brainName,
              tn(p.contributions, "v8l.who.changes.one", "v8l.who.changes.other"),
              ago(p.lastAt),
            ])}
          />
        ) : undefined
      }
      footer={
        <p className="icard-f who8-foot">
          {t("v8l.who.foot")}{" "}
          <Link to="/settings/privacy" className="who8-link">
            {t("v8l.who.optout")}
          </Link>
        </p>
      }
    >
      {people === null ? (
        <Skeleton n={2} />
      ) : people.length ? (
        <PeopleList people={people} showBrain={showBrain} label={t("v8l.who.title")} />
      ) : (
        <div className="lens-empty">
          <EmptyArt kind="people" />
          <p>
            <b>{t("v8l.who.none.t")}</b>
          </p>
          <p>{t("v8l.who.none.l")}</p>
        </div>
      )}
    </InsightCard>
  );
}

/** Who knows about a brain, or about one of its collections, for the brain page. */
export function BrainWhoKnows({
  brain,
  collections = [],
}: {
  brain: string;
  collections?: { type: string; label: string }[];
}) {
  const { t } = useI18n();
  const [collection, setCollection] = useState("");
  const r = useApi(
    () => lensApi.whoKnows(brain, collection ? { collection } : {}, 5),
    [brain, collection],
  );
  const label = collections.find((c) => c.type === collection)?.label ?? t("v8l.who.thisbrain");
  return (
    <WhoKnowsCard
      people={r.error ? [] : (r.data?.people ?? null)}
      subtitle={t("v8l.who.sub.brain", { of: label })}
      summaryOf={label}
      testId="who-knows-brain"
      control={
        collections.length ? (
          <select
            className="wk8-select"
            aria-label={t("v8l.who.pick")}
            value={collection}
            onChange={(e) => setCollection(e.target.value)}
          >
            <option value="">{t("v8l.who.all")}</option>
            {collections.map((c) => (
              <option key={c.type} value={c.type}>
                {c.label}
              </option>
            ))}
          </select>
        ) : undefined
      }
    />
  );
}
