// The slide-over panel. It stays mounted once opened (a stream keeps running when it is closed),
// traps focus while open, closes on Escape, and gives focus back to the button that opened it.
import { Maximize2, Sparkles, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../i18n";
import { useFocusTrap } from "../lib/focus";
import { PANEL_ID, useAgentHost } from "./host";
import { Thread } from "./Thread";
import "./agent.css";

export default function AgentPanel() {
  const { t } = useI18n();
  const { open, setOpen } = useAgentHost();
  const ref = useRef<HTMLElement>(null);
  const close = () => setOpen(false);
  useFocusTrap(ref, open);
  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLElement>("textarea")?.focus();
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) setOpen(false);
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, setOpen]);
  return (
    <div className="ag-panel-wrap" hidden={!open}>
      <button
        type="button"
        className="ag-backdrop"
        tabIndex={-1}
        aria-label={t("v6.panel.close")}
        onClick={close}
      />
      <aside
        ref={ref}
        id={PANEL_ID}
        className="ag-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t("v6.panel.label")}
        data-testid="agent-panel"
      >
        <header className="ag-head">
          <span className="ag-spark" aria-hidden>
            <Sparkles size={18} />
          </span>
          <h2>{t("v6.agent")}</h2>
          <span className="sp" />
          <Link
            className="icon-btn"
            to="/agent"
            aria-label={t("v6.fullpage")}
            title={t("v6.fullpage")}
            onClick={close}
          >
            <Maximize2 size={16} aria-hidden />
          </Link>
          <button
            type="button"
            className="icon-btn"
            aria-label={t("v6.panel.close")}
            onClick={close}
          >
            <X size={18} aria-hidden />
          </button>
        </header>
        <Thread variant="panel" closePanel={close} />
      </aside>
    </div>
  );
}
