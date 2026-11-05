import { Eye, EyeOff } from "lucide-react";
import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../../api";
import { Modal } from "../../components/Modal";
import { Await, Empty } from "../../components/ui";
import { useI18n } from "../../i18n";
import { ago } from "../../lib/time";
import { useApp } from "../../state";
import { useApi } from "../../useApi";
import { ux2 } from "../../uxv2/api";
import type { DiffLine, Question } from "../../uxv2/types";
import { QUESTIONS_CHANGED } from "./events";
import { QuestionCard } from "./QuestionCard";
import { isNewPage, useAuthor, useBrainNames } from "./shared";

const clean = (s: string) => s.replace(/\{src:[^}]+\}/g, "").replace(/\s+$/, "");

/** One line of Markdown source as the plain thing a reader would see: a heading, a list item or a paragraph. */
function Line({ l, title }: { l: DiffLine; title?: string }) {
  const { t } = useI18n();
  const raw = clean(l.text);
  const h = /^(#{1,3})\s+(.*)$/.exec(raw);
  const li = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(raw);
  const body: ReactNode = h ? <strong className="dl-h">{h[2]}</strong> : li ? li[1] : raw;
  const mark =
    l.type === "add" ? (
      <ins className="dl-add">
        <span className="sr-only">{t("wiki.prop.diff.add")} </span>
        {body}
      </ins>
    ) : l.type === "del" ? (
      <del className="dl-del">
        <span className="sr-only">{t("wiki.prop.diff.del")} </span>
        {body}
      </del>
    ) : (
      body
    );
  if (!raw.trim()) return null;
  // The page title is already the heading above the diff.
  if (l.type === "same" && title && raw.trim() === `# ${title}`) return null;
  return li ? (
    <div className="dl dl-li">
      <span aria-hidden className="dl-dot">
        •
      </span>
      <span>{mark}</span>
    </div>
  ) : (
    <p className={`dl${h ? " dl-head" : ""}`}>{mark}</p>
  );
}

interface Block {
  key: string;
  change: number | null;
  lines: DiffLine[];
}

/** Consecutive lines of one change (or of none) become one block. */
function blocksOf(diff: DiffLine[], page: number): Block[] {
  const out: Block[] = [];
  for (const l of diff) {
    const c = l.change ?? null;
    const last = out[out.length - 1];
    if (last && last.change === c) last.lines.push(l);
    else out.push({ key: `${page}-${out.length}`, change: c, lines: [l] });
  }
  return out;
}

const CONTEXT = 3;

/** A run of unchanged lines. Long runs fold up, so the changes stay in reach. */
function Context({ lines, title }: { lines: DiffLine[]; title: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const readable = lines.filter((l) => clean(l.text).trim());
  if (readable.length <= CONTEXT * 2 + 2 || open)
    return (
      <>
        {lines.map((l, i) => (
          // The diff is static once built, so index keys are stable.
          <Line key={i} l={l} title={title} />
        ))}
      </>
    );
  const head = readable.slice(0, CONTEXT);
  const tail = readable.slice(-CONTEXT);
  return (
    <>
      {head.map((l, i) => (
        <Line key={`h${i}`} l={l} title={title} />
      ))}
      <button type="button" className="fold" onClick={() => setOpen(true)}>
        {t("v4.diff.unchanged", { n: readable.length - CONTEXT * 2 })}
      </button>
      {tail.map((l, i) => (
        <Line key={`t${i}`} l={l} title={title} />
      ))}
    </>
  );
}

function Marker({
  index,
  total,
  seen,
  kinds,
  onSeen,
}: {
  index: number;
  total: number;
  seen: boolean;
  kinds: Set<DiffLine["type"]>;
  onSeen: () => void;
}) {
  const { t } = useI18n();
  const what =
    kinds.has("add") && kinds.has("del")
      ? t("v4.change.replaced")
      : kinds.has("del")
        ? t("v4.change.removed")
        : t("v4.change.added");
  return (
    <div className="cmark" id={`change-${index}`}>
      <span>
        <b>{t("v4.change.n", { n: index + 1, total })}</b> <span className="muted">{what}</span>
      </span>
      <span className="cstate">
        {seen ? (
          <span className="chip t-done">
            <Eye size={12} aria-hidden /> {t("v4.seen")}
          </span>
        ) : (
          <>
            <span className="chip t-open" data-testid="not-seen">
              <EyeOff size={12} aria-hidden /> {t("v4.notseen")}
            </span>
            <button type="button" className="linkbtn small" onClick={onSeen}>
              {t("v4.markseen")}
              <span className="sr-only"> {t("v4.change.n", { n: index + 1, total })}</span>
            </button>
          </>
        )}
      </span>
    </div>
  );
}

function DiffView({
  q,
  seen,
  mark,
}: {
  q: Question;
  seen: Set<number>;
  mark: (i: number) => void;
}) {
  const total = q.detail?.changeCount ?? 0;
  const pages = q.detail?.pages ?? [];
  const root = useRef<HTMLDivElement>(null);
  // A change counts as seen once it has been on screen for a moment, mostly in view.
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const timers = new Map<Element, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const idx = Number((e.target as HTMLElement).dataset.change);
          if (e.isIntersecting) {
            timers.set(
              e.target,
              window.setTimeout(() => mark(idx), 700),
            );
          } else {
            const tm = timers.get(e.target);
            if (tm) window.clearTimeout(tm);
          }
        }
      },
      { threshold: 0.6 },
    );
    for (const n of el.querySelectorAll("[data-change]")) io.observe(n);
    return () => {
      io.disconnect();
      for (const tm of timers.values()) window.clearTimeout(tm);
    };
  }, [mark]);
  return (
    <div className="diffdoc" ref={root}>
      {pages.map((p, pi) => (
        <section key={p.pageId} aria-label={p.title}>
          <h2 className="pagehead">{p.title}</h2>
          {blocksOf(p.diff, pi).map((b) =>
            b.change === null ? (
              <Context key={b.key} lines={b.lines} title={p.title} />
            ) : (
              <div
                key={b.key}
                className={`cblock${seen.has(b.change) ? " seen" : ""}`}
                data-change={b.change}
              >
                <Marker
                  index={b.change}
                  total={total}
                  seen={seen.has(b.change)}
                  kinds={new Set(b.lines.map((l) => l.type))}
                  onSeen={() => mark(b.change as number)}
                />
                {b.lines.map((l, i) => (
                  <Fragment key={i}>
                    <Line l={l} />
                  </Fragment>
                ))}
              </div>
            ),
          )}
        </section>
      ))}
    </div>
  );
}

