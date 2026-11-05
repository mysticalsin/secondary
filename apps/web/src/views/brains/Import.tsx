import { FileUp, ShieldCheck } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError } from "../../api";
import { type Key, useI18n } from "../../i18n";
import { importArchive, MAX_IMPORT_BYTES } from "./api";
import { BrainFrame } from "./shared";
import type { BrainHome, ImportFormat, ImportPreview, ImportResult } from "./types";

const FORMATS: ImportFormat[] = ["okf", "obsidian", "outline"];
const STEPS: Key[] = [
  "b3.imp.step.source",
  "b3.imp.step.file",
  "b3.imp.step.check",
  "b3.imp.step.result",
];
const ACCEPT: Record<ImportFormat, string> = {
  okf: ".zip",
  obsidian: ".zip",
  outline: ".zip,.json",
};

export function ImportResults({ id, shared, r }: { id: string; shared: boolean; r: ImportResult }) {
  const { t, td } = useI18n();
  return (
    <div className="stack imp-results" data-testid="import-results">
      <p className="lead-ok" role="status">
        {shared
          ? t("b3.imp.done.shared", { n: r.imported.length })
          : t("b3.imp.done.personal", { n: r.imported.length })}
      </p>
      <section aria-labelledby="ir-in">
        <h4 id="ir-in">
          <span className="chip t-done">{t("b3.imp.v.ingest")}</span> {r.imported.length}
        </h4>
        <ul className="run-items">
          {r.imported.map((p) => (
            <li key={p.pageId}>
              <span className={`chip t-${p.state === "draft" ? "progress" : "done"}`}>
                {t(p.state === "draft" ? "b3.imp.draft" : "b3.imp.published")}
              </span>
              <span>{p.title}</span>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="ir-skip">
        <h4 id="ir-skip">
          <span className="chip t-open">{t("b3.imp.v.skip")}</span> {r.skipped.length}
        </h4>
        <ul className="run-items">
          {r.skipped.map((s) => (
            <li key={s.path}>
              <span>
                <span className="mono">{s.path}</span>
                <span className="muted">
                  {" "}
                  {td("b3.imp.why", s.reason, s.reason.replace(/_/g, " "))}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="ir-ask">
        <h4 id="ir-ask">
          <span className="chip t-attn">{t("b3.imp.v.ask")}</span> {r.asked}
        </h4>
        <p className="muted">{t("b3.imp.ask.lead")}</p>
      </section>
      <div className="row">
        <Link
          className="btn primary"
          to={shared ? `/questions?brain=${encodeURIComponent(id)}` : "/questions"}
        >
          {t("b3.imp.review")}
        </Link>
        <Link className="btn ghost" to={`/brains/${encodeURIComponent(id)}`}>
          {t("b3.imp.back")}
        </Link>
      </div>
    </div>
  );
}

export function ImportVerdicts({ p }: { p: ImportPreview }) {
  const { t, td } = useI18n();
  const clean = p.pages.filter((x) => x.verdict === "ingest");
  const asked = p.pages.filter((x) => x.verdict === "ask");
  const row = (x: ImportPreview["pages"][number]) => (
    <li key={x.pageId}>
      <span className={`chip t-${x.state === "draft" ? "progress" : "done"}`}>
        {t(x.state === "draft" ? "b3.imp.draft" : "b3.imp.published")}
      </span>
      <span>
        {x.title}
        {x.replaces ? <span className="muted"> · {t("b3.imp.prev.replaces")}</span> : null}
        {x.verdict === "ask" ? <span className="muted"> · {x.reason}</span> : null}
      </span>
    </li>
  );
  return (
    <div className="stack imp-verdicts" data-testid="import-preview">
      <p className="muted">{t("b3.imp.prev.lead")}</p>
      {!p.pages.length ? <p role="status">{t("b3.imp.prev.none")}</p> : null}
      <section aria-labelledby="iv-in">
        <h4 id="iv-in">
          <span className="chip t-done">{t("b3.imp.prev.in")}</span> {clean.length}
        </h4>
        <ul className="run-items">{clean.map(row)}</ul>
      </section>
      <section aria-labelledby="iv-ask">
        <h4 id="iv-ask">
          <span className="chip t-attn">{t("b3.imp.prev.ask")}</span> {asked.length}
        </h4>
        <ul className="run-items">{asked.map(row)}</ul>
      </section>
      <section aria-labelledby="iv-skip">
        <h4 id="iv-skip">
          <span className="chip t-open">{t("b3.imp.prev.skip")}</span> {p.skipped.length}
        </h4>
        <ul className="run-items">
          {p.skipped.map((s) => (
            <li key={s.path}>
              <span>
                <span className="mono">{s.path}</span>
                <span className="muted">
                  {" "}
                  {td("b3.imp.why", s.reason, s.reason.replace(/_/g, " "))}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function ImportWizard({ b }: { b: BrainHome }) {
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const [format, setFormat] = useState<ImportFormat>("okf");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [checking, setChecking] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const shared = b.type !== "personal";
  const tooBig = !!file && file.size > MAX_IMPORT_BYTES;

  // The check step runs the classifier as a dry run: verdicts first, nothing stored.
  const check = async () => {
    if (!file) return;
    setChecking(true);
    setErr(null);
    setPreview(null);
    try {
      setPreview(await importArchive(b.id, format, file, true));
    } catch (e) {
      setErr(e instanceof ApiError ? e.reason : t("common.failed"));
    } finally {
      setChecking(false);
    }
  };

  const go = (to: number) => {
    setStep(to);
    setErr(null);
    if (to === 2) void check();
  };

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      setResult(await importArchive(b.id, format, file));
      setStep(3);
    } catch (e) {
      setErr(e instanceof ApiError ? e.reason : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="wizard wide" aria-labelledby="imp-h">
      <h3 id="imp-h">{t("b3.imp.title")}</h3>
      <ol className="steps" aria-label={t("b3.imp.steps")}>
        {STEPS.map((k, i) => (
          <li
            key={k}
            aria-current={i === step ? "step" : undefined}
            className={i < step ? "done" : ""}
          >
            <span className="step-n" aria-hidden>
              {i + 1}
            </span>
            {t(k)}
          </li>
        ))}
      </ol>
      {err ? (
        <div className="errorbox" role="alert">
          {err}
        </div>
      ) : null}

      {step === 0 ? (
        <fieldset className="choices">
          <legend>{t("b3.imp.q.format")}</legend>
          {FORMATS.map((f) => (
            <label key={f} className="choice" htmlFor={`fmt-${f}`}>
              <input
                id={`fmt-${f}`}
                type="radio"
                name="format"
                checked={format === f}
                onChange={() => setFormat(f)}
              />
              <span>
                <b>{t(`b3.imp.f.${f}` as Key)}</b>
                <span className="muted">{t(`b3.imp.f.${f}.d` as Key)}</span>
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {step === 1 ? (
        <div className="stack">
          <div className="field">
            <label htmlFor="imp-file">{t("b3.imp.q.file")}</label>
            <input
              id="imp-file"
              ref={input}
              className="input"
              type="file"
              accept={ACCEPT[format]}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <p className="muted">{t("b3.imp.limits")}</p>
          {tooBig ? (
            <div className="errorbox" role="alert">
              {t("b3.imp.toobig")}
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 2 ? (
        <div className="stack">
          <p className="bound-why">
            <ShieldCheck size={16} aria-hidden />{" "}
            {shared ? t("b3.imp.rule.shared") : t("b3.imp.rule.personal")}
          </p>
          <dl className="facts">
            <div>
              <dt>{t("b3.imp.sum.format")}</dt>
              <dd>{t(`b3.imp.f.${format}` as Key)}</dd>
            </div>
            <div>
              <dt>{t("b3.imp.sum.file")}</dt>
              <dd>{file?.name}</dd>
            </div>
            <div>
              <dt>{t("b3.imp.sum.into")}</dt>
              <dd>{b.name}</dd>
            </div>
          </dl>
          <ul className="rules">
            <li>{t("b3.imp.r1")}</li>
            <li>{t("b3.imp.r2")}</li>
            <li>{t("b3.imp.r3")}</li>
          </ul>
          {checking ? (
            <p className="muted" role="status">
              {t("b3.imp.prev.loading")}
            </p>
          ) : null}
          {preview ? <ImportVerdicts p={preview} /> : null}
          {!checking && !preview && err ? (
            <button type="button" className="btn ghost" onClick={check}>
              {t("b3.imp.prev.retry")}
            </button>
          ) : null}
        </div>
      ) : null}

      {step === 3 && result ? <ImportResults id={b.id} shared={shared} r={result} /> : null}

      {step < 3 ? (
        <div className="row wiz-nav">
          <button
            type="button"
            className="btn ghost"
            disabled={step === 0 || busy}
            onClick={() => go(step - 1)}
          >
            {t("b3.back")}
          </button>
          {step < 2 ? (
            <button
              type="button"
              className="btn primary"
              disabled={step === 1 && (!file || tooBig)}
              onClick={() => go(step + 1)}
            >
              {t("b3.next")}
            </button>
          ) : (
            <button
              type="button"
              className="btn primary"
              onClick={submit}
              disabled={busy || checking || !preview || !preview.pages.length}
            >
              <FileUp size={16} aria-hidden /> {busy ? t("common.working") : t("b3.imp.go")}
            </button>
          )}
        </div>
      ) : null}
    </section>
  );
}

export function ImportPage() {
  const { id = "" } = useParams();
  return (
    <BrainFrame id={id} tab="import">
      {(b) => <ImportWizard b={b} />}
    </BrainFrame>
  );
}
