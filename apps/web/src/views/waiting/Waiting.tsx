import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError } from "../../api";
import { Await, Empty, ErrorBox } from "../../components/ui";
import { useI18n } from "../../i18n";
import { ago } from "../../lib/time";
import { useApp } from "../../state";
import { useApi } from "../../useApi";
import { ux2 } from "../../uxv2/api";
import type { Question } from "../../uxv2/types";
import { v3 } from "../brains/api";
import type { BatchResult } from "../brains/types";
import { QUESTIONS_CHANGED } from "./events";
import { batchAction } from "./QuestionCard";
import { isNewPage, useAuthor, useBrainNames } from "./shared";

function useDebounced<T>(v: T, ms = 250): T {
  const [x, setX] = useState(v);
  useEffect(() => {
    const id = window.setTimeout(() => setX(v), ms);
    return () => window.clearTimeout(id);
  }, [v, ms]);
  return x;
}

function Card({
  q,
  checked,
  onCheck,
}: {
  q: Question;
  checked: boolean;
  onCheck: (v: boolean) => void;
}) {
  const { t } = useI18n();
  const author = useAuthor();
  const hasDiff = (q.detail?.changeCount ?? 0) > 0;
  const badge = hasDiff
    ? isNewPage(q)
      ? t("v4.tag.new")
      : t("v4.tag.change")
    : t(`q.kind.${q.kind}` as never);
  const by = author(q);
  return (
    <li className="wcard">
      <label className="wsel">
        <input type="checkbox" checked={checked} onChange={(e) => onCheck(e.target.checked)} />
        <span className="sr-only">{t("b3.q.select", { title: q.title })}</span>
      </label>
      <div className="wbody">
        <h3>{q.title}</h3>
        {q.summary ? <p className="clamp muted2">{q.summary}</p> : null}
        <p className="wmeta">
          <span className="tag outline">{badge}</span>
          <span className="muted">
            {by ? `${by} · ` : ""}
            {ago(q.createdAt)}
          </span>
        </p>
      </div>
      <Link className="reviewlink" to={`/waiting/${encodeURIComponent(q.id)}`}>
        {t("v4.review")}
        <span aria-hidden> →</span>
        <span className="sr-only"> {q.title}</span>
      </Link>
    </li>
  );
}

export function Waiting() {
  const { t } = useI18n();
  const { say } = useApp();
  const [sp, setSp] = useSearchParams();
  const brain = sp.get("brain") ?? "";
  const [term, setTerm] = useState("");
  const q = useDebounced(term);
  const list = useApi(() => ux2.questions({ q, brain }), [q, brain]);
  const names = useBrainNames();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<BatchResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const groups = useMemo(() => {
    const m = new Map<string, Question[]>();
    for (const x of list.data ?? []) m.set(x.workspaceId, [...(m.get(x.workspaceId) ?? []), x]);
    return [...m.entries()].sort((a, b) => names(a[0]).localeCompare(names(b[0])));
  }, [list.data]);
  const chosen = (list.data ?? []).filter((x) => picked.has(x.id));
  const toggle = (id: string, on: boolean) =>
    setPicked((p) => {
      const n = new Set(p);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  const run = async (kind: "approve" | "reject") => {
    setBusy(true);
    setErr(null);
    setRes(null);
    try {
      const items = chosen.flatMap((x) => {
        const action =
          kind === "approve"
            ? batchAction(x)
            : x.options.find((o) => /^(reject|request)/.test(o.action))?.action;
        if (!action) return [];
        return [
          {
            id: x.id,
            action,
            ...(x.detail?.revisionHash ? { revisionHash: x.detail.revisionHash } : {}),
          },
        ];
      });
      const r = await v3.batch(items);
      setRes(r);
      setPicked(new Set());
      if (r.ok) {
        say(t("b3.q.batch.sum", { ok: r.ok, failed: r.failed }));
        window.dispatchEvent(new Event(QUESTIONS_CHANGED));
      }
      list.reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.reason : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page v4page">
      <h1 className="ptitle">{t("v4.waiting")}</h1>
      <div className="findrow">
        <label htmlFor="find-review">{t("v4.find")}</label>
        <div className="sfield big">
          <Search size={15} aria-hidden />
          <input
            id="find-review"
            type="search"
            value={term}
            placeholder={t("v4.find.ph")}
            onChange={(e) => setTerm(e.target.value)}
          />
        </div>
        {brain ? (
          <button type="button" className="btn soft sm" onClick={() => setSp({})}>
            {t("v4.waiting.clear", { name: names(brain) })}
          </button>
        ) : null}
      </div>
      {err ? <ErrorBox message={err} /> : null}
      {res?.failed ? (
        <div className="banner" role="status">
          <b>{t("b3.q.batch.sum", { ok: res.ok, failed: res.failed })}</b>
          <ul>
            {res.results
              .filter((r) => !r.ok)
              .map((r) => (
                <li key={r.id}>
                  {r.error === "changes_not_seen"
                    ? t("v4.waiting.readfirst")
                    : (r.reason ?? r.error)}
                </li>
              ))}
          </ul>
        </div>
      ) : null}
      {chosen.length ? (
        <div className="batchbar" role="region" aria-label={t("v4.batch")}>
          <span>{t("v4.batch.n", { n: chosen.length })}</span>
          <button type="button" className="btn sm" disabled={busy} onClick={() => run("reject")}>
            {t("v4.reject.selected")}
          </button>
          <button
            type="button"
            className="btn primary sm"
            disabled={busy}
            onClick={() => run("approve")}
          >
            {t("v4.approve.selected")}
          </button>
        </div>
      ) : null}
      <Await state={list} skeleton={3}>
        {(items) =>
          items.length ? (
            <div className="wgroups">
              {groups.map(([ws, rows]) => {
                const all = rows.every((r) => picked.has(r.id));
                return (
                  <section key={ws} aria-label={names(ws)} className="wgroup">
                    <div className="wghead">
                      <h2>
                        {names(ws)} <span className="cnt">{rows.length}</span>
                      </h2>
                      <label className="selall">
                        <input
                          type="checkbox"
                          checked={all}
                          onChange={(e) =>
                            setPicked((p) => {
                              const n = new Set(p);
                              for (const r of rows) {
                                if (e.target.checked) n.add(r.id);
                                else n.delete(r.id);
                              }
                              return n;
                            })
                          }
                        />
                        {t("v4.selectall")}
                        <span className="sr-only"> {names(ws)}</span>
                      </label>
                    </div>
                    <ul className="wlist">
                      {rows.map((r) => (
                        <Card
                          key={r.id}
                          q={r}
                          checked={picked.has(r.id)}
                          onCheck={(v) => toggle(r.id, v)}
                        />
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          ) : (
            <Empty title={term || brain ? t("v4.waiting.nomatch") : t("q.empty.title")}>
              {term || brain ? t("v4.contents.nomatch.lead") : t("q.empty.lead")}
            </Empty>
          )
        }
      </Await>
    </div>
  );
}
