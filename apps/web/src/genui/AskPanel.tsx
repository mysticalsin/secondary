import { Sparkles } from "lucide-react";
import { type FormEvent, useState } from "react";
import { ApiError, api } from "../api";
import { ErrorBox } from "../components/ui";
import { type Key, useI18n } from "../i18n";
import { ViewRenderer } from "./ViewRenderer";

const IDEAS: Key[] = ["ask.idea.1", "ask.idea.2", "ask.idea.3", "ask.idea.4"];

export function AskPanel() {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState("");
  const [plan, setPlan] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (text: string) => {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setPlan(await api.plan({ prompt: text.trim() }));
    } catch (e) {
      setPlan(null);
      setError(e instanceof ApiError ? e.reason : t("ask.failed"));
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(prompt);
  };

  return (
    <section className="card" aria-labelledby="ask-h">
      <div className="eyebrow">{t("ask.eyebrow")}</div>
      <h3 id="ask-h" style={{ margin: "4px 0 6px" }}>
        {t("ask.title")}
      </h3>
      <p className="muted" style={{ marginBottom: 12 }}>
        {t("ask.lead")}
      </p>
      <form className="ask" onSubmit={submit}>
        <label htmlFor="ask-input" className="sr-only">
          {t("ask.label")}
        </label>
        <input
          id="ask-input"
          className="input"
          placeholder={t("ask.ph")}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <button type="submit" className="btn primary" disabled={busy || !prompt.trim()}>
          <Sparkles size={16} aria-hidden /> {busy ? t("ask.building") : t("ask.build")}
        </button>
      </form>
      <div className="pills" style={{ marginTop: 10 }}>
        {IDEAS.map((k) => (
          <button
            key={k}
            type="button"
            className="pill"
            onClick={() => {
              setPrompt(t(k));
              void run(t(k));
            }}
          >
            {t(k)}
          </button>
        ))}
      </div>
      {error ? (
        <div style={{ marginTop: 12 }}>
          <ErrorBox message={error} />
        </div>
      ) : null}
      {plan ? (
        <div style={{ marginTop: 16 }}>
          <ViewRenderer plan={plan} />
        </div>
      ) : null}
    </section>
  );
}
