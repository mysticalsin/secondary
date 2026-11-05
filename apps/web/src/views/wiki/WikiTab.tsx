import { Check, History, Plus, Sparkles } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useState } from "react";
import { ApiError } from "../../api";
import { Await, Chip, Empty, ErrorBox, fmtDate, Skeleton, TableWrap } from "../../components/ui";
import { type Key, useI18n } from "../../i18n";
import { useApp } from "../../state";
import { useApi } from "../../useApi";
import { wikiApi } from "./api";
import { Markdown } from "./Markdown";
import type { MeetingInput, WikiAnswer, WikiHealth, WikiIndex } from "./types";
import { WikiDiff } from "./WikiDiff";
import { useWho, WikiProposalDetail } from "./WikiProposalDetail";
import "./wiki.css";

type Sub = "pages" | "facts" | "review" | "log";

export function HealthChips({ h }: { h: WikiHealth | null }) {
  const { t } = useI18n();
  if (!h) return null;
  return (
    <div className="row wiki-health">
      <Chip tone={h.score >= 80 ? "done" : h.score >= 50 ? "attn" : "risk"}>
        {t("wiki.health", { score: h.score })}
      </Chip>
      {h.openFindings ? (
        <Chip tone="attn">{t("wiki.health.findings", { n: h.openFindings })}</Chip>
      ) : null}
      {h.stale ? <Chip tone="attn">{t("wiki.health.stale", { n: h.stale })}</Chip> : null}
      {h.unverified ? (
        <Chip tone="open">{t("wiki.health.unverified", { n: h.unverified })}</Chip>
      ) : null}
      {h.openProposals ? (
        <Chip tone="progress">{t("wiki.health.review", { n: h.openProposals })}</Chip>
      ) : null}
    </div>
  );
}

const lines = (v: string): string[] =>
  v
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
const cells = (l: string): string[] => l.split("|").map((s) => s.trim());

