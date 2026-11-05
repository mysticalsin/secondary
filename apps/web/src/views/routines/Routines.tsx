import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { ApiError, api } from "../../api";
import { Await, Empty, fmtDate, PageHead } from "../../components/ui";
import { type Key, useI18n } from "../../i18n";
import { useApp } from "../../state";
import { useApi } from "../../useApi";
import { ux2 } from "../../uxv2/api";
import type { Routine, RoutineInput, RoutineRun } from "../../uxv2/types";

const SOURCES: Routine["source"]["kind"][] = ["meetings", "notes", "sharepoint", "manual"];
const SCHEDULES: Routine["schedule"][] = ["daily", "weekly", "manual"];

const srcKey = (k: string): Key => `rt.src.${k}` as Key;
const schKey = (k: string): Key => `rt.sch.${k}` as Key;

const TONE = { ingest: "done", skip: "open", ask: "attn" } as const;

function Runs({ id }: { id: string }) {
  const { t, td, locale } = useI18n();
  const runs = useApi(() => ux2.runs(id), [id]);
  return (
    <Await state={runs} skeleton={2}>
      {(list: RoutineRun[]) =>
        list.length ? (
          <ul className="runs">
            {list.map((r) => (
              <li key={r.id}>
                <p className="run-head">
                  <b>
                    {new Intl.DateTimeFormat(locale, {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: "America/Toronto",
                    }).format(new Date(r.at))}
                  </b>
                  <span className="muted">
                    {t("rt.run.sum", { a: r.ingested, b: r.skipped, c: r.asked, tok: r.tokens })}
                  </span>
                </p>
                <ul className="run-items">
                  {r.items.map((it) => (
                    <li key={`${r.id}-${it.title}`}>
                      <span className={`chip t-${TONE[it.verdict]}`}>
                        {td("rt.verdict", it.verdict, it.verdict)}
                      </span>
                      <span>
                        {it.title}
                        <span className="muted"> {it.reason}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{t("rt.run.none")}</p>
        )
      }
    </Await>
  );
}

function RoutineRow({ r, onChange }: { r: Routine; onChange: () => void }) {
  const { t } = useI18n();
  const { say } = useApp();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [tick, setTick] = useState(0);
  const wrap = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) say(ok);
      onChange();
    } catch (e) {
      say(e instanceof ApiError ? e.reason : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="rt-card">
      <div className="rt-top">
        <div>
          <h3>{r.name}</h3>
          <p className="muted">
            {t("rt.line", {
              src: t(srcKey(r.source.kind)),
              scope: r.targetScopeId === "me" ? t("rt.scope.me") : r.targetScopeId,
              sch: t(schKey(r.schedule)).toLowerCase(),
            })}
          </p>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={r.enabled}
            disabled={busy}
            onChange={() => wrap(() => ux2.updateRoutine(r.id, { ...r, enabled: !r.enabled }))}
          />
          <span>{r.enabled ? t("rt.on") : t("rt.off")}</span>
          <span className="sr-only"> {r.name}</span>
        </label>
      </div>
      <div className="row">
        <button
          type="button"
          className="btn sm"
          disabled={busy}
          onClick={() =>
            wrap(async () => {
              await ux2.runRoutine(r.id);
              setTick((n) => n + 1);
              setOpen(true);
            }, t("rt.ran"))
          }
        >
          {t("rt.run")}
        </button>
        <button
          type="button"
          className="btn sm ghost"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronDown size={14} aria-hidden /> {t("rt.history")}
        </button>
        {confirm ? (
          <>
            <button
              type="button"
              className="btn sm danger"
              disabled={busy}
              onClick={() => wrap(() => ux2.deleteRoutine(r.id))}
            >
              {t("rt.delete.yes")}
            </button>
            <button type="button" className="btn sm ghost" onClick={() => setConfirm(false)}>
              {t("common.cancel")}
            </button>
          </>
        ) : (
          <button type="button" className="btn sm ghost" onClick={() => setConfirm(true)}>
            <Trash2 size={14} aria-hidden /> {t("rt.delete")}
          </button>
        )}
      </div>
      {open ? <Runs key={tick} id={r.id} /> : null}
    </li>
  );
}

const STEPS: Key[] = ["rt.step.source", "rt.step.scope", "rt.step.schedule", "rt.step.guard"];

export function Wizard({ onCancel, onCreated }: { onCancel: () => void; onCreated: () => void }) {
  const { t } = useI18n();
  const { say } = useApp();
  const targets = useApi(() => api.contributeTargets(), []);
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<Routine["source"]["kind"]>("meetings");
  const [ref, setRef] = useState("");
  const [scope, setScope] = useState("me");
  const [schedule, setSchedule] = useState<Routine["schedule"]>("weekly");
  const [news, setNews] = useState(true);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setErr(null);
    const input: RoutineInput = {
      name: name.trim() || t("rt.name.default", { src: t(srcKey(kind)) }),
      source: { kind, ...(kind === "sharepoint" && ref.trim() ? { ref: ref.trim() } : {}) },
      schedule,
      targetScopeId: scope,
      guardrails: { excludePersonal: true, excludeHR: true, excludeNewsletters: news },
      enabled: true,
    };
    try {
      await ux2.createRoutine(input);
      say(t("rt.created"));
      onCreated();
    } catch (e) {
      setErr(e instanceof ApiError ? e.reason : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="wizard" aria-labelledby="wiz-h">
      <h3 id="wiz-h">{t("rt.new")}</h3>
      <ol className="steps" aria-label={t("rt.steps")}>
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

      {step === 0 ? (
        <fieldset className="choices">
          <legend>{t("rt.q.source")}</legend>
          {SOURCES.map((s) => (
            <label key={s} className="choice">
              <input type="radio" name="src" checked={kind === s} onChange={() => setKind(s)} />
              <span>
                <b>{t(srcKey(s))}</b>
                <span className="muted">{t(`rt.srcd.${s}` as Key)}</span>
              </span>
            </label>
          ))}
          {kind === "sharepoint" ? (
            <div className="field">
              <label htmlFor="rt-ref">{t("rt.ref")}</label>
              <input
                id="rt-ref"
                className="input"
                value={ref}
                onChange={(e) => setRef(e.target.value)}
              />
            </div>
          ) : null}
        </fieldset>
      ) : null}

      {step === 1 ? (
        <div className="field">
          <label htmlFor="rt-scope">{t("rt.q.scope")}</label>
          <select
            id="rt-scope"
            className="select"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="me">{t("rt.scope.me")}</option>
            {(targets.data ?? []).map((tg) => (
              <option key={tg.id} value={tg.id}>
                {tg.label}
              </option>
            ))}
          </select>
          <p className="muted">{t("rt.scope.note")}</p>
        </div>
      ) : null}

      {step === 2 ? (
        <fieldset className="choices">
          <legend>{t("rt.q.schedule")}</legend>
          {SCHEDULES.map((s) => (
            <label key={s} className="choice">
              <input
                type="radio"
                name="sch"
                checked={schedule === s}
                onChange={() => setSchedule(s)}
              />
              <span>
                <b>{t(schKey(s))}</b>
                <span className="muted">{t(`rt.schd.${s}` as Key)}</span>
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {step === 3 ? (
        <div className="stack">
          <fieldset className="choices">
            <legend>{t("rt.q.guard")}</legend>
            <label className="choice locked">
              <input type="checkbox" checked disabled readOnly />
              <span>
                <b>{t("rt.g.personal")}</b>
                <span className="muted">{t("rt.g.always")}</span>
              </span>
            </label>
            <label className="choice locked">
              <input type="checkbox" checked disabled readOnly />
              <span>
                <b>{t("rt.g.hr")}</b>
                <span className="muted">{t("rt.g.always")}</span>
              </span>
            </label>
            <label className="choice">
              <input type="checkbox" checked={news} onChange={(e) => setNews(e.target.checked)} />
              <span>
                <b>{t("rt.g.news")}</b>
                <span className="muted">{t("rt.g.news.d")}</span>
              </span>
            </label>
          </fieldset>
          <div className="field">
            <label htmlFor="rt-name">{t("rt.name")}</label>
            <input
              id="rt-name"
              className="input"
              value={name}
              placeholder={t("rt.name.default", { src: t(srcKey(kind)) })}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {err ? (
            <div className="errorbox" role="alert">
              {err}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="row wiz-nav">
        <button
          type="button"
          className="btn ghost"
          onClick={step === 0 ? onCancel : () => setStep(step - 1)}
        >
          {step === 0 ? t("common.cancel") : t("rt.back")}
        </button>
        {step < 3 ? (
          <button type="button" className="btn primary" onClick={() => setStep(step + 1)}>
            {t("rt.next")}
          </button>
        ) : (
          <button type="button" className="btn primary" onClick={create} disabled={busy}>
            {busy ? t("common.working") : t("rt.create")}
          </button>
        )}
      </div>
    </section>
  );
}

export function Routines() {
  const { t } = useI18n();
  const list = useApi(() => ux2.routines(), []);
  const [wizard, setWizard] = useState(false);
  return (
    <div className="page routines">
      <PageHead eyebrow={t("nav.routines")} title={t("rt.title")} lead={t("rt.lead")} />
      {wizard ? (
        <Wizard
          onCancel={() => setWizard(false)}
          onCreated={() => {
            setWizard(false);
            list.reload();
          }}
        />
      ) : (
        <Await state={list} skeleton={2}>
          {(rows) => (
            <>
              <div className="row">
                <button type="button" className="btn primary" onClick={() => setWizard(true)}>
                  <Plus size={16} aria-hidden /> {t("rt.new")}
                </button>
              </div>
              {rows.length ? (
                <ul className="rt-list">
                  {rows.map((r) => (
                    <RoutineRow key={r.id} r={r} onChange={list.reload} />
                  ))}
                </ul>
              ) : (
                <Empty title={t("rt.empty.title")}>{t("rt.empty.lead")}</Empty>
              )}
            </>
          )}
        </Await>
      )}
    </div>
  );
}
