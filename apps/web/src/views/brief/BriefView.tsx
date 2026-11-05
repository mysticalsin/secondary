import { Save } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { Chip, ErrorBox, fmtDate } from "../../components/ui";
import { useApp } from "../../state";
import "./brief.css";
import type { Brief, BriefResponse } from "./types";

const CATEGORY: Record<string, string> = {
  health: "Health",
  family: "Family",
  holidays: "Holidays",
  hr: "HR",
  private_life: "Private life",
};

/** A brief with clickable citations, highlighted unknowns and the processor disclosure. */
export function BriefView({ result }: { result: BriefResponse }) {
  const { openNode, say } = useApp();
  const { brief } = result;
  const [saved, setSaved] = useState(result.saved);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const byId = new Map(brief.evidence.map((e) => [e.id, e]));

  const save = async (b: Brief) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.saveBrief(b);
      setSaved(r.saved);
      say("Brief saved to My Secondary.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save the brief.");
    } finally {
      setBusy(false);
    }
  };

  const d = brief.disclosure;
  return (
    <article className="brief card stack" aria-labelledby="brief-title">
      <header className="row" style={{ justifyContent: "space-between" }}>
        <h3 id="brief-title" style={{ marginBottom: 0 }}>
          {brief.title}
        </h3>
        {saved ? (
          <span className="row">
            <Chip tone="done">Saved r{saved.revision}</Chip>
            <Link className="btn sm ghost" to="/personal">
              Open My Secondary
            </Link>
          </span>
        ) : (
          <button
            type="button"
            className="btn sm primary"
            disabled={busy || brief.insufficientEvidence}
            onClick={() => save(brief)}
          >
            <Save size={14} aria-hidden /> Save to My Secondary
          </button>
        )}
      </header>
      {err ? <ErrorBox message={err} /> : null}
      {brief.insufficientEvidence ? (
        <p className="muted">There is not enough admitted evidence to brief on this.</p>
      ) : null}
      {brief.sections.map((s) => (
        <section key={s.heading} aria-label={s.heading}>
          <h4>{s.heading}</h4>
          <ul className="claims">
            {s.claims.map((c) => (
              <li key={`${s.heading}:${c.text}`} className={c.unknown ? "claim unknown" : "claim"}>
                {c.unknown ? <span className="tag">Unknown</span> : null}
                {c.text}
                {c.citations.map((id) => {
                  const e = byId.get(id);
                  return e ? (
                    <button
                      type="button"
                      className="cite"
                      key={id}
                      aria-label={`Open source: ${e.title}`}
                      title={e.title}
                      onClick={() => openNode(e.nodeId)}
                    >
                      {id}
                    </button>
                  ) : null;
                })}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {brief.evidence.length > 0 ? (
        <details>
          <summary>Sources ({brief.evidence.length})</summary>
          <ul>
            {brief.evidence.map((e) => (
              <li key={e.id}>
                <b className="num">{e.id}</b>{" "}
                <button type="button" className="linkbtn" onClick={() => openNode(e.nodeId)}>
                  {e.title}
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {brief.excluded.length > 0 ? (
        <details>
          <summary>
            Excluded as personal ({brief.excluded.length}). Only you see this list; it is not saved.
          </summary>
          <ul>
            {brief.excluded.map((x) => (
              <li key={`${x.evidenceId}:${x.line}:${x.excerpt}`}>
                <Chip tone="attn">{CATEGORY[x.category] ?? x.category}</Chip> {x.excerpt}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {brief.dropped.uncited + brief.dropped.badCitations > 0 ? (
        <p className="muted" style={{ fontSize: 14 }}>
          {brief.dropped.uncited} statement{brief.dropped.uncited === 1 ? "" : "s"} without a valid
          source {brief.dropped.uncited === 1 ? "was" : "were"} removed.
        </p>
      ) : null}
      <footer className="disclosure">
        Processed by {d.processor}, model {d.model}. {d.region}. Prepared {fmtDate(d.generatedAt)}.
        Check the cited sources before you rely on this.
      </footer>
    </article>
  );
}
