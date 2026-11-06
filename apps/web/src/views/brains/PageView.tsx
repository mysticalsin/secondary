import { History as HistoryIcon, Lock } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ErrorBox, fmtDate, Skeleton } from "../../components/ui";
import { useI18n } from "../../i18n";
import { pageLink } from "../../lib/links";
import { useApi } from "../../useApi";
import { LensLayout } from "../lens";
import { wikiApi } from "../wiki/api";
import { Markdown } from "../wiki/Markdown";
import { WikiDiff } from "../wiki/WikiDiff";
import { v3 } from "./api";

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

/** One page, for reading. Links stay inside the brain; a link to another brain is never drawn as a link. */
export function PageView() {
  const { id: ws = "", pid = "" } = useParams();
  const { t } = useI18n();
  const nav = useNavigate();
  const page = useApi(() => wikiApi.page(ws, pid), [ws, pid]);
  const home = useApi(() => v3.brain(ws), [ws]);
  const brainName = ws === "me" ? t("v4.personal") : (home.data?.name ?? ws);
  const p = page.data;
  return (
    <div className="page v4page reading-page wide">
      {p ? null : (
        <nav className="crumbs4" aria-label={t("v4.crumbs")}>
          <Link to={`/brains/${encodeURIComponent(ws)}`}>{brainName}</Link>
        </nav>
      )}
      {page.loading && !p ? <Skeleton n={3} /> : null}
      {page.error ? <ErrorBox message={page.error} onRetry={page.reload} /> : null}
      {p ? (
        <LensLayout brain={ws} brainName={brainName} pageId={pid} title={p.title}>
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
            <section className="rd-hist" aria-labelledby="rd-hist-h">
              <h2 id="rd-hist-h">{t("brain.history")}</h2>
              <History ws={ws} id={pid} />
            </section>
          </article>
        </LensLayout>
      ) : null}
    </div>
  );
}
