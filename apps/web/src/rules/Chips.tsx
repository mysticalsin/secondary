import { X } from "lucide-react";
import { type KeyboardEvent, useId, useRef, useState } from "react";
import { useT } from "../i18n";

export interface ChipOption {
  id: string;
  label: string;
}

/**
 * A value box: chosen values are chips, and typing adds more. With `options` the typed text must name
 * one of them (Enter or comma adds it, Backspace on an empty box removes the last chip). Chips also
 * carry their own remove button, so a keyboard person can Tab to one and press Enter.
 */
export function ChipsInput({
  label,
  values,
  options,
  onChange,
  invalid,
  describedBy,
  disabled,
  max = 20,
}: {
  label: string;
  values: string[];
  options: ChipOption[];
  onChange: (next: string[]) => void;
  invalid?: boolean;
  describedBy?: string;
  disabled?: boolean;
  max?: number;
}) {
  const t = useT();
  const list = useId();
  const hint = useId();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [miss, setMiss] = useState(false);
  const nameOf = (id: string) => options.find((o) => o.id === id)?.label ?? id;
  const free = options.length === 0;

  const match = (raw: string): string | null => {
    const q = raw.trim().toLowerCase();
    if (!q) return null;
    const hit = options.find((o) => o.label.toLowerCase() === q || o.id.toLowerCase() === q);
    if (hit) return hit.id;
    return free ? raw.trim() : null;
  };
  const add = (raw: string): boolean => {
    const id = match(raw);
    if (!id) {
      setMiss(raw.trim().length > 0);
      return false;
    }
    setMiss(false);
    setText("");
    if (!values.includes(id) && values.length < max) onChange([...values, id]);
    return true;
  };
  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      if (text.trim()) {
        e.preventDefault();
        add(text);
      }
    } else if (e.key === "Backspace" && !text && values.length) {
      onChange(values.slice(0, -1));
    }
  };
  const remove = (id: string) => {
    onChange(values.filter((v) => v !== id));
    input.current?.focus();
  };
  return (
    <div className={`rl-chips${invalid ? " bad" : ""}`}>
      {values.map((v) => (
        <span className="rl-vchip" key={v}>
          {nameOf(v)}
          {disabled ? null : (
            <button
              type="button"
              className="rl-vchip-x"
              aria-label={t("v7.ed.chips.remove", { value: nameOf(v) })}
              onClick={() => remove(v)}
            >
              <X size={12} aria-hidden />
            </button>
          )}
        </span>
      ))}
      {disabled ? null : (
        <>
          <input
            ref={input}
            className="rl-chips-in"
            value={text}
            list={options.length ? list : undefined}
            aria-label={label}
            aria-invalid={invalid || miss ? true : undefined}
            aria-describedby={
              [describedBy, miss ? hint : ""].filter(Boolean).join(" ") || undefined
            }
            placeholder={values.length ? "" : t("v7.ed.chips.add")}
            autoComplete="off"
            onChange={(e) => {
              setText(e.target.value);
              setMiss(false);
              // A pick from the list arrives as a whole label: take it at once.
              const exact = options.find((o) => o.label === e.target.value);
              if (exact && (e.nativeEvent as InputEvent).inputType === "insertReplacementText") {
                add(e.target.value);
              }
            }}
            onKeyDown={key}
            onBlur={() => {
              if (text.trim()) add(text);
            }}
          />
          {options.length ? (
            <datalist id={list}>
              {options
                .filter((o) => !values.includes(o.id))
                .map((o) => (
                  <option key={o.id} value={o.label} />
                ))}
            </datalist>
          ) : null}
        </>
      )}
      {miss ? (
        <span id={hint} className="rl-miss" role="status">
          {t("v7.ed.chips.none")}
        </span>
      ) : null}
    </div>
  );
}
