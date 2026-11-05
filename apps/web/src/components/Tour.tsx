import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Key } from "../i18n";
import { useT } from "../i18n";
import { useFocusTrap } from "../lib/focus";
import { useApp } from "../state";

const STEPS: { title: Key; body: Key }[] = [
  { title: "tour.1.title", body: "tour.1.body" },
  { title: "tour.2.title", body: "tour.2.body" },
  { title: "tour.3.title", body: "tour.3.body" },
  { title: "tour.4.title", body: "tour.4.body" },
];

/**
 * First-run tour. It never blocks: Skip, Escape and Done all close it, and the choice is stored
 * for the person (preferences API), so it does not come back on another device.
 */
export function Tour() {
  const { tourOpen, finishTour } = useApp();
  const t = useT();
  const [i, setI] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useFocusTrap(box, tourOpen);

  useEffect(() => {
    if (tourOpen) {
      setI(0);
      box.current?.querySelector<HTMLElement>("button.primary")?.focus();
    }
  }, [tourOpen]);

  if (!tourOpen) return null;
  const step = STEPS[i] as (typeof STEPS)[number];
  const last = i === STEPS.length - 1;
  return (
    <div
      ref={box}
      className="tour"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-h"
      onKeyDown={(e) => e.key === "Escape" && finishTour()}
    >
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="eyebrow">{t("tour.step", { n: i + 1, total: STEPS.length })}</span>
        <button
          type="button"
          className="icon-btn"
          aria-label={t("tour.close")}
          onClick={finishTour}
        >
          <X size={16} aria-hidden />
        </button>
      </div>
      <h3 id="tour-h">{t(step.title)}</h3>
      <p>{t(step.body)}</p>
      <div className="row" style={{ marginTop: 12 }}>
        <button type="button" className="btn ghost sm" onClick={finishTour}>
          {t("tour.skip")}
        </button>
        <span className="sp" />
        {i > 0 ? (
          <button type="button" className="btn sm" onClick={() => setI(i - 1)}>
            {t("tour.back")}
          </button>
        ) : null}
        <button
          type="button"
          className="btn primary sm"
          onClick={() => (last ? finishTour() : setI(i + 1))}
        >
          {last ? t("tour.done") : t("tour.next")}
        </button>
      </div>
    </div>
  );
}
