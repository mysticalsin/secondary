import { CalendarDays } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../../api";
import { Await, Empty } from "../../components/ui";
import { useI18n } from "../../i18n";
import { useApp } from "../../state";
import { useApi } from "../../useApi";
import { wikiApi } from "../wiki/api";
import { Markdown } from "../wiki/Markdown";
import { v3 } from "./api";
import { BrainFrame } from "./shared";

function Day({ ws, pid }: { ws: string; pid: string }) {
  const nav = useNavigate();
  const { t } = useI18n();
  const page = useApi(() => wikiApi.page(ws, pid), [ws, pid]);
  return (
    <Await state={page} skeleton={2}>
      {(p) => (
        <article className="reading journal-page" aria-label={p.title}>
          <p className="muted">{t("b3.jr.note")}</p>
          <Markdown
            md={p.markdown}
            citations={p.citations}
            links={p.links}
            onLink={(id) =>
              nav(`/brains/${encodeURIComponent(ws)}/pages/${encodeURIComponent(id)}`)
            }
          />
        </article>
      )}
    </Await>
  );
}

export function JournalPage() {
  const { id = "" } = useParams();
  const { t, locale } = useI18n();
  const { say } = useApp();
  const days = useApi(() => v3.journal(id), [id]);
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const r = await v3.runJournal(id);
      say(r.pageId ? t("b3.jr.ran") : t("b3.jr.nothing"));
      days.reload();
    } catch (e) {
      say(e instanceof ApiError ? e.reason : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <BrainFrame id={id} title={t("b3.tab.journal")}>
      {(b) => (
        <section aria-labelledby="jr-h">
          <div className="row between">
            <div>
              <h3 id="jr-h" className="sec-h">
                {t("b3.jr.title")}
              </h3>
              <p className="muted">{t("b3.jr.lead")}</p>
            </div>
            {b.manages ? (
              <button type="button" className="btn sm" disabled={busy} onClick={run}>
                {busy ? t("common.working") : t("b3.jr.run")}
              </button>
            ) : null}
          </div>
          <Await state={days} skeleton={3}>
            {({ days: list }) => {
              if (!list.length)
                return <Empty title={t("b3.jr.empty")}>{t("b3.jr.empty.lead")}</Empty>;
              const cur = sel ?? (list[0]?.pageId as string);
              return (
                <div className="journal-grid">
                  <nav aria-label={t("b3.jr.days")}>
                    <ul className="jdays">
                      {list.map((d) => (
                        <li key={d.pageId}>
                          <button
                            type="button"
                            aria-current={cur === d.pageId ? "true" : undefined}
                            onClick={() => setSel(d.pageId)}
                          >
                            <CalendarDays size={14} aria-hidden />
                            {new Intl.DateTimeFormat(locale, {
                              dateStyle: "medium",
                              timeZone: "UTC",
                            }).format(new Date(`${d.date}T00:00:00Z`))}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </nav>
                  <Day ws={id} pid={cur} />
                </div>
              );
            }}
          </Await>
        </section>
      )}
    </BrainFrame>
  );
}
