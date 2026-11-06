import { useState } from "react";
import { ApiError } from "../../api";
import { useI18n } from "../../i18n";
import { useApp } from "../../state";
import { useApi } from "../../useApi";
import { deskApi } from "./api";

/** The brain's review SLA, shown on Members and access. A manager picks 1 to 10 business days. */
export function ReviewSla({ id }: { id: string }) {
  const { t, tn } = useI18n();
  const { say } = useApp();
  const sla = useApi(() => deskApi.sla(id), [id]);
  const [busy, setBusy] = useState(false);
  if (!sla.data) return null;
  const s = sla.data;
  const days = Array.from({ length: s.max - s.min + 1 }, (_, i) => s.min + i);
  const set = async (n: number) => {
    setBusy(true);
    try {
      await deskApi.setSla(id, n);
      say(t("v8r.sla.saved"));
      sla.reload();
    } catch (e) {
      say(e instanceof ApiError ? e.reason : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="asec" aria-labelledby="sla-h" data-testid="review-sla">
      <div className="split-row">
        <div>
          <h2 id="sla-h" className="sub">
            {t("v8r.sla.title")}
          </h2>
          <p className="muted publine">
            {tn(s.days, "v8r.sla.line.one", "v8r.sla.line.other")}{" "}
            {s.days === s.defaultDays ? t("v8r.sla.default") : null}
          </p>
        </div>
        {s.canSet ? (
          <div className="field" style={{ minWidth: 160 }}>
            <label htmlFor="sla-days">{t("v8r.sla.set")}</label>
            <select
              id="sla-days"
              className="select"
              value={s.days}
              disabled={busy}
              onChange={(e) => set(Number(e.target.value))}
            >
              {days.map((n) => (
                <option key={n} value={n}>
                  {tn(n, "v8r.sla.opt.one", "v8r.sla.opt.other")}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
    </section>
  );
}
