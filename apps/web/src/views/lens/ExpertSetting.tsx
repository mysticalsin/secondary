import { useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import { useApp } from "../../state";
import { lensApi } from "./api";

/** Settings > Privacy: be left out of "Who knows" lists. On by default means listed. */
export function ExpertSetting() {
  const { t } = useI18n();
  const { say } = useApp();
  const [listed, setListed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    lensApi.listing().then(
      (r) => live && setListed(r.listed),
      () => live && setListed(true),
    );
    return () => {
      live = false;
    };
  }, []);
  const change = async (next: boolean) => {
    // The box answers at once; a refusal puts it back.
    const before = listed;
    setListed(next);
    setBusy(true);
    try {
      const r = await lensApi.setListing(next);
      setListed(r.listed);
      say(r.listed ? t("v8l.expert.on.done") : t("v8l.expert.off.done"));
    } catch {
      setListed(before);
      say(t("common.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="setcard expert8" aria-labelledby="expert-h" data-testid="expert-setting">
      <h3 id="expert-h" className="expert8-h">
        {t("v8l.expert.title")}
      </h3>
      <p className="muted">{t("v8l.expert.lead")}</p>
      {listed === null ? (
        <div className="skeleton" aria-hidden style={{ height: 28, marginTop: 8 }} />
      ) : (
        <label className="check8" htmlFor="expert-listed">
          <input
            id="expert-listed"
            type="checkbox"
            checked={listed === false}
            disabled={busy}
            onChange={(e) => change(!e.target.checked)}
          />
          <span>
            <b>{t("v8l.expert.label")}</b>
            <span className="muted"> {t("v8l.expert.hint")}</span>
          </span>
        </label>
      )}
    </section>
  );
}