function MeetingForm({
  ws,
  onDone,
  onCancel,
}: {
  ws: string;
  onDone: (m: string) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [dec, setDec] = useState("");
  const [com, setCom] = useState("");
  const [risk, setRisk] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const body: MeetingInput = {
      title: title.trim(),
      ...(date ? { date } : {}),
      decisions: lines(dec).map((l) => ({ title: l })),
      commitments: lines(com).map((l) => {
        const [tt = "", owner, due] = cells(l);
        return { title: tt, ...(owner ? { owner } : {}), ...(due ? { due } : {}) };
      }),
      risks: lines(risk).map((l) => {
        const [tt = "", severity] = cells(l);
        return { title: tt, ...(severity ? { severity } : {}) };
      }),
    };
    try {
      await wikiApi.meeting(ws, body);
      // The wiki drafts its changes in the background. Asking it now makes the diff appear right away.
      await wikiApi.run(ws).catch(() => undefined);
      onDone(t("wiki.meet.saved"));
    } catch (x) {
      setErr(x instanceof ApiError ? x.reason : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card stack" onSubmit={submit} aria-label={t("wiki.act.meeting")}>
      <div className="grid2">
        <div className="field">
          <label htmlFor="wm-title">{t("wiki.meet.title")}</label>
          <input
            id="wm-title"
            className="input"
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="wm-date">{t("wiki.meet.date")}</label>
          <input
            id="wm-date"
            className="input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="wm-dec">{t("wiki.meet.decisions")}</label>
        <textarea
          id="wm-dec"
          className="textarea"
          style={{ minHeight: 70 }}
          value={dec}
          onChange={(e) => setDec(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="wm-com">{t("wiki.meet.commitments")}</label>
        <textarea
          id="wm-com"
          className="textarea"
          style={{ minHeight: 70 }}
          value={com}
          onChange={(e) => setCom(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="wm-risk">{t("wiki.meet.risks")}</label>
        <textarea
          id="wm-risk"
          className="textarea"
          style={{ minHeight: 70 }}
          value={risk}
          onChange={(e) => setRisk(e.target.value)}
        />
      </div>
      <p className="muted" style={{ fontSize: 14 }}>
        {t("wiki.meet.note")}
      </p>
      {err ? <ErrorBox message={err} /> : null}
      <div className="row">
        <button type="submit" className="btn primary sm" disabled={busy || !title.trim()}>
          {busy ? t("common.saving") : t("wiki.meet.save")}
        </button>
        <button type="button" className="btn ghost sm" onClick={onCancel}>
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}

function ProposeForm({
  ws,
  onDone,
  onCancel,
}: {
  ws: string;
  onDone: (m: string) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [md, setMd] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await wikiApi.propose(ws, { title: title.trim(), markdown: md });
      onDone(t("wiki.propose.sent"));
    } catch (x) {
      setErr(x instanceof ApiError ? x.reason : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="card stack" onSubmit={submit} aria-label={t("wiki.act.propose")}>
      <div className="field">
        <label htmlFor="wp-title">{t("wiki.propose.title")}</label>
        <input
          id="wp-title"
          className="input"
          required
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="wp-md">{t("wiki.propose.text")}</label>
        <textarea
          id="wp-md"
          className="textarea"
          required
          style={{ minHeight: 140 }}
          maxLength={20000}
          value={md}
          onChange={(e) => setMd(e.target.value)}
        />
      </div>
      <p className="muted" style={{ fontSize: 14 }}>
        {t("wiki.propose.hint")}
      </p>
      {err ? <ErrorBox message={err} /> : null}
      <div className="row">
        <button
          type="submit"
          className="btn primary sm"
          disabled={busy || !title.trim() || !md.trim()}
        >
          {t("wiki.propose.send")}
        </button>
        <button type="button" className="btn ghost sm" onClick={onCancel}>
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}

function Promote({ ws, page, onDone }: { ws: string; page: string; onDone: (m: string) => void }) {
  const { t } = useI18n();
  const { me } = useApp();
  const [open, setOpen] = useState(false);
  const [flags, setFlags] = useState<{ id: string; excerpt: string; type: string }[]>([]);
  const [acked, setAcked] = useState<string[]>([]);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const send = async () => {
    setBusy(true);
    setErr(null);
    try {
      await wikiApi.promote(ws, page, {
        user_validated: { by: me?.principal.id ?? "", at: new Date().toISOString(), revision: 1 },
        acknowledged_flags: acked,
      });
      setOpen(false);
      onDone(t("wiki.promote.sent"));
    } catch (e) {
      if (e instanceof ApiError && e.body.error === "sensitivity_flags_pending")
        setFlags((e.body.sensitivity_flags as typeof flags) ?? []);
      else setErr(e instanceof ApiError ? e.reason : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };
  if (!open)
    return (
      <button type="button" className="btn sm" onClick={() => setOpen(true)}>
        {t("wiki.promote")}
      </button>
    );
  return (
    <div className="card stack">
      <p>{t("wiki.promote.note")}</p>
      {flags.length ? (
        <fieldset className="stack">
          <legend>{t("wiki.promote.flags")}</legend>
          {flags.map((f) => (
            <label key={f.id} className="row">
              <input
                type="checkbox"
                checked={acked.includes(f.id)}
                onChange={(e) =>
                  setAcked(e.target.checked ? [...acked, f.id] : acked.filter((x) => x !== f.id))
                }
              />
              <mark>{f.excerpt}</mark> <span className="muted">{f.type}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      <label className="row">
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        {t("wiki.promote.confirm")}
      </label>
      {err ? <ErrorBox message={err} /> : null}
      <div className="row">
        <button type="button" className="btn primary sm" disabled={busy || !checked} onClick={send}>
          {t("wiki.promote.send")}
        </button>
        <button type="button" className="btn ghost sm" onClick={() => setOpen(false)}>
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}

function PageView({
  ws,
  id,
  can,
  onOpen,
  onDone,
}: {
  ws: string;
  id: string;
  can: WikiIndex["can"];
  onOpen: (id: string) => void;
  onDone: (m: string) => void;
}) {
  const { t, td } = useI18n();
  const who = useWho();
  const page = useApi(() => wikiApi.page(ws, id), [ws, id]);
  const [hist, setHist] = useState(false);
  const history = useApi(
    () => (hist ? wikiApi.history(ws, id) : Promise.resolve([])),
    [ws, id, hist],
  );
  return (
    <Await state={page} skeleton={3}>
      {(p) => (
        <article className="card stack" aria-labelledby="wiki-page-h">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <h3 id="wiki-page-h">{p.title}</h3>
              <p className="muted" style={{ fontSize: 14 }}>
                {td("wiki.typ", p.type, p.type)} · {t("wiki.page.rev", { n: p.revision })} ·{" "}
                {fmtDate(p.updatedAt)}
              </p>
            </div>
            <span className="row">
              <button
                type="button"
                className="btn sm ghost"
                aria-expanded={hist}
                onClick={() => setHist(!hist)}
              >
                <History size={14} aria-hidden />{" "}
                {hist ? t("wiki.page.history.hide") : t("wiki.page.history")}
              </button>
              {can.promote && p.type !== "overview" ? (
                <Promote ws={ws} page={p.id} onDone={onDone} />
              ) : null}
            </span>
          </div>
          {p.restricted ? (
            <div className="reason">{t("wiki.page.restricted", { n: p.restricted })}</div>
          ) : null}
          {p.uncited ? (
            <div className="reason err">{t("wiki.page.uncited", { n: p.uncited })}</div>
          ) : null}
          <Markdown md={p.markdown} citations={p.citations} links={p.links} onLink={onOpen} />
          {hist ? (
            <section className="stack" aria-label={t("wiki.page.history")}>
              <Await state={history}>
                {(rows) => (
                  <ol className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {rows.map((r) => (
                      <li key={r.revision} className="itemrow">
                        <strong>
                          {t("wiki.hist.by", {
                            n: r.revision,
                            who: who(r.actor),
                            date: fmtDate(r.at),
                          })}
                        </strong>
                        <WikiDiff
                          lines={r.diff}
                          label={t("wiki.prop.diff", { title: `r${r.revision}` })}
                        />
                      </li>
                    ))}
                  </ol>
                )}
              </Await>
            </section>
          ) : null}
        </article>
      )}
    </Await>
  );
}

function AskBox({ ws, onOpen }: { ws: string; onOpen: (id: string) => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [ans, setAns] = useState<WikiAnswer | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      setAns(await wikiApi.ask(ws, q));
    } catch (x) {
      setErr(x instanceof ApiError ? x.reason : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="stack" aria-label={t("wiki.ask")}>
      <form className="row" onSubmit={go} role="search">
        <label className="sr-only" htmlFor="wiki-ask">
          {t("wiki.ask")}
        </label>
        <input
          id="wiki-ask"
          className="input"
          style={{ flex: 1 }}
          placeholder={t("wiki.ask.ph")}
          maxLength={300}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="submit" className="btn sm" disabled={busy || !q.trim()}>
          <Sparkles size={14} aria-hidden /> {t("wiki.ask.go")}
        </button>
      </form>
      {err ? <ErrorBox message={err} /> : null}
      {ans ? (
        <div className="card stack" role="status">
          {ans.unknown || !ans.answer ? (
            <p className="muted">{t("wiki.ask.unknown")}</p>
          ) : (
            <ul className="stack" style={{ margin: 0 }}>
              {ans.answer.map((a) => (
                <li key={`${a.pageId}-${a.text}`}>
                  {a.text}{" "}
                  <span className="muted">
                    {a.citations.map((c) => c.title).join(", ")} ·{" "}
                    <button type="button" className="linkbtn" onClick={() => onOpen(a.pageId)}>
                      {t("wiki.ask.from", { page: a.page })}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}

function FactsView({ ws, can }: { ws: string; can: WikiIndex["can"] }) {
  const { t, td } = useI18n();
  const { say } = useApp();
  const who = useWho();
  const facts = useApi(() => wikiApi.facts(ws), [ws]);
  return (
    <Await state={facts}>
      {(rows) =>
        rows.length === 0 ? (
          <Empty title={t("wiki.facts.empty")} />
        ) : (
          <div className="stack">
            <p className="muted">{t("wiki.facts.lead")}</p>
            <TableWrap label={t("wiki.facts.table")}>
              <table className="t">
                <thead>
                  <tr>
                    <th scope="col">{t("wiki.facts.attr")}</th>
                    <th scope="col">{t("wiki.facts.value")}</th>
                    <th scope="col">{t("wiki.facts.from")}</th>
                    <th scope="col">{t("wiki.facts.until")}</th>
                    <th scope="col">{t("wiki.facts.state")}</th>
                    <th scope="col">{t("wiki.facts.src")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((f) => (
                    <tr key={f.id} className={f.invalidAt ? "wiki-ended" : undefined}>
                      <td>
                        <strong>{f.subject.replace(/^[a-z]+: /, "")}</strong>
                        <div className="muted">{f.predicate}</div>
                      </td>
                      <td>{f.object}</td>
                      <td>{fmtDate(f.validAt)}</td>
                      <td>{f.invalidAt ? fmtDate(f.invalidAt) : t("wiki.facts.now")}</td>
                      <td>
                        <span className="row">
                          <Chip tone={f.invalidAt ? "open" : "done"}>
                            {f.invalidAt ? t("wiki.facts.ended") : t("wiki.facts.current")}
                          </Chip>
                          {f.unverified ? (
                            <Chip tone="attn">{t("wiki.fact.unverified")}</Chip>
                          ) : (
                            <Chip tone="done">
                              {t("wiki.fact.verified", { who: who(f.verifiedBy) })}
                            </Chip>
                          )}
                          <span className="muted">
                            {t("wiki.fact.origin", { o: td("wiki.origin", f.origin, f.origin) })}
                          </span>
                          {can.decide && f.unverified && !f.invalidAt ? (
                            <button
                              type="button"
                              className="btn sm ghost"
                              aria-label={t("wiki.fact.verify.aria", {
                                subject: f.subject,
                                attr: f.predicate,
                              })}
                              onClick={async () => {
                                await wikiApi.verify(ws, f.id);
                                say(t("wiki.fact.verified.done"));
                                facts.reload();
                              }}
                            >
                              <Check size={14} aria-hidden /> {t("wiki.fact.verify")}
                            </button>
                          ) : null}
                        </span>
                      </td>
                      <td>{f.sources.map((s) => s.title).join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </div>
        )
      }
    </Await>
  );
}

function ReviewView({
  ws,
  can,
  onChanged,
}: {
  ws: string;
  can: WikiIndex["can"];
  onChanged: () => void;
}) {
  const { t, td } = useI18n();
  const { say } = useApp();
  const who = useWho();
  const list = useApi(
    () => (can.decide ? wikiApi.proposals(ws) : Promise.resolve([])),
    [ws, can.decide],
  );
  const [sel, setSel] = useState<string | null>(null);
  if (!can.decide)
    return <Empty title={t("wiki.review.none.title")}>{t("wiki.review.none")}</Empty>;
  return (
    <Await state={list}>
      {(rows) => {
        if (!rows.length) return <Empty title={t("wiki.review.empty")} />;
        const cur = rows.find((r) => r.id === sel) ?? rows[0];
        return (
          <div className="split">
            <ul
              className="stack"
              style={{ listStyle: "none", margin: 0, padding: 0 }}
              aria-label={t("wiki.review.queue")}
            >
              {rows.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className="qitem"
                    aria-current={cur?.id === r.id}
                    onClick={() => setSel(r.id)}
                  >
                    <strong>{r.title}</strong>
                    <span className="muted" style={{ fontSize: 14 }}>
                      {td("wiki.kind", r.kind, r.kind)} · {who(r.authorId)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {cur ? (
              <WikiProposalDetail
                key={cur.id}
                ws={ws}
                id={cur.id}
                onDone={(m) => {
                  say(m);
                  setSel(null);
                  list.reload();
                  onChanged();
                }}
              />
            ) : null}
          </div>
        );
      }}
    </Await>
  );
}

function LogView({ ws }: { ws: string }) {
  const { t } = useI18n();
  const who = useWho();
  const log = useApi(() => wikiApi.log(ws), [ws]);
  return (
    <Await state={log}>
      {(rows) => (
        <div className="stack">
          <p className="muted">{t("wiki.log.lead")}</p>
          {rows.length === 0 ? (
            <p className="muted">{t("wiki.log.empty")}</p>
          ) : (
            <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {rows.map((e) => (
                <li key={e.id} className="itemrow">
                  <strong>{e.kind}</strong>{" "}
                  <span className="muted">
                    {who(e.actor)} · {fmtDate(e.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Await>
  );
}

function WikiBody({ ws, d, reload }: { ws: string; d: WikiIndex; reload: () => void }) {
  const { t, td } = useI18n();
  const { say } = useApp();
  const [sub, setSub] = useState<Sub>("pages");
  const [pageId, setPageId] = useState<string | null>(null);
  const [form, setForm] = useState<"meeting" | "propose" | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const first = d.pages[0]?.id ?? null;
  const open = pageId ?? first;
  const subs: { key: Sub; label: string }[] = [
    { key: "pages", label: t("wiki.sub.pages") },
    { key: "facts", label: t("wiki.sub.facts") },
    {
      key: "review",
      label: `${t("wiki.sub.review")}${d.health?.openProposals ? ` (${d.health.openProposals})` : ""}`,
    },
    { key: "log", label: t("wiki.sub.log") },
  ];
  const onKey = (e: KeyboardEvent) => {
    const i = subs.findIndex((s) => s.key === sub);
    const n =
      e.key === "ArrowRight"
        ? i + 1
        : e.key === "ArrowLeft"
          ? i - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? subs.length - 1
              : -1;
    if (n < 0) return;
    e.preventDefault();
    const s = subs[(n + subs.length) % subs.length];
    if (s) {
      setSub(s.key);
      document.getElementById(`wiki-tab-${s.key}`)?.focus();
    }
  };
  const done = (m: string) => {
    say(m);
    setForm(null);
    reload();
  };
  const run = async (jobs?: ("lint" | "dream")[]) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await wikiApi.run(ws, jobs);
      say(t("wiki.act.ran", { n: r.results.length }));
      reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.reason : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack wiki">
      <p className="muted">{d.personal ? t("wiki.lead.personal") : t("wiki.lead")}</p>
      <HealthChips h={d.health} />
      <div className="row">
        {d.can.edit ? (
          <button
            type="button"
            className="btn sm"
            onClick={() => setForm(form === "meeting" ? null : "meeting")}
          >
            <Plus size={14} aria-hidden /> {t("wiki.act.meeting")}
          </button>
        ) : null}
        {d.can.contribute ? (
          <button
            type="button"
            className="btn sm"
            onClick={() => setForm(form === "propose" ? null : "propose")}
          >
            <Plus size={14} aria-hidden /> {t("wiki.act.propose")}
          </button>
        ) : null}
        {d.can.decide ? (
          <>
            <button type="button" className="btn sm ghost" disabled={busy} onClick={() => run()}>
              {t("wiki.act.run")}
            </button>
            <button
              type="button"
              className="btn sm ghost"
              disabled={busy}
              onClick={() => run(["lint"])}
            >
              {t("wiki.act.lint")}
            </button>
            <button
              type="button"
              className="btn sm ghost"
              disabled={busy}
              onClick={() => run(["dream"])}
            >
              {t("wiki.act.dream")}
            </button>
          </>
        ) : null}
      </div>
      {err ? <ErrorBox message={err} /> : null}
      {d.personal && d.can.decide ? (
        <label className="row">
          <input
            type="checkbox"
            checked={d.settings.autoAccept}
            onChange={async (e) => {
              await wikiApi.settings(ws, { autoAccept: e.target.checked });
              reload();
            }}
          />
          <span>
            {t("wiki.act.auto")}
            <span className="muted" style={{ display: "block", fontSize: 14 }}>
              {t("wiki.act.auto.note")}
            </span>
          </span>
        </label>
      ) : null}
      {form === "meeting" ? (
        <MeetingForm ws={ws} onDone={done} onCancel={() => setForm(null)} />
      ) : null}
      {form === "propose" ? (
        <ProposeForm ws={ws} onDone={done} onCancel={() => setForm(null)} />
      ) : null}

      <div className="tabs" role="tablist" aria-label={t("wiki.sub")} onKeyDown={onKey}>
        {subs.map((s) => (
          <button
            key={s.key}
            id={`wiki-tab-${s.key}`}
            type="button"
            role="tab"
            className="tab"
            aria-selected={sub === s.key}
            aria-controls="wiki-panel"
            tabIndex={sub === s.key ? 0 : -1}
            onClick={() => setSub(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div id="wiki-panel" role="tabpanel" aria-labelledby={`wiki-tab-${sub}`}>
        {sub === "pages" ? (
          d.pages.length === 0 ? (
            <Empty title={t("wiki.pages.empty.title")}>{t("wiki.pages.empty")}</Empty>
          ) : (
            <div className="stack">
              <AskBox ws={ws} onOpen={setPageId} />
              <div className="split">
                <ul
                  className="stack"
                  style={{ listStyle: "none", margin: 0, padding: 0 }}
                  aria-label={t("wiki.pages.list")}
                >
                  {d.pages.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className="qitem"
                        aria-current={open === p.id}
                        onClick={() => setPageId(p.id)}
                      >
                        <strong>{p.title}</strong>
                        <span className="muted" style={{ fontSize: 14 }}>
                          {td("wiki.typ", p.type, p.type)}
                          {p.summary ? ` · ${p.summary}` : ""}
                        </span>
                        {p.restricted ? (
                          <Chip tone="attn">{t("wiki.restricted", { n: p.restricted })}</Chip>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
                {open ? (
                  <PageView
                    key={open}
                    ws={ws}
                    id={open}
                    can={d.can}
                    onOpen={setPageId}
                    onDone={done}
                  />
                ) : null}
              </div>
            </div>
          )
        ) : sub === "facts" ? (
          <FactsView ws={ws} can={d.can} />
        ) : sub === "review" ? (
          <ReviewView ws={ws} can={d.can} onChanged={reload} />
        ) : (
          <LogView ws={ws} />
        )}
      </div>
    </div>
  );
}

/** The Wiki tab of an account, circle or My Secondary. `ws` is the node id, or `me`. */
export function WikiTab({ ws }: { ws: string }) {
  const state = useApi(() => wikiApi.index(ws), [ws]);
  const { t } = useI18n();
  if (state.loading && !state.data) return <Skeleton n={3} />;
  if (state.error)
    return (
      <ErrorBox
        message={state.status === 501 ? t("wiki.err.mock") : state.error}
        onRetry={state.reload}
      />
    );
  if (!state.data) return null;
  return <WikiBody ws={ws} d={state.data} reload={state.reload} />;
}

export type { Key };
