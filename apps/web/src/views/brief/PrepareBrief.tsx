import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError, api } from "../../api";
import { Chip, ErrorBox } from "../../components/ui";
import type { AccountCard } from "../../types";
import { BriefView } from "./BriefView";
import type { AiStatus, BriefRequest, BriefResponse } from "./types";

/** Status of the processor, for the button label. A failed call reads as not configured. */
function useAiStatus(): AiStatus | null {
  const [s, setS] = useState<AiStatus | null>(null);
  useEffect(() => {
    let live = true;
    api.aiStatus().then(
      (v) => live && setS(v),
      () =>
        live &&
        setS({
          state: "not_configured",
          reason: "AI processor not configured",
          processor: "Anthropic API",
          model: null,
          region: "",
        }),
    );
    return () => {
      live = false;
    };
  }, []);
  return s;
}

/** Button plus result for one account (and optionally one meeting). */
export function PrepareBrief({
  accountId,
  meetingId,
  label = "Prepare brief",
  aiProcessing,
}: {
  accountId: string;
  meetingId?: string;
  label?: string;
  aiProcessing?: AccountCard["aiProcessing"];
}) {
  const status = useAiStatus();
  const [result, setResult] = useState<BriefResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState("");

  const blocked =
    status === null
      ? "Checking the AI processor."
      : status.state !== "ready"
        ? (status.reason ?? "AI processor not configured")
        : aiProcessing && aiProcessing !== "allowed"
          ? `The contract record for this account says AI processing is ${aiProcessing}.`
          : null;

  const run = async () => {
    setBusy(true);
    setError(null);
    const body: BriefRequest = {
      accountId,
      save: false,
      ...(meetingId ? { meetingId } : {}),
      ...(question.trim() ? { question: question.trim() } : {}),
    };
    try {
      setResult(await api.brief(body));
    } catch (e) {
      setResult(null);
      setError(e instanceof ApiError ? e.reason : "Could not prepare the brief.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="row" style={{ flexWrap: "wrap" }}>
        <input
          className="input"
          style={{ maxWidth: 340 }}
          aria-label="Question for the brief (optional)"
          placeholder="Optional question, for example: open risks?"
          maxLength={500}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={!!blocked || busy}
        />
        <button
          type="button"
          className="btn primary"
          disabled={!!blocked || busy}
          aria-describedby={blocked ? `brief-why-${meetingId ?? accountId}` : undefined}
          onClick={run}
        >
          <Sparkles size={14} aria-hidden /> {busy ? "Preparing" : label}
        </button>
        {blocked ? (
          <Chip tone="open">
            <span id={`brief-why-${meetingId ?? accountId}`}>{blocked}</span>
          </Chip>
        ) : null}
      </div>
      {error ? <ErrorBox message={error} /> : null}
      {result ? <BriefView result={result} /> : null}
    </div>
  );
}

/** Today: pick an account, then prepare. Accounts whose contract does not allow AI stay listed but off. */
export function BriefCard({ accounts }: { accounts: AccountCard[] }) {
  const [id, setId] = useState("");
  const chosen = accounts.find((a) => a.id === id);
  return (
    <section className="card stack" aria-labelledby="brief-card-h">
      <h3 id="brief-card-h">Prepare a meeting brief</h3>
      <p className="muted">
        Cited summary from the evidence you can already open. Anything unknown is marked as unknown.
      </p>
      <div className="field">
        <label htmlFor="brief-account">Account</label>
        <select
          id="brief-account"
          className="select"
          value={id}
          onChange={(e) => setId(e.target.value)}
        >
          <option value="">Choose an account</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.aiProcessing === "allowed" ? "" : ` (AI ${a.aiProcessing})`}
            </option>
          ))}
        </select>
      </div>
      {chosen ? (
        <PrepareBrief key={chosen.id} accountId={chosen.id} aiProcessing={chosen.aiProcessing} />
      ) : null}
    </section>
  );
}
