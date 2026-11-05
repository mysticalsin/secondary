import { Ellipsis } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";

/** The ⋯ menu at the end of a row. Arrow keys move, Escape closes, a click outside closes. */
export function RowMenu({ label, children }: { label: string; children: ReactNode }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    box.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        box.current?.querySelector<HTMLElement>("button.dots")?.focus();
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const items = [...(box.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
        const i = items.indexOf(document.activeElement as HTMLElement);
        const next = items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
        e.preventDefault();
        next?.focus();
      }
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div className="rowmenu" ref={box}>
      <button
        type="button"
        className="icon-btn dots"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("v4.row.more", { name: label })}
        onClick={() => setOpen((v) => !v)}
      >
        <Ellipsis size={16} aria-hidden />
      </button>
      {open ? (
        <div
          className="menu"
          role="menu"
          aria-label={label}
          onClick={() => setOpen(false)}
          onKeyDown={() => {}}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
