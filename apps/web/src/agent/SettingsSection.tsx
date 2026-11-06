// Settings > My Agent: density, card theme, answer language, token display, clear history.
// All of it stays on this device.
import { useState } from "react";
import { useI18n } from "../i18n";
import { useApp } from "../state";
import "./agent.css";
import { clearHistory, writeSettings } from "./settings";
import { useAgentSettings, useHistoryCount } from "./useSettings";

export default function AgentSettingsSection() {
  const { t } = useI18n();
  const { say } = useApp();
  const s = useAgentSettings();
  const n = useHistoryCount();
  const [ask, setAsk] = useState(false);
  return (
    <section aria-labelledby="ags-h">
      <h2 id="ags-h" className="sec-title">
        {t("v6.settings")}
      </h2>
      <p className="muted">{t("v6.set.lead")}</p>
      <div className="setcard stack">
        <fieldset className="radios">
          <legend>{t("v6.set.density")}</legend>
          {(["comfortable", "compact"] as const).map((v) => (
            <label key={v}>
              <input
                type="radio"
                name="ag-density"
                value={v}
                checked={s.density === v}
                onChange={() => writeSettings({ density: v })}
              />
              {t(`v6.set.density.${v}` as "v6.set.density.compact")}
            </label>
          ))}
        </fieldset>
        <fieldset className="radios">
          <legend>{t("v6.set.theme")}</legend>
          {(["dark", "light"] as const).map((v) => (
            <label key={v}>
              <input
                type="radio"
                name="ag-theme"
                value={v}
                checked={s.theme === v}
                onChange={() => writeSettings({ theme: v })}
              />
              {t(`v6.set.theme.${v}` as "v6.set.theme.dark")}
            </label>
          ))}
        </fieldset>
        <fieldset className="radios">
          <legend>{t("v6.set.lang")}</legend>
          {(["follow", "en", "fr"] as const).map((v) => (
            <label key={v}>
              <input
                type="radio"
                name="ag-lang"
                value={v}
                checked={s.lang === v}
                onChange={() => writeSettings({ lang: v })}
              />
              {v === "follow" ? t("v6.set.lang.follow") : v === "en" ? "English" : "Français"}
            </label>
          ))}
        </fieldset>
        <div className="field">
          <label className="ag-check">
            <input
              type="checkbox"
              checked={s.tokens}
              onChange={(e) => writeSettings({ tokens: e.target.checked })}
            />
            {t("v6.set.tokens")}
          </label>
          <p className="muted small">{t("v6.set.tokens.lead")}</p>
        </div>
        <div className="field">
          <h3>{t("v6.set.history")}</h3>
          <p className="muted">
            {t("v6.set.history.lead")} {t("v6.set.history.n", { n })}
          </p>
          {ask ? (
            <div className="row" role="group" aria-label={t("v6.history.clear")}>
              <button
                type="button"
                className="btn danger"
                onClick={() => {
                  clearHistory();
                  setAsk(false);
                  say(t("v6.history.cleared"));
                }}
              >
                {t("v6.history.clear")}
              </button>
              <button type="button" className="btn ghost" onClick={() => setAsk(false)}>
                {t("common.cancel")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn soft"
              disabled={n === 0}
              onClick={() => setAsk(true)}
            >
              {t("v6.history.clear")}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
