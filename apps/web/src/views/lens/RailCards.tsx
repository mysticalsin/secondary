import { BadgeCheck, GitBranch, MessageSquare, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { useAgentHost } from "../../agent/host";
import { fmtDate } from "../../components/ui";
import { useI18n } from "../../i18n";
import { InsightCard, TwinTable } from "../../insights/InsightCard";
import { pageLink } from "../../lib/links";
import { ago } from "../../lib/time";
import { Avatar } from "./Avatar";
import type { Backlink, Contributor, LensData } from "./types";

/** Freshness and who stood behind the page. A dark card like the others: the colour is the dot, the words say it. */
export function TrustCard({ data }: { data: LensData }) {
  const { t, tn } = useI18n();
  const f = data.freshness;
  const v = data.verified;
  const age = f.days < 1 ? t("v8l.today") : tn(f.days, "v8l.days.one", "v8l.days.other");
  return (
    <InsightCard
      testId="lens-trust"
      icon={<BadgeCheck size={20} aria-hidden />}
      title={t("v8l.trust.title")}
      subtitle={t("v8l.trust.sub", { days: f.freshnessDays })}
      summary={`${t(`v8l.fresh.${f.state}` as "v8l.fresh.fresh")}. ${age}.`}
    >
      <dl className="tr8">
        <div>
          <dt>{t("v8l.trust.fresh")}</dt>
          <dd>
            <span className={`dot8 ${f.state}`} aria-hidden />
            <b>{t(`v8l.fresh.${f.state}` as "v8l.fresh.fresh")}</b>
            <span className="muted8">{t("v8l.trust.updated", { age })}</span>
          </dd>
        </div>
        <div>
          <dt>{t("v8l.trust.verified")}</dt>
          <dd>
            {v ? (
              <>
                <span className="dot8 fresh" aria-hidden />
                <b>{v.by ? t("v8l.verified.by", { name: v.by.name }) : t("v8l.verified.anon")}</b>
                <span className="muted8">{fmtDate(v.at)}</span>
              </>
            ) : (
              <>
                <span className="dot8 none" aria-hidden />
                <b>{t("v8l.verified.none")}</b>
                <span className="muted8">{t("v8l.verified.none.l")}</span>
              </>
            )}
          </dd>
        </div>
      </dl>
    </InsightCard>
  );
}

export function ContributorsCard({ rows, unnamed }: { rows: Contributor[]; unnamed: number }) {
  const { t, tn } = useI18n();
  return (
    <InsightCard
      testId="lens-contributors"
      icon={<Users size={20} aria-hidden />}
      title={t("v8l.contrib.title")}
      subtitle={t("v8l.contrib.sub")}
      summary={t("v8l.contrib.summary", { n: rows.length + unnamed })}
      table={
        rows.length ? (
          <TwinTable
            caption={t("v8l.contrib.table")}
            head={[
              t("v8l.who.person"),
              t("v8l.who.rolecol"),
              t("v8l.who.changes"),
              t("v8l.who.lastcol"),
            ]}
            rows={rows.map((r) => [
              r.name,
              t(`v8l.role.${r.role}` as "v8l.role.reader"),
              tn(r.changes, "v8l.who.changes.one", "v8l.who.changes.other"),
              ago(r.lastAt),
            ])}
          />
        ) : undefined
      }
    >
      {rows.length || unnamed ? (
        <ul className="ct8">
          {rows.map((r) => (
            <li key={r.id}>
              <Avatar name={r.name} role={r.role} size={28} />
              <span className="ct8-n">{r.name}</span>
              <span className="muted8">{t(`v8l.role.${r.role}` as "v8l.role.reader")}</span>
            </li>
          ))}
          {unnamed ? (
            <li className="muted8">
              {tn(unnamed, "v8l.contrib.unnamed.one", "v8l.contrib.unnamed.other")}
            </li>
          ) : null}
        </ul>
      ) : (
        <p className="muted8 lens-note">{t("v8l.contrib.none")}</p>
      )}
    </InsightCard>
  );
}

export function BacklinksCard({ rows }: { rows: Backlink[] }) {
  const { t, tn } = useI18n();
  return (
    <InsightCard
      testId="lens-backlinks"
      icon={<GitBranch size={20} aria-hidden />}
      title={t("v8l.back.title")}
      subtitle={t("v8l.back.sub")}
      summary={tn(rows.length, "v8l.back.summary.one", "v8l.back.summary.other")}
    >
      {rows.length ? (
        <ul className="bl8">
          {rows.map((r) => (
            <li key={`${r.brainId}:${r.id}`}>
              <Link to={pageLink(r.brainId, r.id)}>{r.title}</Link>
              <span className="muted8">
                {r.collection}
                {r.brainName ? ` · ${r.brainId === "me" ? t("v4.personal") : r.brainName}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted8 lens-note">{t("v8l.back.none")}</p>
      )}
    </InsightCard>
  );
}

/** "Ask this page": a My Agent turn about this page only. The agent answers from what the viewer reads. */
export function AskThisPage({
  brain,
  pageId,
  title,
}: {
  brain: string;
  pageId: string;
  title: string;
}) {
  const { t } = useI18n();
  const host = useAgentHost();
  return (
    <button
      type="button"
      className="ask8"
      onClick={() =>
        host.ask({
          label: t("v8l.ask.label", { title }),
          action: { action: "focus", values: { brain, page: pageId } },
        })
      }
    >
      <MessageSquare size={16} aria-hidden /> {t("v8l.ask")}
    </button>
  );
}
