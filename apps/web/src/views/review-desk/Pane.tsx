import { Eye, EyeOff, MessageSquare, ShieldCheck } from "lucide-react";
import { type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../api";
import { useI18n } from "../../i18n";
import { ago } from "../../lib/time";
import { useApp } from "../../state";
import type { Async } from "../../useApi";
import { ux2 } from "../../uxv2/api";
import type { Question } from "../../uxv2/types";
import { QUESTIONS_CHANGED } from "../waiting/events";
import { DiffView } from "../waiting/Proposal";
import { QuestionCard } from "../waiting/QuestionCard";
import { deskApi } from "./api";
import { isWarning, NoteDialog, ReassignDialog, SnoozeDialog, useKinds } from "./Dialogs";
import { Effort, RISK_ICON, usePerson, useWho } from "./shared";
import type { DeskDetail, DeskRow, RiskKey } from "./types";

export interface PaneActions {
  approve: () => void;
  requestChanges: () => void;
  snooze: () => void;
  mention: () => void;
}

/** Items whose answer is a side or a yes/no on the card itself. */
const ON_CARD = new Set(["contradiction", "ingest"]);

const extra = (q: Question | undefined, k: string): string => {
  const v = (q?.detail as Record<string, unknown> | null | undefined)?.[k];
  return typeof v === "string" ? v : "";
};

function Risk({ d }: { d: DeskDetail | null }) {
  const { t, tn } = useI18n();
  const kinds = useKinds();
  const r = d?.risk;
  const rows: { key: RiskKey; hit: boolean; text: string }[] = [
    {
      key: "client",
      hit: !!r?.clients.length,
      text: r?.clients.length ? r.clients.join(", ") : t("v8r.risk.none"),
    },
    {
      key: "personal",
      hit: !!r?.personalData.count,
      text: r?.personalData.count
        ? t("v8r.risk.personal.n", { n: r.personalData.count, kinds: kinds(r.personalData.kinds) })
        : t("v8r.risk.none"),
    },
    {
      key: "confidential",
      hit: !!r?.confidential.length,
      text: r?.confidential.length ? r.confidential.join(", ") : t("v8r.risk.none"),
    },
    {
      key: "rule",
      hit: !!r?.rule,
      text: r?.rule ?? t("v8r.risk.none"),
    },
    {
      key: "unsupported",
      hit: !!r?.unsupported,
      text: r?.unsupported
        ? tn(r.unsupported, "v8r.risk.unsupported.one", "v8r.risk.unsupported.other")
        : t("v8r.risk.none"),
    },
  ];
  return (
    <section className="rv-card" aria-labelledby="rv-risk-h" data-testid="rv-risk">
      <h3 id="rv-risk-h">{t("v8r.risk.title")}</h3>
      {d ? (
        <dl className="rv-risk">
          {rows.map((x) => (
            <div key={x.key} className={x.hit ? "hit" : ""}>
              <dt>
                {RISK_ICON[x.key]} {t(`v8r.risk.${x.key}` as never)}
              </dt>
              <dd>{x.text}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="skeleton" style={{ height: 96 }} />
      )}
    </section>
  );
}

function Context({ d }: { d: DeskDetail | null }) {
  const { t } = useI18n();
  const c = d?.context;
  if (d && !c?.current && !c?.facts.length && !c?.hiddenFacts) return null;
  return (
    <section className="rv-card" aria-labelledby="rv-ctx-h">
      <h3 id="rv-ctx-h">{t("v8r.ctx.title")}</h3>
      {!c ? (
        <div className="skeleton" style={{ height: 72 }} />
      ) : (
        <div className="rv-ctx">
          {c.current ? (
            <div>
              <h4>{t("v8r.ctx.current", { title: c.pageTitle ?? "" })}</h4>
              {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region needs a keyboard stop */}
              {/* biome-ignore lint/a11y/useSemanticElements: preformatted page text */}
              <div className="rv-cur" role="region" aria-label={c.pageTitle ?? ""} tabIndex={0}>
                {c.current}
              </div>
            </div>
          ) : null}
          {c.facts.length || c.hiddenFacts ? (
            <div>
              <h4>{t("v8r.ctx.facts")}</h4>
              <ul className="rv-facts">
                {c.facts.map((f) => (
                  <li key={f.id}>
                    <b>{f.subject}</b> {f.predicate}: {f.object}
                  </li>
                ))}
                {c.hiddenFacts ? (
                  <li className="muted">{t("v8r.ctx.hidden", { n: c.hiddenFacts })}</li>
                ) : null}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

const Mentions = ({ text }: { text: string }) => (
  <>
    {text.split(/((?<![\w@.])@[A-Za-z0-9][A-Za-z0-9._-]+)/g).map((p, i) =>
      p.startsWith("@") ? (
        // biome-ignore lint/suspicious/noArrayIndexKey: a static split of one string
        <b key={i} className="rv-at">
          {p}
        </b>
      ) : (
        p
      ),
    )}
  </>
);

function Thread({
  id,
  d,
  taRef,
  onPosted,
}: {
  id: string;
  d: DeskDetail | null;
  taRef: MutableRefObject<HTMLTextAreaElement | null>;
  onPosted: () => void;
}) {
  const { t } = useI18n();
  const { say } = useApp();
  const person = usePerson();
  const kinds = useKinds();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [warn, setWarn] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const trailing = /(?:^|\s)@([A-Za-z0-9._-]*)$/.exec(text)?.[1];
  const suggest = (d?.eligible ?? [])
    .filter((p) => trailing === undefined || p.handle.startsWith(trailing.toLowerCase()))
    .slice(0, 6);
  const post = async (ack: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await deskApi.comment(id, text.trim(), ack);
      say(
        r.unresolved.length
          ? t("v8r.thread.posted.unresolved", {
              names: r.unresolved.map((h) => `@${h}`).join(", "),
            })
          : t("v8r.thread.posted"),
      );
      setText("");
      setWarn(null);
      onPosted();
    } catch (e) {
      const w = isWarning(e);
      if (w) setWarn(w);
      else setErr(e instanceof ApiError ? e.reason : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };
  const insert = (handle: string) => {
    const base =
      trailing === undefined
        ? `${text}${text && !/\s$/.test(text) ? " " : ""}@`
        : text.replace(/@[A-Za-z0-9._-]*$/, "@");
    setText(`${base}${handle} `);
    taRef.current?.focus();
  };
  return (
    <section className="rv-card" aria-labelledby="rv-thread-h" data-testid="rv-thread">
      <h3 id="rv-thread-h">
        <MessageSquare size={15} aria-hidden /> {t("v8r.thread.title")}
      </h3>
      {d ? (
        d.comments.length ? (
          <ul className="rv-comments">
            {d.comments.map((c) => (
              <li key={c.id} className={c.mine ? "mine" : ""}>
                <p className="rv-cmeta">
                  <b>{c.mine ? t("v8r.thread.you") : person(c.authorId, c.name)}</b>{" "}
                  <span className="muted">{ago(c.at)}</span>
                </p>
                <p>
                  <Mentions text={c.text} />
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{t("v8r.thread.none")}</p>
        )
      ) : (
        <div className="skeleton" style={{ height: 48 }} />
      )}
      <div className="field">
        <label htmlFor="rv-comment">{t("v8r.thread.label")}</label>
        <textarea
          id="rv-comment"
          ref={taRef}
          className="textarea"
          style={{ minHeight: 72 }}
          value={text}
          placeholder={t("v8r.thread.ph")}
          onChange={(e) => {
            setText(e.target.value);
            setWarn(null);
          }}
        />
      </div>
      {d?.eligible.length ? (
        <div className="rv-suggest" role="group" aria-label={t("v8r.thread.mention")}>
          <span className="muted">{t("v8r.thread.mention")}</span>
          {suggest.map((p) => (
            <button key={p.id} type="button" className="chipbtn" onClick={() => insert(p.handle)}>
              @{p.handle}
              <span className="sr-only"> {p.name}</span>
            </button>
          ))}
        </div>
      ) : null}
      {warn ? (
        <div className="rv-warn" role="alert">
          {t("v8r.pd.warn", { kinds: kinds(warn) })}
        </div>
      ) : null}
      {err ? (
        <div className="errorbox" role="alert">
          {err}
        </div>
      ) : null}
      <div className="row">
        {warn ? (
          <button type="button" className="btn" disabled={busy} onClick={() => post(true)}>
            {t("v8r.pd.confirm")}
          </button>
        ) : null}
        <button
          type="button"
          className="btn primary"
          disabled={busy || !text.trim()}
          onClick={() => {
            setWarn(null);
            post(false);
          }}
        >
          {busy ? t("common.working") : t("v8r.thread.post")}
        </button>
      </div>
    </section>
  );
}

/** The centre and right columns for one selected item. Remount per item and revision (`key`). */
export function Pane({
  row,
  q,
  detail,
  onDecided,
  onChanged,
  actionsRef,
}: {
  row: DeskRow;
  q: Question | undefined;
  detail: Async<DeskDetail | null>;
  onDecided: () => void;
  onChanged: () => void;
  actionsRef: MutableRefObject<PaneActions | null>;
}) {
  const { t, tn, locale } = useI18n();
  const { say } = useApp();
  const who = useWho();
  const person = usePerson();
  const d = detail.data && detail.data.id === row.id ? detail.data : null;
  const total = q?.detail?.changeCount ?? row.changeCount;
  const hash = q?.detail?.revisionHash ?? "";
  const hasDiff = !!q?.detail?.pages?.length && total > 0;
  const [seen, setSeen] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dlg, setDlg] = useState<"snooze" | "reassign" | "reject" | "changes" | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const headRef = useRef<HTMLHeadingElement | null>(null);
  const mark = useCallback((i: number) => setSeen((s) => (s.has(i) ? s : new Set(s).add(i))), []);
  const left = hasDiff ? total - seen.size : 0;
  const next = useMemo(() => {
    for (let i = 0; i < total; i++) if (!seen.has(i)) return i;
    return null;
  }, [seen, total]);
  const options = q?.options ?? [];
  const onCard = ON_CARD.has(row.kind);
  const approve = onCard
    ? undefined
    : options.find((o) => /^(approve|accept|release)/.test(o.action));
  const reject = onCard ? undefined : options.find((o) => /^reject/.test(o.action));
  const canChanges = row.kind === "review" || row.kind === "release";
  const canApprove = !!approve && !busy && left === 0;

  const finish = (msg: string) => {
    say(msg);
    window.dispatchEvent(new Event(QUESTIONS_CHANGED));
    onDecided();
  };
  const send = async (action: string, note?: string) => {
    if (!q) return;
    setBusy(true);
    setErr(null);
    try {
      await ux2.answer(q.id, {
        action,
        revisionHash: hash,
        ...(note?.trim() ? { note: note.trim() } : {}),
        ...(/^(approve|prefer|keep)/.test(action) && total
          ? { seenChanges: { revisionHash: hash, indexes: [...seen].sort((a, b) => a - b) } }
          : {}),
      });
      finish(t("q.done"));
    } catch (e) {
      setErr(e instanceof ApiError ? e.reason : t("common.failed"));
      setDlg(null);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    actionsRef.current = {
      approve: () => {
        if (!approve) return;
        if (canApprove) void send(approve.action);
        else if (left > 0) say(t("v8r.approve.readfirst", { n: left }));
      },
      requestChanges: () => canChanges && setDlg("changes"),
      snooze: () => setDlg("snooze"),
      mention: () => taRef.current?.focus(),
    };
  });
  useEffect(
    () => () => {
      actionsRef.current = null;
    },
    [actionsRef],
  );

  const by = who(row.author);
  const sums = d?.summary ?? row.summary;
  const twoPerson = row.required > 1;
  return (
    <>
      <section className="rv-focus" aria-labelledby="rv-focus-h" data-testid="rv-focus">
        <header className="rv-fhead">
          <p className="rv-fmeta">
            <span className="tag outline">{t(`v8r.what.${row.what}` as never)}</span>
            <span className="rv-brain">{row.brain.name}</span>
            {by ? <span className="muted">{by}</span> : null}
            <span className="muted">{ago(row.createdAt)}</span>
            <Effort n={row.effortMinutes} />
          </p>
          <h2 id="rv-focus-h" ref={headRef} tabIndex={-1}>
            {row.title}
          </h2>
          {hasDiff ? (
            <Link className="rv-full" to={`/review/${encodeURIComponent(row.id)}/full`}>
              {t("v8r.full")}
            </Link>
          ) : null}
        </header>
        <div className="rv-what-changed" data-testid="rv-summary">
          <h3>{t("v8r.summary.title")}</h3>
          <p>{sums.text}</p>
          {hasDiff ? <p className="muted small">{t("v8r.summary.note")}</p> : null}
        </div>
        {err ? (
          <div className="errorbox" role="alert">
            {err}
          </div>
        ) : null}
        {hasDiff && q ? <DiffView q={q} seen={seen} mark={mark} /> : null}
        {q && onCard ? (
          <QuestionCard
            q={q}
            onDone={() => {
              window.dispatchEvent(new Event(QUESTIONS_CHANGED));
              onDecided();
            }}
          />
        ) : null}
        {q && !hasDiff && !onCard ? (
          <div className="rv-plain">
            <p>{extra(q, "text") || q.summary}</p>
          </div>
        ) : null}
        <Risk d={d} />
        <Context d={d} />
        <Thread id={row.id} d={d} taRef={taRef} onPosted={() => detail.reload()} />
      </section>

      <aside className="rv-decide" aria-label={t("v8r.decide")} data-testid="rv-decide">
        <h2>{t("v8r.decide")}</h2>
        {hasDiff ? (
          <p className="rv-seen" role="status">
            {left === 0 ? <Eye size={15} aria-hidden /> : <EyeOff size={15} aria-hidden />}{" "}
            <b>{t("v4.seen.of", { n: seen.size, total })}</b>
            <span className="muted"> {t("v4.seen.hint")}</span>
          </p>
        ) : null}
        {hasDiff && next !== null ? (
          <a className="btn ghost sm" href={`#change-${next}`}>
            {t("v4.next.change")}
          </a>
        ) : null}
        {onCard ? <p className="muted">{t("v8r.oncard")}</p> : null}
        {approve ? (
          <button
            type="button"
            className="btn primary block"
            data-testid="rv-approve"
            disabled={!canApprove}
            aria-keyshortcuts="A"
            onClick={() => send(approve.action)}
          >
            {left > 0 ? tn(left, "v4.approve.left.one", "v4.approve.left.other") : approve.label}
          </button>
        ) : null}
        {canChanges ? (
          <button
            type="button"
            className="btn block"
            disabled={busy}
            aria-keyshortcuts="R"
            onClick={() => setDlg("changes")}
          >
            {t("v8r.changes")}
          </button>
        ) : null}
        {reject ? (
          <button
            type="button"
            className="btn danger block"
            disabled={busy}
            onClick={() => setDlg("reject")}
          >
            {t("v4.reject")}
          </button>
        ) : null}
        <hr />
        <button
          type="button"
          className="btn block"
          disabled={busy}
          onClick={() => setDlg("reassign")}
        >
          {t("v8r.reassign")}
        </button>
        {d?.state.assignedTo ? (
          <p className="muted small">
            {t("v8r.assigned.to", { name: person(d.state.assignedTo.id, d.state.assignedTo.name) })}
          </p>
        ) : null}
        <button
          type="button"
          className="btn block"
          disabled={busy}
          aria-keyshortcuts="S"
          onClick={() => setDlg("snooze")}
        >
          {t("v8r.snooze")}
        </button>
        {row.snoozedUntil ? (
          <p className="muted small">
            {t("v8r.snoozed.until", {
              date: new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
                new Date(row.snoozedUntil),
              ),
            })}
          </p>
        ) : null}
        <hr />
        <div className="rv-two" data-testid="two-person">
          <ShieldCheck size={16} aria-hidden />
          <div>
            <b>
              {twoPerson
                ? t("q.two", { n: row.approvals, req: row.required })
                : t("v8r.one.person")}
            </b>
            <span className="q-dots" aria-hidden>
              {Array.from({ length: row.required }, (_, i) => (
                <i key={`d${i}`} className={i < row.approvals ? "on" : ""} />
              ))}
            </span>
            {twoPerson ? <p className="muted small">{t("q.two.rule")}</p> : null}
          </div>
        </div>
      </aside>

      {dlg === "snooze" ? (
        <SnoozeDialog
          id={row.id}
          current={row.snoozedUntil}
          onClose={() => setDlg(null)}
          onDone={() => {
            setDlg(null);
            say(t("v8r.snooze.done"));
            onChanged();
          }}
        />
      ) : null}
      {dlg === "reassign" ? (
        <ReassignDialog
          id={row.id}
          people={d?.eligible ?? []}
          current={d?.state.assignedTo?.id ?? null}
          onClose={() => setDlg(null)}
          onDone={() => {
            setDlg(null);
            say(t("v8r.reassign.done"));
            onChanged();
            detail.reload();
          }}
        />
      ) : null}
      {dlg === "reject" && reject ? (
        <NoteDialog
          title={t("v4.reject.title")}
          label={t("v4.reject.note")}
          go={t("v4.reject.go")}
          tone="danger"
          required={false}
          onClose={() => setDlg(null)}
          onSend={(note) => send(reject.action, note)}
        />
      ) : null}
      {dlg === "changes" ? (
        <NoteDialog
          title={t("v8r.changes.title")}
          label={t("v8r.changes.note")}
          go={t("v8r.changes.go")}
          tone="primary"
          required
          onClose={() => setDlg(null)}
          onSend={async (note, ack) => {
            await deskApi.requestChanges(row.id, note, hash, ack);
            setDlg(null);
            say(t("v8r.changes.done"));
            window.dispatchEvent(new Event(QUESTIONS_CHANGED));
            onDecided();
          }}
        />
      ) : null}
    </>
  );
}
