import {
  ArrowDown,
  ArrowUp,
  BadgeCheck,
  Check,
  EyeOff,
  Image as ImageIcon,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { ApiError } from "../../../api";
import { useI18n, useT } from "../../../i18n";
import { lp } from "../../../lp/api";
import {
  type LpCandidate,
  type LpChecks,
  type LpContact,
  type LpIssue,
  type LpReference,
  MAX_REFERENCES,
  SLOT_IDS,
  type SlotId,
} from "../../../lp/types";
import { shownTitle } from "./Preview";

// ---------- references ----------

export function PermissionBadge({ r }: { r: LpReference }) {
  const t = useT();
  return r.permission === "named" ? (
    <span className="lp-badge named">
      <BadgeCheck size={14} aria-hidden /> {t("lp.ref.named")}
    </span>
  ) : (
    <span className="lp-badge masked">
      <EyeOff size={14} aria-hidden /> {t("lp.ref.generalised")}
    </span>
  );
}

interface RefsProps {
  draftId: string;
  references: LpReference[];
  lang: "fr" | "en";
  onChange: (next: LpReference[]) => void;
}

export function ReferencesPanel({ draftId, references, lang, onChange }: RefsProps) {
  const t = useT();
  const sid = useId();
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<LpCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [visuals, setVisuals] = useState<string[]>([]);
  const [pickFor, setPickFor] = useState<string | null>(null);
  const full = references.length >= MAX_REFERENCES;
  const have = new Set(references.map((r) => r.pageId));

  // The visuals on offer are the images of brain pages, from the unfiltered list.
  useEffect(() => {
    let live = true;
    lp.references(draftId, "").then(
      (r) => live && setVisuals([...new Set(r.map((c) => c.image).filter(Boolean))] as string[]),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [draftId]);

  useEffect(() => {
    let live = true;
    const h = window.setTimeout(() => {
      lp.references(draftId, term.trim()).then(
        (r) => {
          if (!live) return;
          setResults(r);
          setError(null);
        },
        (e: unknown) => live && setError(e instanceof ApiError ? e.reason : t("common.failed")),
      );
    }, 200);
    return () => {
      live = false;
      window.clearTimeout(h);
    };
  }, [draftId, term, t]);

  const add = (c: LpCandidate) => {
    if (have.has(c.pageId)) return;
    if (full) {
      setNote(t("lp.refs.max"));
      return;
    }
    onChange([...references, c]);
    setNote(t("lp.refs.added", { title: c.title }));
  };
  const remove = (id: string) => {
    onChange(references.filter((r) => r.pageId !== id));
    setNote("");
  };
  const move = (i: number, d: -1 | 1) => {
    const next = [...references];
    const [x] = next.splice(i, 1);
    if (x) next.splice(i + d, 0, x);
    onChange(next);
  };
  const swap = (id: string, image: string | undefined) => {
    onChange(references.map((r) => (r.pageId === id ? { ...r, image } : r)));
    setPickFor(null);
  };

  return (
    <section className="lp-panel" aria-labelledby={`${sid}-h`}>
      <div className="lp-panel-head">
        <h4 id={`${sid}-h`}>{t("lp.refs.title")}</h4>
        <span className="muted num" data-testid="ref-count">
          {t("lp.refs.count", { n: references.length, max: MAX_REFERENCES })}
        </span>
      </div>
      {references.length ? (
        <ol className="lp-refs">
          {references.map((r, i) => {
            const title = r.title;
            return (
              <li key={r.pageId} className="lp-ref" data-permission={r.permission}>
                <div className="lp-ref-img">
                  {r.image ? <img src={r.image} alt="" /> : null}
                  <PermissionBadge r={r} />
                </div>
                <div className="lp-ref-body">
                  <b>{title}</b>
                  <p className="muted lp-why">
                    {r.permission === "named"
                      ? t("lp.ref.named.why")
                      : t("lp.ref.gen.why", { shown: shownTitle(r, lang) })}
                  </p>
                </div>
                <div className="lp-ref-actions">
                  <button
                    type="button"
                    className="btn sm ghost icon"
                    disabled={i === 0}
                    aria-label={t("lp.ref.up.aria", { title })}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp size={15} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="btn sm ghost icon"
                    disabled={i === references.length - 1}
                    aria-label={t("lp.ref.down.aria", { title })}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown size={15} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="btn sm ghost icon"
                    aria-expanded={pickFor === r.pageId}
                    aria-label={t("lp.ref.visual.aria", { title })}
                    onClick={() => setPickFor(pickFor === r.pageId ? null : r.pageId)}
                  >
                    <ImageIcon size={15} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="btn sm ghost icon"
                    aria-label={t("lp.ref.remove.aria", { title })}
                    onClick={() => remove(r.pageId)}
                  >
                    <X size={15} aria-hidden />
                  </button>
                </div>
                {pickFor === r.pageId ? (
                  <div className="lp-visuals" role="group" aria-label={t("lp.ref.visual.pick")}>
                    {visuals.map((v, n) => (
                      <button
                        key={v}
                        type="button"
                        className="lp-visual"
                        aria-pressed={r.image === v}
                        aria-label={t("lp.ref.visual.opt", { n: n + 1 })}
                        onClick={() => swap(r.pageId, v)}
                      >
                        <img src={v} alt="" />
                      </button>
                    ))}
                    <button
                      type="button"
                      className="btn sm"
                      aria-pressed={!r.image}
                      onClick={() => swap(r.pageId, undefined)}
                    >
                      {t("lp.ref.visual.none")}
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="muted">{t("lp.refs.empty")}</p>
      )}

      <div className="field">
        <label htmlFor={`${sid}-q`}>{t("lp.refs.search")}</label>
        <div className="lp-search">
          <Search size={16} aria-hidden />
          <input
            id={`${sid}-q`}
            className="input"
            type="search"
            value={term}
            placeholder={t("lp.refs.search.ph")}
            onChange={(e) => setTerm(e.target.value)}
          />
        </div>
      </div>
      <p className="lp-note" role="status" data-testid="ref-note">
        {note}
      </p>
      {error ? (
        <div className="errorbox" role="alert">
          {error}
        </div>
      ) : null}
      {results && !results.length ? <p className="muted">{t("lp.refs.none")}</p> : null}
      <ul className="lp-cands">
        {(results ?? []).map((c) => {
          const title = c.title;
          const on = have.has(c.pageId);
          return (
            <li key={c.pageId} className="lp-cand">
              <div>
                <b>{title}</b> <PermissionBadge r={c} />
                <p className="muted">{c.summary}</p>
              </div>
              {on ? (
                <span className="muted">{t("lp.refs.in")}</span>
              ) : (
                <button
                  type="button"
                  className="btn sm"
                  aria-disabled={full}
                  aria-label={t("lp.refs.add.aria", { title })}
                  onClick={() => add(c)}
                >
                  <Plus size={14} aria-hidden /> {t("lp.refs.add")}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------- checks ----------

interface ChecksProps {
  checks: LpChecks | null;
  running: boolean;
  onRun: () => void;
  onFix: (issue: LpIssue) => void;
  headingRef?: React.Ref<HTMLHeadingElement>;
}

export function ChecksPanel({ checks, running, onRun, onFix, headingRef }: ChecksProps) {
  const t = useT();
  const { tn } = useI18n();
  const [recent, setRecent] = useState<{ id: number; text: string }[]>([]);
  const seq = useRef(0);
  const timers = useRef<number[]>([]);
  useEffect(
    () => () => {
      for (const x of timers.current) window.clearTimeout(x);
    },
    [],
  );
  const slotName = (s: string) =>
    (SLOT_IDS as readonly string[]).includes(s)
      ? t(`lp.slot.${s as SlotId}`)
      : s === "contact"
        ? t("lp.tab.contact")
        : t("lp.tab.refs");
  const fix = (i: LpIssue) => {
    const id = ++seq.current;
    setRecent((r) => [...r, { id, text: t("lp.checks.fixed", { slot: slotName(i.slot) }) }]);
    timers.current.push(
      window.setTimeout(() => setRecent((r) => r.filter((x) => x.id !== id)), 3600),
    );
    onFix(i);
  };
  const open = checks?.issues.length ?? 0;
  return (
    <section className="lp-panel" aria-labelledby="lp-checks-h">
      <div className="lp-panel-head">
        <h4 id="lp-checks-h" tabIndex={-1} ref={headingRef}>
          {t("lp.checks.title")}
        </h4>
        <button type="button" className="btn sm" onClick={onRun} disabled={running}>
          {running ? t("lp.checks.running") : t("lp.checks.run")}
        </button>
      </div>
      <p role="status" className={`lp-verdict ${checks ? (checks.ok ? "ok" : "open") : ""}`}>
        {checks
          ? checks.ok
            ? t("lp.checks.ok")
            : tn(open, "lp.checks.open.one", "lp.checks.open.other")
          : ""}
      </p>
      <div role="status" className="lp-recent">
        {recent.map((r) => (
          <p key={r.id} className="lp-fixed">
            <Check size={15} aria-hidden /> {r.text}
          </p>
        ))}
      </div>
      <ul className="lp-issues">
        {(checks?.issues ?? []).map((i) => (
          <li key={`${i.slot}-${i.kind}-${i.detail}`} className="lp-issue" data-kind={i.kind}>
            <div className="lp-issue-head">
              <b>{t(`lp.checks.kind.${i.kind}`)}</b>
              <span className="muted">{t("lp.checks.in", { slot: slotName(i.slot) })}</span>
            </div>
            <p>{i.detail}</p>
            {i.fix ? (
              <button
                type="button"
                className="btn sm primary"
                aria-label={t("lp.checks.fix.aria", { label: i.fix.label, slot: slotName(i.slot) })}
                onClick={() => fix(i)}
              >
                {i.fix.label}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- contact ----------

export function ContactPanel({
  contact,
  onChange,
}: {
  contact: LpContact;
  onChange: (c: LpContact) => void;
}) {
  const t = useT();
  const sid = useId();
  const field = (k: keyof LpContact, label: string, type = "text") => (
    <div className="field">
      <label htmlFor={`${sid}-${k}`}>{label}</label>
      <input
        id={`${sid}-${k}`}
        className="input"
        type={type}
        value={contact[k] ?? ""}
        onChange={(e) => onChange({ ...contact, [k]: e.target.value })}
      />
    </div>
  );
  return (
    <section className="lp-panel" aria-labelledby={`${sid}-h`}>
      <h4 id={`${sid}-h`}>{t("lp.contact.title")}</h4>
      {field("name", t("lp.contact.name"))}
      {field("title", t("lp.contact.role"))}
      {field("email", t("lp.contact.email"), "email")}
      <p className="muted">{t("lp.contact.note")}</p>
    </section>
  );
}