function RejectModal({
  onClose,
  onReject,
  busy,
}: {
  onClose: () => void;
  onReject: (note: string) => void;
  busy: boolean;
}) {
  const { t } = useI18n();
  const [note, setNote] = useState("");
  return (
    <Modal
      title={t("v4.reject.title")}
      onClose={onClose}
      foot={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn danger"
            disabled={busy}
            onClick={() => onReject(note)}
          >
            {busy ? t("common.working") : t("v4.reject.go")}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="rj-note">{t("v4.reject.note")}</label>
        <textarea
          id="rj-note"
          className="textarea"
          style={{ minHeight: 96 }}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
    </Modal>
  );
}

function Review({ q }: { q: Question }) {
  const { t, tn } = useI18n();
  const { say } = useApp();
  const nav = useNavigate();
  const author = useAuthor();
  const names = useBrainNames();
  const total = q.detail?.changeCount ?? 0;
  const hash = q.detail?.revisionHash ?? "";
  const [seen, setSeen] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  // A new revision of the proposal means nothing has been seen yet.
  useEffect(() => setSeen(new Set()), [hash]);
  const mark = useCallback((i: number) => setSeen((s) => (s.has(i) ? s : new Set(s).add(i))), []);
  const left = total - seen.size;
  const approve = q.options.find((o) => /^(approve|accept|prefer|release)/.test(o.action));
  const reject = q.options.find((o) => /^(reject|request)/.test(o.action));
  const next = useMemo(() => {
    for (let i = 0; i < total; i++) if (!seen.has(i)) return i;
    return null;
  }, [seen, total]);

  const send = async (action: string, note?: string) => {
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
      say(t("q.done"));
      window.dispatchEvent(new Event(QUESTIONS_CHANGED));
      nav("/waiting");
    } catch (e) {
      setErr(e instanceof ApiError ? e.reason : t("common.failed"));
      setRejecting(false);
    } finally {
      setBusy(false);
    }
  };
  const d = q.detail ?? {};
  const by = author(q);
  return (
    <>
      <div className="page v4page proposal">
        <p className="backlink">
          <Link to="/waiting">← {t("v4.waiting")}</Link>
        </p>
        <header className="phead">
          <div className="row">
            <span className="tag outline">
              {isNewPage(q) ? t("v4.tag.new") : t("v4.tag.change")}
            </span>
            <span className="muted">
              {names(q.workspaceId)}
              {by ? ` · ${by}` : ""} · {ago(q.createdAt)}
            </span>
          </div>
          <h1 className="ptitle">{q.title}</h1>
          {q.summary ? <p className="muted">{q.summary}</p> : null}
          {d.required ? (
            <p className="twoperson" data-testid="two-person">
              {t("q.two", { n: d.approvals ?? 0, req: d.required })} {t("q.two.rule")}
            </p>
          ) : null}
        </header>
        {err ? (
          <div className="errorbox" role="alert">
            {err}
          </div>
        ) : null}
        <DiffView q={q} seen={seen} mark={mark} />
      </div>
      <div className="stickyfoot" role="region" aria-label={t("v4.decide")}>
        <p className="progress-txt" role="status">
          <Eye size={15} aria-hidden /> <b>{t("v4.seen.of", { n: seen.size, total })}</b>{" "}
          <span className="muted">{t("v4.seen.hint")}</span>
        </p>
        <div className="row">
          {next !== null ? (
            <a className="btn ghost sm" href={`#change-${next}`}>
              {t("v4.next.change")}
            </a>
          ) : null}
          {reject ? (
            <button
              type="button"
              className="btn danger"
              disabled={busy}
              onClick={() => setRejecting(true)}
            >
              {t("v4.reject")}
            </button>
          ) : null}
          {approve ? (
            <button
              type="button"
              className="btn primary"
              disabled={busy || left > 0}
              onClick={() => send(approve.action)}
            >
              {left > 0
                ? tn(left, "v4.approve.left.one", "v4.approve.left.other")
                : t("v4.approve")}
            </button>
          ) : null}
        </div>
      </div>
      {rejecting && reject ? (
        <RejectModal
          busy={busy}
          onClose={() => setRejecting(false)}
          onReject={(note) => send(reject.action, note)}
        />
      ) : null}
    </>
  );
}

/** `/waiting/:id`. A wiki proposal with changes is read change by change. Anything else is a plain card. */
export function ProposalPage() {
  const { id = "" } = useParams();
  const { t } = useI18n();
  const nav = useNavigate();
  const list = useApi(() => ux2.questions(), []);
  return (
    <Await state={list} skeleton={3}>
      {(items) => {
        const q = items.find((x) => x.id === id);
        if (!q)
          return (
            <div className="page v4page">
              <p className="backlink">
                <Link to="/waiting">← {t("v4.waiting")}</Link>
              </p>
              <Empty title={t("v4.proposal.gone")}>{t("v4.proposal.gone.lead")}</Empty>
            </div>
          );
        if ((q.detail?.changeCount ?? 0) > 0 && q.detail?.pages?.length)
          return <Review key={`${q.id}:${q.detail.revisionHash}`} q={q} />;
        return (
          <div className="page v4page narrow">
            <p className="backlink">
              <Link to="/waiting">← {t("v4.waiting")}</Link>
            </p>
            <QuestionCard
              q={q}
              onDone={() => {
                window.dispatchEvent(new Event(QUESTIONS_CHANGED));
                nav("/waiting");
              }}
            />
          </div>
        );
      }}
    </Await>
  );
}
