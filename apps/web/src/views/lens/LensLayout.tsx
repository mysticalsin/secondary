import { Lock } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fmtDate, Skeleton } from "../../components/ui";
import { useI18n } from "../../i18n";
import { ago } from "../../lib/time";
import { useApi } from "../../useApi";
import { lensApi } from "./api";
import { FactsBars } from "./FactsBars";
import { LocalGraph } from "./LocalGraph";
import { AskThisPage, BacklinksCard, ContributorsCard, TrustCard } from "./RailCards";
import type { LensData } from "./types";
import { WhoKnowsCard } from "./WhoKnows";

/** Brain, collection, status and the last change: it stays at the top while the page scrolls. */
export function StickyHeader({
  brain,
  brainName,
  title,
  data,
}: {
  brain: string;
  brainName: string;
  title: string;
  data: LensData | null;
}) {
  const { t } = useI18n();
  const p = data?.page;
  const by = p?.lastChange.by;
  // The page's own title leaves the screen as it scrolls: the header takes it over.
  const [away, setAway] = useState(false);
  useEffect(() => {
    const h1 = document.getElementById("page-title");
    const root = document.getElementById("main");
    if (!h1 || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setAway(e ? !e.isIntersecting : false), { root });
    io.observe(h1);
    return () => io.disconnect();
  }, [title]);
  return (
    <div className="sh8" data-testid="lens-header">
      <nav className="sh8-crumbs" aria-label={t("v4.crumbs")}>
        <Link to={`/brains/${encodeURIComponent(brain)}`}>{brainName}</Link>
        {p ? (
          <>
            <span aria-hidden>/</span>
            <span>{p.collection}</span>
          </>
        ) : null}
      </nav>
      <p className={`sh8-title${away ? " show" : ""}`} aria-hidden>
        {title}
      </p>
      <ul className="sh8-chips">
        {p ? (
          <>
            <li className="sh8-chip">
              <span className="dot8 fresh" aria-hidden />
              {t("v4.status.published")}
            </li>
            <li className="sh8-chip">
              {by
                ? t("v8l.head.last.by", { when: ago(p.lastChange.at), name: by.name })
                : t("v8l.head.last", { when: ago(p.lastChange.at) })}
              <span className="sh8-rev">r{p.lastChange.revision}</span>
            </li>
          </>
        ) : null}
      </ul>
    </div>
  );
}

/** The page and its lens: the reading column on the left, the rail on the right (below it on a phone). */
export function LensLayout({
  brain,
  brainName,
  pageId,
  title,
  children,
}: {
  brain: string;
  brainName: string;
  pageId: string;
  title: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const lens = useApi(() => lensApi.lens(brain, pageId), [brain, pageId]);
  const d = lens.data;
  return (
    <>
      <StickyHeader brain={brain} brainName={brainName} title={title} data={d} />
      <div className="lens8">
        <div className="lens8-main">{children}</div>
        <aside className="lens8-rail" aria-label={t("v8l.rail")} data-testid="lens-rail">
          {lens.loading && !d ? (
            <Skeleton n={3} />
          ) : lens.error || !d ? (
            <p className="muted8 lens-note">
              <Lock size={14} aria-hidden /> {t("v8l.rail.error")}
            </p>
          ) : (
            <>
              <TrustCard data={d} />
              <LocalGraph nodes={d.graph.nodes} edges={d.graph.edges} />
              <FactsBars facts={d.facts} />
              <WhoKnowsCard
                people={d.who}
                subtitle={t("v8l.who.sub.page")}
                summaryOf={d.page.title}
                showBrain={new Set(d.who.map((x) => x.brainId)).size > 1}
              />
              <ContributorsCard rows={d.contributors} unnamed={d.unnamed} />
              <BacklinksCard rows={d.backlinks} />
              <AskThisPage brain={brain} pageId={pageId} title={d.page.title} />
              <p className="muted8 lens-note">
                {t("v8l.rail.note", { date: fmtDate(d.page.updatedAt) })}
              </p>
            </>
          )}
        </aside>
      </div>
    </>
  );
}
