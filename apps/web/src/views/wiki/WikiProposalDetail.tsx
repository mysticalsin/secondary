import { useState } from "react";
import { ApiError } from "../../api";
import { Chip, ErrorBox, Eyebrow, fmtDate, Skeleton } from "../../components/ui";
import { useI18n } from "../../i18n";
import { whoIs } from "../../personas";
import { useApi } from "../../useApi";
import { wikiApi } from "./api";
import { WikiDiff } from "./WikiDiff";

/** Who wrote a proposal: the wiki agent of a workspace, or a person. */
export function useWho(): (id: string | null) => string {
  const { t, td } = useI18n();
  return (id) =>
    !id ? "" : id.startsWith("svc:wiki:") ? t("wiki.agent") : whoIs(id, (r, f) => td("role", r, f));
}

/**
 * One wiki proposal (an ingest diff, a lint finding or a dreaming suggestion): what changes, with
 * its citations, and the approve, edit or reject choice. Used in the wiki tab and in the review queue.
 */
export function WikiProposalDetail({
  ws,
  id,
  onDone,
}: {
  ws: string;
  id: string;
  onDone: (msg: string) => void;
}) {
  const { t, td } = useI18n();
  const who = useWho();
  const state = useApi(() => wikiApi.proposal(ws, id), [ws, id]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState("");
  const d = state.data;

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setErr(null);
    try {
      onDone(await fn());
    } catch (e) {
      setErr(e instanceof ApiError ? e.reason : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };

  if (state.loading && !d) return <Skeleton n={3} />;
  if (state.error) return <ErrorBox message={state.error} onRetry={state.reload} />;
  if (!d) return null;
  const stale = d.pages.some((p) => p.stale);

  return (
    <article className="card stack" aria-labelledby={`wp-${id}`} style={{ gap: 18 }}>
      <div>
        <div className="row" style={{ marginBottom: 6 }}>
          <Chip
            tone={d.kind === "wiki_ingest" ? "progress" : d.kind === "wiki_lint" ? "attn" : "open"}
          >
            {td("wiki.kind", d.kind, d.kind)}
          </Chip>
          {d.status !== "candidate" ? <Chip tone="done">{d.status}</Chip> : null}
        </div>
        <h3 id={`wp-${id}`}>{d.title}</h3>
        <p className="muted">
          {t("wiki.prop.by", { who: who(d.authorId), date: fmtDate(d.createdAt) })}
        </p>
      </div>

      {d.rationale || d.detail ? (
        <section className="stack" aria-label={t("wiki.prop.why")}>
          <Eyebrow>{t("wiki.prop.why")}</Eyebrow>
          <p>{d.detail || d.rationale}</p>
        </section>
      ) : null}

      {d.pages.length ? (
        <section className="stack" aria-label={t("wiki.prop.pages")}>
          <Eyebrow>{t("wiki.prop.pages")}</Eyebrow>
          {d.pages.map((p) => (
            <div key={p.pageId} className="stack">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>{p.title}</strong>
                <span className="row">
                  <Chip tone={p.before === null ? "done" : "progress"}>
                    {p.before === null ? t("wiki.prop.page.new") : t("wiki.prop.page.changed")}
                  </Chip>
                  {p.edited ? <Chip tone="attn">{t("wiki.prop.page.edited")}</Chip> : null}
                </span>
              </div>
              {p.stale ? <div className="reason err">{t("wiki.prop.page.stale")}</div> : null}
              <WikiDiff lines={p.diff} label={t("wiki.prop.diff", { title: p.title })} />
              {d.status === "candidate" ? (
                editing === p.pageId ? (
                  <div className="stack">
                    <div className="field">
                      <label htmlFor={`wpe-${p.pageId}`}>
                        {t("wiki.prop.edit.label", { title: p.title })}
                      </label>
                      <textarea
                        id={`wpe-${p.pageId}`}
                        className="textarea"
                        style={{ minHeight: 160 }}
                        maxLength={20000}
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                      />
                    </div>
                    <div className="row">
                      <button
                        type="button"
                        className="btn sm"
                        disabled={busy || !text.trim()}
                        onClick={() =>
                          run(async () => {
                            await wikiApi.editProposal(ws, id, p.pageId, text);
                            setEditing(null);
                            state.reload();
                            return t("wiki.prop.saved");
                          })
                        }
                      >
                        {t("wiki.prop.edit.save")}
                      </button>
                      <button
                        type="button"
                        className="btn sm ghost"
                        onClick={() => setEditing(null)}
                      >
                        {t("common.cancel")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <button
                      type="button"
                      className="btn sm ghost"
                      onClick={() => {
                        setEditing(p.pageId);
                        setText(p.after.replace(/\[restricted source\]/g, "").trim());
                      }}
                    >
                      {t("wiki.prop.edit")}
                      <span className="sr-only"> {p.title}</span>
                    </button>
                  </div>
                )
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      {d.facts.length ? (
        <section className="stack" aria-label={t("wiki.prop.facts")}>
          <Eyebrow>{t("wiki.prop.facts")}</Eyebrow>
          <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {d.facts.map((f) => (
              <li key={`${f.subject}|${f.predicate}|${f.object}`} className="itemrow">
                <strong>{f.subject}</strong>: {f.predicate} {f.object}
                <div className="muted" style={{ fontSize: 14 }}>
                  {fmtDate(f.validAt)}
                  {f.invalidAt ? ` > ${fmtDate(f.invalidAt)}` : ""}
                  {f.sources.length ? ` · ${f.sources.map((s) => s.title).join(", ")}` : ""}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {d.invalidate.length ? (
        <section className="stack" aria-label={t("wiki.prop.replaces")}>
          <Eyebrow>{t("wiki.prop.replaces")}</Eyebrow>
          <ul className="stack" style={{ margin: 0 }}>
            {d.invalidate.map((f) => (
              <li key={f.factId}>
                {f.subject}: {f.predicate} {f.object} ({fmtDate(f.at)})
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {d.confirm.length || d.reingest.length || d.archive.length ? (
        <section className="stack" aria-label={t("wiki.prop.also")}>
          <Eyebrow>{t("wiki.prop.also")}</Eyebrow>
          <ul style={{ margin: 0 }}>
            {d.confirm.length ? <li>{t("wiki.prop.confirm", { n: d.confirm.length })}</li> : null}
            {d.reingest.length ? (
              <li>{t("wiki.prop.reingest", { n: d.reingest.length })}</li>
            ) : null}
            {d.archive.length ? <li>{t("wiki.prop.archive", { n: d.archive.length })}</li> : null}
          </ul>
        </section>
      ) : null}

      {d.sources.length ? (
        <section className="stack" aria-label={t("wiki.prop.sources")}>
          <Eyebrow>{t("wiki.prop.sources")}</Eyebrow>
          <ul style={{ margin: 0 }}>
            {d.sources.map((s) => (
              <li key={s.id}>{s.title}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {d.status === "candidate" ? (
        <section className="stack">
          <div className="row">
            <button
              type="button"
              className="btn primary"
              disabled={busy || stale}
              onClick={() =>
                run(async () => {
                  await wikiApi.decide(ws, id, "approve");
                  return t("wiki.prop.approved");
                })
              }
            >
              {t("wiki.prop.approve")}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await wikiApi.decide(ws, id, "reject");
                  return t("wiki.prop.rejected");
                })
              }
            >
              {t("wiki.prop.reject")}
            </button>
          </div>
          {err ? <ErrorBox message={err} /> : null}
        </section>
      ) : null}
    </article>
  );
}
