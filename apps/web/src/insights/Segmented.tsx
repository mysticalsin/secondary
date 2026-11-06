import { type KeyboardEvent, useRef } from "react";

/** A segmented control (Week / Month in the reference). One radio group, arrow keys move the choice. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, n: number) => {
    const d =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    if (!d) return;
    e.preventDefault();
    const to = (n + d + options.length) % options.length;
    onChange((options[to] as (typeof options)[0]).value);
    refs.current[to]?.focus();
  };
  return (
    <div className="seg5" role="radiogroup" aria-label={label}>
      {options.map((o, n) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[n] = el;
          }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => onKey(e, n)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
