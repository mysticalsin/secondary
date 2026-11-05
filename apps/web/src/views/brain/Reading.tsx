import { useState } from "react";
import { Link } from "react-router-dom";
import { ErrorBox, fmtDate, Skeleton } from "../../components/ui";
import { useI18n } from "../../i18n";
import { useApi } from "../../useApi";
import { wikiApi } from "../wiki/api";
import { Markdown } from "../wiki/Markdown";
import type { WikiFact, WikiPage } from "../wiki/types";
import { WikiDiff } from "../wiki/WikiDiff";

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
          <Link to={`/brain?ws=${encodeURIComponent(ws)}&page=${encodeURIComponent(r.pageId)}`}>
            {r.title}
          </Link>
          <span className="muted"> {r.summary}</span>
        </li>
      ))}
    </ul>
  );
}

export function Reading({
  ws,
  id,
  paper,
  onLink,
  crumb,
}: {
  ws: string;
  id: string;
  paper: boolean;
  onLink: (id: string) => void;
  crumb: string;
}) {
  const { t } = useI18n();
  const page = useApi(() => wikiApi.page(ws, id), [ws, id]);
  const [tab, setTab] = useState<Tab>("facts");
  if (page.loading && !page.data) return <Skeleton n={3} />;
  if (page.error) return <ErrorBox message={page.error} onRetry={page.reload} />;
  const p = page.data;
  if (!p) return null;
  const tabs: [Tab, string][] = [
    ["facts", t("brain.facts")],
    ["history", t("brain.history")],
    ["links", t("brain.links")],
  ];
  return (
    <article className={`reading${paper ? " paper" : ""}`} aria-labelledby="page-title">
      <p className="crumb muted">{crumb}</p>
      <h2 id="page-title">{p.title}</h2>
      <p className="muted rd-meta">
        {t("brain.updated", { date: fmtDate(p.updatedAt), n: p.current })}
        {p.restricted ? <> {t("wiki.page.restricted", { n: p.restricted })}</> : null}
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
        onLink={onLink}
      />
      <div className="rd-tabs" role="tablist" aria-label={t("brain.more")}>
        {tabs.map(([k, label]) => (
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
        {tab === "history" ? <History ws={ws} id={id} /> : null}
        {tab === "links" ? <Backlinks ws={ws} page={p} /> : null}
      </div>
    </article>
  );
}
