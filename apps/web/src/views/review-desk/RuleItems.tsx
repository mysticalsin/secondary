import { Gavel } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../api";
import { useI18n } from "../../i18n";
import { ago } from "../../lib/time";
import { deskApi } from "./api";
import type { RuleItems as Items } from "./types";

/**
 * Rule items in "Your decision": an action a rule holds until someone approves it (this person may decide
 * it), and a rule change that waits for a second person (this person may confirm it). The API sends only
 * what the person may act on, so a person without the rights sees nothing here.
 */
export function RuleItems({ items, onChanged }: { items: Items; onChanged: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const decide = async (id: string, decision: "approve" | "reject") => {
    setBusy(id);
    setErr(null);
    try {
      await deskApi.decideHold(id, decision);
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.reason : t("common.failed"));
    } finally {
      setBusy(null);
    }
  };
  if (!items.holds.length && !items.publications.length) return null;
  return (
    <ul className="rv-rules" data-testid="rv-rule-items">
      {items.holds.map((h) => (
        <li key={h.id} className="rv-rule" data-hold={h.id}>
          <span className="rv-row-title">
            <Gavel size={14} aria-hidden /> {t("v7d.hold.title", { action: h.action })}
          </span>
          <span className="rv-row-meta">
            <span className="rv-brain">{h.brain.label}</span>
            <span className="muted">
              {h.rule} · {t("v7d.hold.approvals", { n: h.approvals, of: h.required })} ·{" "}
              {ago(h.requestedAt)}
            </span>
          </span>
          <span className="rv-rule-act">
            <button
              type="button"
              className="btn sm primary"
              disabled={busy === h.id}
              onClick={() => decide(h.id, "approve")}
            >
              {t("v7d.approve")}
            </button>
            <button
              type="button"
              className="btn sm ghost"
              disabled={busy === h.id}
              onClick={() => decide(h.id, "reject")}
            >
              {t("v7d.reject")}
            </button>
          </span>
        </li>
      ))}
      {items.publications.map((p) => (
        <li key={`${p.id}:${p.version}`} className="rv-rule" data-publication={p.id}>
          <span className="rv-row-title">
            <Gavel size={14} aria-hidden />{" "}
            {t(p.kind === "rollback" ? "v7d.pub.rollback" : "v7d.pub.publish", {
              name: p.name,
              v: p.version,
            })}
          </span>
          <span className="rv-row-meta">
            <span className="muted">
              {t("v7d.pub.waiting")} · {ago(p.at)}
            </span>
          </span>
          <span className="rv-rule-act">
            <Link className="btn sm" to="/settings/rules">
              {t("v7d.pub.open")}
            </Link>
          </span>
        </li>
      ))}
      {err ? (
        <li className="errorbox" role="alert">
          {err}
        </li>
      ) : null}
    </ul>
  );
}
