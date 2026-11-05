// A file synced from SharePoint or OneDrive. The API checks the caller's access twice (the gate node
// in Secondary, then the source itself) and answers 403 when the source permission is not
// confirmed. The text is shown as plain text, never as markup.

import { ArrowLeft, ExternalLink } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { Chip, ErrorBox, Eyebrow, PlaneBadge, Skeleton } from "../components/ui";
import { useI18n } from "../i18n";
import { useApi } from "../useApi";

/** Only web links open. A synced record never gets to run a script or a data: URL. */
const safeUrl = (u: string | null): string | null => {
  if (!u) return null;
  try {
    const p = new URL(u);
    return p.protocol === "https:" || p.protocol === "http:" ? p.href : null;
  } catch {
    return null;
  }
};

const fmtSize = (n: number): string =>
  n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${Math.round(n / 1024)} KB`
      : `${(n / 1048576).toFixed(1)} MB`;

export function SourceView() {
  const { t } = useI18n();
  const { id = "" } = useParams();
  const state = useApi(() => api.source(id), [id]);
  const d = state.data;
  const url = safeUrl(d?.webUrl ?? null);
  const denied = state.error !== null && /confirm/i.test(state.error);

  return (
    <div className="page">
      <p style={{ marginBottom: 16 }}>
        <Link className="btn sm ghost" to="/">
          <ArrowLeft size={14} aria-hidden /> {t("src.back")}
        </Link>
      </p>
      {state.loading && !d ? <Skeleton n={3} /> : null}
      {state.error ? (
        <ErrorBox message={denied ? t("src.denied") : state.error} onRetry={state.reload} />
      ) : null}
      {d ? (
        <>
          <header className="page-head">
            <div className="row">
              <PlaneBadge plane={d.plane} />
              <Chip>{t("src.kind")}</Chip>
            </div>
            <Eyebrow>{d.mime ?? t("src.file")}</Eyebrow>
            <h2>{d.title}</h2>
            <p className="muted">
              {t("src.meta", {
                size: fmtSize(d.size),
                at: new Date(d.syncedAt).toISOString().slice(0, 10),
              })}
            </p>
            {url ? (
              <p>
                <a className="btn sm" href={url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={14} aria-hidden /> {t("src.open")}
                </a>
              </p>
            ) : null}
          </header>
          {d.body ? (
            <section className="card" aria-label={t("src.text")}>
              <pre className="src-text">{d.body}</pre>
            </section>
          ) : (
            <p className="muted">{t("src.nobody")}</p>
          )}
        </>
      ) : null}
    </div>
  );
}
