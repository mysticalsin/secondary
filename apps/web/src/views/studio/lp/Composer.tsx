import { Check, ShieldCheck } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { ApiError } from "../../../api";
import { ErrorBox } from "../../../components/ui";
import { useI18n } from "../../../i18n";
import { lp } from "../../../lp/api";
import type { LandingDraft, LpBrand, LpLang } from "../../../lp/types";

export function Composer({
  onCreated,
  onCancel,
}: {
  onCreated: (d: LandingDraft) => void;
  onCancel: () => void;
}) {
  const { t, lang } = useI18n();
  const sid = useId();
  const first = useRef<HTMLInputElement>(null);
  const [firstName, setFirstName] = useState("");
  const [role, setRole] = useState("");
  const [company, setCompany] = useState("");
  const [angle, setAngle] = useState("");
  const [brand, setBrand] = useState<LpBrand>("amaris");
  const [pageLang, setPageLang] = useState<LpLang>(lang);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [stage, setStage] = useState<number | null>(null);
  useEffect(() => first.current?.focus(), []);

  const ideas = [1, 2, 3, 4] as const;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!role.trim() || !company.trim() || !angle.trim()) {
      setErr(t("lp.c.required"));
      return;
    }
    setBusy(true);
    setErr(null);
    setStage(0);
    const reduced = window.matchMedia?.("(prefers-reduced-motion: no-preference)").matches !== true;
    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, reduced ? 0 : ms));
    try {
      const made = lp.compose({
        prospect: {
          ...(firstName.trim() ? { firstName: firstName.trim() } : {}),
          role: role.trim(),
          company: company.trim(),
        },
        angle: angle.trim(),
        brand,
        lang: pageLang,
      });
      // The page assembles in stages. The last stage waits for the real answer.
      for (const n of [1, 2]) {
        await wait(420);
        setStage(n);
      }
      await wait(420);
      const d = await made;
      setStage(4);
      await wait(520);
      onCreated(d);
    } catch (x) {
      setErr(x instanceof ApiError ? x.reason : t("common.failed"));
      setStage(null);
      setBusy(false);
    }
  };

  const STAGES = ["hero", "intro", "refs", "cta"] as const;
  if (stage !== null)
    return (
      <section className="lp-assemble" aria-labelledby={`${sid}-a`} data-testid="lp-assemble">
        <h3 id={`${sid}-a`}>{t("lp.asm.title")}</h3>
        <p className="sr-only" role="status">
          {stage >= 4 ? t("lp.asm.done") : t("lp.c.working")}
        </p>
        <ol className="lp-stages">
          {STAGES.map((k, i) => {
            const done = stage > i;
            return (
              <li key={k} className={done ? "done" : stage === i ? "now" : ""} data-done={done}>
                <span className="lp-tick" aria-hidden="true">
                  {done ? <Check size={16} /> : null}
                </span>
                <span>{t(`lp.asm.${k}`)}</span>
                <span className="lp-bar" aria-hidden="true" />
              </li>
            );
          })}
        </ol>
      </section>
    );

  return (
    <form className="lp-composer" onSubmit={submit} aria-labelledby={`${sid}-h`} noValidate>
      <div className="lp-composer-head">
        <h3 id={`${sid}-h`}>{t("lp.c.hero")}</h3>
        <p>{t("lp.c.sub")}</p>
      </div>
      <div className="lp-grid">
        <div className="field">
          <label htmlFor={`${sid}-first`}>{t("lp.c.first")}</label>
          <input
            id={`${sid}-first`}
            ref={first}
            className="input"
            autoComplete="off"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`${sid}-role`}>{t("lp.c.role")}</label>
          <input
            id={`${sid}-role`}
            className="input"
            required
            placeholder={t("lp.c.role.ph")}
            value={role}
            onChange={(e) => setRole(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`${sid}-co`}>{t("lp.c.company")}</label>
          <input
            id={`${sid}-co`}
            className="input"
            required
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`${sid}-angle`}>{t("lp.c.angle")}</label>
          <input
            id={`${sid}-angle`}
            className="input"
            required
            placeholder={t("lp.c.angle.ph")}
            value={angle}
            onChange={(e) => setAngle(e.target.value)}
          />
        </div>
      </div>
      <div className="lp-ideas" role="group" aria-label={t("lp.c.ideas")}>
        <span className="muted">{t("lp.c.ideas")}</span>
        {ideas.map((n) => (
          <button
            key={n}
            type="button"
            className="pill"
            aria-pressed={angle === t(`lp.c.idea.${n}`)}
            onClick={() => setAngle(t(`lp.c.idea.${n}`))}
          >
            {t(`lp.c.idea.${n}`)}
          </button>
        ))}
      </div>
      <div className="lp-grid two">
        <div className="field">
          <label htmlFor={`${sid}-brand`}>{t("lp.c.brand")}</label>
          <select
            id={`${sid}-brand`}
            className="select"
            value={brand}
            onChange={(e) => setBrand(e.target.value as LpBrand)}
          >
            <option value="amaris">{t("lp.brand.amaris")}</option>
            <option value="mantu">{t("lp.brand.mantu")}</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${sid}-lang`}>{t("lp.c.lang")}</label>
          <select
            id={`${sid}-lang`}
            className="select"
            value={pageLang}
            onChange={(e) => setPageLang(e.target.value as LpLang)}
          >
            <option value="en">{t("lp.lang.en")}</option>
            <option value="fr">{t("lp.lang.fr")}</option>
          </select>
        </div>
      </div>
      <p className="lp-privacy" data-testid="lp-privacy">
        <ShieldCheck size={16} aria-hidden /> <span>{t("lp.c.privacy")}</span>
      </p>
      {err ? <ErrorBox message={err} /> : null}
      <div className="row">
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? t("lp.c.working") : t("lp.c.submit")}
        </button>
        <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}
