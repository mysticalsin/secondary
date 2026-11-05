import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../state";
import type { SearchResult } from "../types";

const VIEWS = [
  { label: "Today", to: "/" },
  { label: "Map", to: "/map" },
  { label: "Accounts", to: "/accounts" },
  { label: "Governances", to: "/governances" },
  { label: "Review", to: "/review" },
  { label: "My Secondary", to: "/personal" },
];

interface Entry {
  key: string;
  label: string;
  hint: string;
  run: () => void;
}

export function Palette() {
  const { paletteOpen, setPaletteOpen, openNode, epoch } = useApp();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnTo = useRef<Element | null>(null);

  useEffect(() => {
    if (paletteOpen) {
      returnTo.current = document.activeElement;
      setQ("");
      setResults([]);
      setSel(0);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    } else if (returnTo.current instanceof HTMLElement) {
      returnTo.current.focus();
    }
  }, [paletteOpen]);

  useEffect(() => {
    if (!paletteOpen || q.trim().length < 2) {
      setResults([]);
      return;
    }
    let live = true;
    const t = window.setTimeout(() => {
      api.search(q.trim()).then(
        (r) => live && setResults(r.results),
        () => live && setResults([]),
      );
    }, 120);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [q, paletteOpen, epoch]);

  const entries = useMemo<Entry[]>(() => {
    const term = q.trim().toLowerCase();
    const views = VIEWS.filter((v) => !term || v.label.toLowerCase().includes(term)).map<Entry>(
      (v) => ({
        key: `v:${v.to}`,
        label: v.label,
        hint: "View",
        run: () => nav(v.to),
      }),
    );
    const found = results.map<Entry>((r) => ({
      key: `n:${r.id}`,
      label: r.label,
      hint: r.kind,
      run: () => openNode(r.id),
    }));
    return [...views, ...found];
  }, [q, results, nav, openNode]);

  if (!paletteOpen) return null;
  const close = () => setPaletteOpen(false);
  const choose = (e: Entry) => {
    close();
    e.run();
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        className="sheet palette"
        role="dialog"
        aria-modal="true"
        aria-label="Search and jump"
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
          else if (e.key === "ArrowDown") {
            e.preventDefault();
            setSel((s) => Math.min(entries.length - 1, s + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSel((s) => Math.max(0, s - 1));
          } else if (e.key === "Enter") {
            const entry = entries[sel];
            if (entry) choose(entry);
          }
        }}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          placeholder="Search nodes, accounts, topics, or jump to a view"
          aria-label="Search"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
        />
        <ul id="palette-list" role="listbox">
          {entries.length === 0 ? (
            <li className="muted" style={{ padding: 12 }}>
              <Search size={14} aria-hidden /> Nothing found in your scope.
            </li>
          ) : null}
          {entries.map((e, i) => (
            <li key={e.key} role="option" aria-selected={i === sel}>
              <button
                type="button"
                tabIndex={-1}
                onClick={() => choose(e)}
                onMouseMove={() => setSel(i)}
              >
                <span>{e.label}</span>
                <span className="eyebrow k">{e.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
