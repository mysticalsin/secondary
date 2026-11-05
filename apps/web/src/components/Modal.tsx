import { X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { useI18n } from "../i18n";
import { useFocusTrap } from "../lib/focus";

/** A modal sheet with a focus trap. Escape and the close button both call onClose. */
export function Modal({
  title,
  onClose,
  children,
  foot,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  foot?: ReactNode;
}) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  useFocusTrap(box, true);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  useEffect(() => {
    box.current?.querySelector<HTMLElement>("input, textarea, select, button")?.focus();
  }, []);
  return (
    <div className="modal-back">
      <div ref={box} className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button
            type="button"
            className="icon-btn"
            aria-label={t("common.close")}
            onClick={onClose}
          >
            <X size={18} aria-hidden />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {foot ? <footer className="modal-foot">{foot}</footer> : null}
      </div>
    </div>
  );
}
