import { ArrowRight, Search } from "lucide-react";
import { type FormEvent, lazy, Suspense, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Await, Empty } from "../../components/ui";
import { useI18n } from "../../i18n";
import { Glance } from "../../insights/Glance";
import { pageLink } from "../../lib/links";
import { displayName } from "../../lib/people";
import { ago } from "../../lib/time";
import { useApp } from "../../state";
import { useApi } from "../../useApi";
import { ux2 } from "../../uxv2/api";
import { Ask } from "../ask/Ask";
import { v3 } from "../brains/api";
import type { BrainCard, Change, NavBrain } from "../brains/types";
import { PulseAcross } from "../pulse";

const PinnedGrid = lazy(() => import("../../agent/PinnedGrid"));

interface Recent extends Change {
  brain: NavBrain;
}

function flat(items: { children?: NavBrain[] }[] & NavBrain[]): NavBrain[] {
  return items.flatMap((i) => (i.children?.length ? i.children : [i as NavBrain]));
}

function BrainCardView({ b, name }: { b: BrainCard; name: string }) {
  const { t, tn } = useI18n();
  return (
    <li>
      <Link className="bcard4" to={`/brains/${encodeURIComponent(b.id)}`}>
        <b>{name}</b>
        <span className="muted">
          {b.type === "personal"
            ? t("v4.only.you")
            : tn(b.readers, "v4.readers.one", "v4.readers.other")}
        </span>
        <span className="muted">
          {b.lastActivityAt
            ? t("v4.home.active", { when: ago(b.lastActivityAt) })
            : t("b3.activity.none")}
        </span>
      </Link>
    </li>
  );
}

export function Home() {
  const { t, tn } = useI18n();
  const { me } = useApp();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [q, setQ] = useState("");
  const brains = useApi(() => v3.nav(), []);
  const waiting = useApi(() => ux2.questions(), []);
  const mine = useMemo(() => (brains.data ? flat(brains.data.items as never) : []), [brains.data]);
  const recent = useApi(async () => {
    const rows = await Promise.all(
      mine.slice(0, 10).map((b) =>
        v3
          .brain(b.id)
          .then((h) => h.changedThisWeek.items.map((c): Recent => ({ ...c, brain: b })))
          .catch(() => [] as Recent[]),
      ),
    );
    return rows
      .flat()
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 8);
  }, [mine.map((b) => b.id).join(",")]);
  const name = displayName(me).split(" ")[0] ?? "";
  const nameOf = (b: BrainCard) => (b.id === "me" ? t("v4.personal") : b.name);
  const go = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim()) nav(`/search?q=${encodeURIComponent(q.trim())}`);
  };
  const n = waiting.data?.length ?? 0;
  return (
    <div className="page v4page home4">
      <h1 className="ptitle">{name ? t("v4.home.hello", { name }) : t("v4.home")}</h1>
      <form className="searchbar herosearch" role="search" onSubmit={go}>
        <div className="sfield big">
          <Search size={16} aria-hidden />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label={t("v4.search.label")}
            placeholder={t("v4.search.ph")}
          />
        </div>
        <button type="submit" className="btn soft">
          {t("v4.search.go")}
        </button>
      </form>

      <section className="hsec waitcard" aria-labelledby="hw-h">
        <h2 id="hw-h">{t("v4.waiting")}</h2>
        {n > 0 ? (
          <p>
            {tn(n, "v4.home.waiting.one", "v4.home.waiting.other")}{" "}
            <Link className="reviewlink" to="/waiting">
              {t("v4.review")}
              <span aria-hidden> →</span>
            </Link>
          </p>
        ) : (
          <p className="muted">{t("v4.home.waiting.none")}</p>
        )}
      </section>

      <section className="hsec" aria-labelledby="hb-h">
        <div className="sec-head">
          <h2 id="hb-h">{t("v4.home.yourbrains")}</h2>
          <Link className="textlink" to="/brains">
            {t("v4.allbrains")} <ArrowRight size={14} aria-hidden />
          </Link>
        </div>
        <Await state={brains} skeleton={2}>
          {() =>
            mine.length ? (
              <ul className="bgrid">
                {mine.map((b) => (
                  <BrainCardView key={b.id} b={b} name={nameOf(b)} />
                ))}
              </ul>
            ) : (
              <Empty title={t("v4.home.nobrains")}>{t("v4.home.nobrains.lead")}</Empty>
            )
          }
        </Await>
      </section>

      <Glance />

      <PulseAcross />

      <Suspense fallback={null}>
        <PinnedGrid />
      </Suspense>

      <section className="hsec" aria-labelledby="hr-h">
        <h2 id="hr-h">{t("v4.home.recent")}</h2>
        <Await state={recent} skeleton={2}>
          {(rows) =>
            rows.length ? (
              <ul className="rows">
                {rows.map((c) => (
                  <li key={`${c.brain.id}-${c.pageId}-${c.revision}`} className="rowline">
                    <div>
                      <Link to={pageLink(c.brain.id, c.pageId)}>{c.title}</Link>
                      <p className="muted">
                        {nameOf(c.brain)} ·{" "}
                        {c.change === "new" ? t("v4.tag.new") : t("v4.tag.change")}
                      </p>
                    </div>
                    <span className="muted">{ago(c.at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">{t("v4.home.recent.none")}</p>
            )
          }
        </Await>
      </section>

      <details className="quietcard" id="ask" open={sp.has("ask") || undefined}>
        <summary>
          <b>{t("v4.ask.title")}</b> <span className="muted">{t("v4.ask.lead")}</span>
        </summary>
        <Ask />
      </details>
    </div>
  );
}
