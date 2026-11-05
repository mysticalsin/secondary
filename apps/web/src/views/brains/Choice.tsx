import { Check, ChevronDown } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

export interface ChoiceOption {
  id: string;
  label: string;
  desc?: string;
  disabled?: boolean;
}

/**
 * A button that opens a short list of choices with a line of help under each, the way the reference
 * does for roles. Arrow keys move, Enter picks, Escape closes. `remove` adds a red last row.
 */
export function Choice({
  label,
  value,
  options,
  onPick,
  remove,
  disabled,
  note,
}: {
  /** What this choice is for, said to a screen reader ("Role of Ada"). */
  label: string;
  value: string;
  options: ChoiceOption[];
  onPick: (id: string) => void;
  remove?: { label: string; onPick: () => void };
  disabled?: boolean;
  note?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const uid = useId();
  const current = options.find((o) => o.id === value);
  useEffect(() => {
    if (!open) return;
    box.current
      ?.querySelector<HTMLElement>('[aria-checked="true"], [role^="menuitem"]:not([disabled])')
      ?.focus();
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        box.current?.querySelector<HTMLElement>("button.pick-btn")?.focus();
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const items = [
          ...(box.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])') ??
            []),
        ];
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
    <div className="pick" ref={box}>
      <button
        type="button"
        className="pick-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}: ${current?.label ?? value}`}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        {current?.label ?? value}
        <ChevronDown size={14} aria-hidden />
      </button>
      {open ? (
        <div className="menu wide" role="menu" aria-label={label} id={uid}>
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              role="menuitemradio"
              aria-checked={o.id === value}
              disabled={o.disabled}
              className="mi two"
              onClick={() => {
                setOpen(false);
                if (o.id !== value) onPick(o.id);
              }}
            >
              <span className="mi-check" aria-hidden>
                {o.id === value ? <Check size={14} /> : null}
              </span>
              <span>
                <b>{o.label}</b>
                {o.desc ? <span className="mi-desc">{o.desc}</span> : null}
              </span>
            </button>
          ))}
          {remove ? (
            <>
              <hr />
              <button
                type="button"
                role="menuitem"
                className="mi danger"
                onClick={() => {
                  setOpen(false);
                  remove.onPick();
                }}
              >
                <span className="mi-check" aria-hidden />
                {remove.label}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      {note}
    </div>
  );
}
