import { Sparkles } from "lucide-react";
import { type FormEvent, useState } from "react";
import { ApiError, api } from "../api";
import { ErrorBox } from "../components/ui";
import { ViewRenderer } from "./ViewRenderer";

const IDEAS = [
  "Show AI use cases by governance",
  "Summarise the Acme account",
  "What is waiting for review?",
  "Company map at a glance",
];

export function AskPanel() {
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
      setError(e instanceof ApiError ? e.reason : "Could not build a view.");
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
      <div className="eyebrow">Ask Secondary</div>
      <h3 id="ask-h" style={{ margin: "4px 0 6px" }}>
        Ask for a view
      </h3>
      <p className="muted" style={{ marginBottom: 12 }}>
        Secondary builds the view from trusted blocks and fills them with what your role can see.
      </p>
      <form className="ask" onSubmit={submit}>
        <label htmlFor="ask-input" className="sr-only">
          What do you want to see
        </label>
        <input
          id="ask-input"
          className="input"
          placeholder="For example: AI use cases by governance"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <button type="submit" className="btn primary" disabled={busy || !prompt.trim()}>
          <Sparkles size={16} aria-hidden /> {busy ? "Building" : "Build view"}
        </button>
      </form>
      <div className="pills" style={{ marginTop: 10 }}>
        {IDEAS.map((i) => (
          <button
            key={i}
            type="button"
            className="pill"
            onClick={() => {
              setPrompt(i);
              void run(i);
            }}
          >
            {i}
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
