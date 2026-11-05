import { History as HistoryIcon, Lock } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ErrorBox, fmtDate, Skeleton } from "../../components/ui";
import { useI18n } from "../../i18n";
import { pageLink } from "../../lib/links";
import { useApi } from "../../useApi";
import { wikiApi } from "../wiki/api";
import { Markdown } from "../wiki/Markdown";
import type { WikiFact, WikiPage } from "../wiki/types";
import { WikiDiff } from "../wiki/WikiDiff";
import { v3 } from "./api";

type Tab = "facts" | "history" | "links";

function FactsTimeline({ ws, page }: { ws: string; page: WikiPage }) {
  const { t } = useI18n();
  const facts = useApi(() => wikiApi.facts(ws), [ws]);
  if (facts.loading && !facts.data) return <Skeleton n={2} />;
  if (facts.error) return <ErrorBox message={facts.error} onRetry={facts.reload} />;
  const cited = new Set([...page.markdown.matchAll(/\{src:([^}]+)\}/g)].map((m) => m[1]));
  const rows = (facts.data ?? [])
    .filter((f) => f.sources.some((s) => cited.has(s.id)))
    .sort((a, b) => b.validAt.localeCompare(a.validAt));
  if (!rows.length) return <p className="muted">{t("brain.facts.none")}</p>;
  return (
    <ol className="timeline" aria-label={t("brain.facts")}>
      {rows.map((f: WikiFact) => (
        <li key={f.id} className={f.invalidAt ? "ended" : ""}>
          <span className="tl-dot" aria-hidden />
          <div>
            <p className="tl-main">
              {f.subject.replace(/^[a-z]+:\s*/i, "")}: <b>{f.object}</b>
              <span className="muted"> ({f.predicate})</span>
            </p>
            <p className="muted tl-meta">
              {f.invalidAt
                ? t("brain.fact.range", { from: fmtDate(f.validAt), to: fmtDate(f.invalidAt) })
                : t("brain.fact.since", { from: fmtDate(f.validAt) })}
              {f.unverified ? (
                <span className="chip t-attn tl-chip">{t("brain.fact.unverified")}</span>
              ) : null}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function History({ ws, id }: { ws: string; id: string }) {
  const { t } = useI18n();
  const h = useApi(() => wikiApi.history(ws, id), [ws, id]);
  if (h.loading && !h.data) return <Skeleton n={2} />;
  if (h.error) return <ErrorBox message={h.error} onRetry={h.reload} />;
  return (
    <ul className="hist">
      {(h.data ?? []).map((r) => (
        <li key={r.revision}>
          <details>
            <summary>
              <b>{t("wiki.page.rev", { n: r.revision })}</b>
              <span className="muted"> {fmtDate(r.at)}</span>
            </summary>
            <WikiDiff lines={r.diff} label={t("wiki.page.rev", { n: r.revision })} />
          </details>
        </li>
      ))}
    </ul>
  );
}

function Backlinks({ ws, page }: { ws: string; page: WikiPage }) {
  const { t } = useI18n();
  const hits = useApi(() => wikiApi.search(ws, page.title), [ws, page.title]);
  if (hits.loading && !hits.data) return <Skeleton n={2} />;
  const rows = (hits.data?.results ?? []).filter((r) => r.pageId !== page.id && r.ws === ws);
  if (!rows.length) return <p className="muted">{t("brain.links.none")}</p>;
  return (
    <ul className="linklist-col">
      {rows.map((r) => (
        <li key={r.pageId}>
          <Link to={pageLink(ws, r.pageId)}>{r.title}</Link>
          <span className="muted"> {r.summary}</span>
        </li>
      ))}
    </ul>
  );
}

/** One page, for reading. Links stay inside the brain; a link to another brain is never drawn as a link. */
export function PageView() {
  const { id: ws = "", pid = "" } = useParams();
  const { t } = useI18n();
  const nav = useNavigate();
  const page = useApi(() => wikiApi.page(ws, pid), [ws, pid]);
  const home = useApi(() => v3.brain(ws), [ws]);
  const [tab, setTab] = useState<Tab>("facts");
  const brainName = ws === "me" ? t("v4.personal") : (home.data?.name ?? ws);
  const p = page.data;
  return (
    <div className="page v4page reading-page">
      <nav className="crumbs4" aria-label={t("v4.crumbs")}>
        <Link to={`/brains/${encodeURIComponent(ws)}`}>{brainName}</Link>
      </nav>
      {page.loading && !p ? <Skeleton n={3} /> : null}
      {page.error ? <ErrorBox message={page.error} onRetry={page.reload} /> : null}
      {p ? (
        <article className="reading" aria-labelledby="page-title">
          <header className="rd-head">
            <h1 id="page-title">{p.title}</h1>
            <div className="rd-actions">
              <Link
                className="btn ghost sm"
                to={`/brains/${encodeURIComponent(ws)}/pages/${encodeURIComponent(pid)}/versions`}
              >
                <HistoryIcon size={15} aria-hidden /> {t("v4.menu.history")}
              </Link>
            </div>
          </header>
          <p className="muted rd-meta">
            {t("brain.updated", { date: fmtDate(p.updatedAt), n: p.current })}
            {p.restricted ? (
              <span className="chip t-attn tl-chip">
                <Lock size={12} aria-hidden /> {t("wiki.page.restricted", { n: p.restricted })}
              </span>
            ) : null}
            {p.origin === "seed" ? (
              <span className="chip t-attn tl-chip" data-testid="seed-badge">
                {t("brain.seed")}
              </span>
            ) : null}
          </p>
          <Markdown
            md={p.markdown.replace(/^#\s+.*\n+/, "")}
            citations={p.citations}
            links={p.links}
            onLink={(id) => nav(pageLink(ws, id))}
          />
          <div className="rd-tabs" role="tablist" aria-label={t("brain.more")}>
            {(
              [
                ["facts", t("brain.facts")],
                ["history", t("brain.history")],
                ["links", t("brain.links")],
              ] as [Tab, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                id={`rd-tab-${k}`}
                aria-selected={tab === k}
                aria-controls="rd-panel"
                onClick={() => setTab(k)}
              >
                {label}
              </button>
            ))}
          </div>
          <div id="rd-panel" role="tabpanel" aria-labelledby={`rd-tab-${tab}`} className="rd-panel">
            {tab === "facts" ? <FactsTimeline ws={ws} page={p} /> : null}
            {tab === "history" ? <History ws={ws} id={pid} /> : null}
            {tab === "links" ? <Backlinks ws={ws} page={p} /> : null}
          </div>
        </article>
      ) : null}
    </div>
  );
}
