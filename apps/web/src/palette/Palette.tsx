// The command palette (docs/DESIGN-V8-AMAZING.md section 5). Cmd or Ctrl + K opens it anywhere.
// A combobox with a listbox: arrows move, Enter runs, Escape closes and gives focus back, Alt+Enter
// opens the full search, and a status line says how many results there are. Everything it shows is
// for this person: brains come from their own navigation and pages from role-scoped search.
import {
  Activity,
  BookOpen,
  Command,
  CornerDownLeft,
  FileText,
  History,
  Home,
  Inbox,
  Moon,
  PanelsTopLeft,
  PlusSquare,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Sun,
} from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAgentHost } from "../agent/host";
import { type Key, useI18n } from "../i18n";
import { useFocusTrap } from "../lib/focus";
import { pageLink } from "../lib/links";
import { useApp } from "../state";
import { v3 } from "../views/brains/api";
import type { NavBrain, NavItem } from "../views/brains/types";
import { searchApi } from "../views/search/api";
import type { Hit } from "../views/search/types";
import { rank } from "./match";
import { pushRecent, type Recent, readRecents } from "./recents";

/** Where the review desk lives (`/waiting` still redirects here). */
export const REVIEW_PATH = "/review";
export const OPEN_PALETTE = "secondary:palette";

type Group = "recent" | "actions" | "go" | "brains" | "pages" | "settings" | "search";

interface Item {
  id: string;
  group: Group;
  label: string;
  hint?: string;
  keywords?: string;
  icon: ReactNode;
  run: () => void;
  recent?: Recent;
}

const GROUP_KEY: Record<Group, Key> = {
  recent: "v8k.g.recent",
  actions: "v8k.g.actions",
  go: "v8k.g.go",
  brains: "v8k.g.brains",
  pages: "v8k.g.pages",
  settings: "v8k.g.settings",
  search: "v8k.g.search",
};
const ORDER: Group[] = ["recent", "actions", "go", "brains", "pages", "settings", "search"];

const flat = (items: NavItem[]): NavBrain[] =>
  items.flatMap((i) => (i.children?.length ? i.children : [i]));

const SETTINGS: { to: string; label: Key }[] = [
  { to: "profile", label: "v4.settings.profile" },
  { to: "brains", label: "v4.settings.brains" },
  { to: "agents", label: "v4.settings.agents" },
  { to: "security", label: "v4.settings.security" },
  { to: "privacy", label: "v4.settings.privacy" },
  { to: "appearance", label: "v4.settings.appearance" },
  { to: "usage", label: "v4.settings.usage" },
];

/** The brain the person is looking at, from the path (null on any other page). */
const brainOfPath = (p: string): string | null => /^\/brains\/([^/]+)/.exec(p)?.[1] ?? null;

export function Palette() {
  const { t, tn } = useI18n();
  const { me, setTheme } = useApp();
  const { lang, setLang } = useI18n();
  const nav = useNavigate();
  const loc = useLocation();
  const host = useAgentHost();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const [brains, setBrains] = useState<NavBrain[] | null>(null);
  const [hits, setHits] = useState<Hit[]>([]);
  const [recents, setRecents] = useState<Recent[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const who = me?.principal.id ?? "";
  const seq = useRef(0);

  useFocusTrap(box, open);

  const show = useCallback(() => {
    setQ("");
    setAt(0);
    setHits([]);
    setRecents(readRecents(who));
    setOpen(true);
  }, [who]);
  const close = useCallback(() => setOpen(false), []);

  // Cmd or Ctrl + K, from anywhere, and a custom event for the button.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) close();
        else show();
      }
    };
    const onOpen = () => show();
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_PALETTE, onOpen);
    };
  }, [open, show, close]);

  // Back or forward while it is open closes it. Running an item closes it before it navigates.
  useEffect(() => {
    if (!open) return;
    window.addEventListener("popstate", close);
    return () => window.removeEventListener("popstate", close);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    if (brains === null)
      v3.nav().then(
        (r) => setBrains(flat(r.items)),
        () => setBrains([]),
      );
  }, [open, brains]);

  // Pages: role-scoped search while typing, after a short pause. The newest answer wins.
  useEffect(() => {
    if (!open) return;
    const text = q.trim();
    if (text.length < 2 || text.startsWith(">")) {
      setHits([]);
      return;
    }
    const n = ++seq.current;
    const id = window.setTimeout(() => {
      searchApi.suggest(text).then(
        (r) => n === seq.current && setHits(r.results),
        () => n === seq.current && setHits([]),
      );
    }, 180);
    return () => window.clearTimeout(id);
  }, [q, open]);

  const go = useCallback(
    (to: string, r?: Omit<Recent, "to">) => {
      if (r) setRecents(pushRecent(who, { ...r, to }));
      close();
      nav(to);
    },
    [who, nav, close],
  );

  const here = brainOfPath(loc.pathname);
  const dark = document.documentElement.dataset.theme === "dark";
  const items = useMemo<Item[]>(() => {
    const ic = (n: ReactNode) => n;
    const brainName = (b: NavBrain) => (b.id === "me" ? t("v4.personal") : b.name);
    const acts: Item[] = [
      {
        id: "a:new",
        group: "actions",
        label: t("v8k.a.new"),
        hint: here && here !== "me" ? undefined : t("v4.personal"),
        keywords: "page create add write",
        icon: ic(<PlusSquare size={16} aria-hidden />),
        run: () => go(`/brains/${encodeURIComponent(here ?? "me")}?new=1`),
      },
      {
        id: "a:ask",
        group: "actions",
        label: t("v8k.a.ask"),
        keywords: "agent question my agent",
        icon: ic(<Sparkles size={16} aria-hidden />),
        run: () => {
          close();
          host.setOpen(true);
        },
      },
      {
        id: "a:review",
        group: "actions",
        label: t("v8k.a.review"),
        keywords: "waiting approve decide questions desk",
        icon: ic(<Inbox size={16} aria-hidden />),
        run: () => go(REVIEW_PATH),
      },
      {
        id: "a:pin",
        group: "actions",
        label: t("v8k.a.pin"),
        keywords: "pin view home agent",
        icon: ic(<PanelsTopLeft size={16} aria-hidden />),
        run: () => {
          close();
          host.ask({ label: t("v8k.a.pin.ask"), text: t("v8k.a.pin.ask") });
        },
      },
      {
        id: "a:theme",
        group: "actions",
        label: dark ? t("v8k.a.light") : t("v8k.a.dark"),
        keywords: "theme dark light appearance mode",
        icon: ic(dark ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />),
        run: () => {
          close();
          setTheme(dark ? "light" : "dark");
        },
      },
      {
        id: "a:lang",
        group: "actions",
        label: lang === "en" ? t("v8k.a.fr") : t("v8k.a.en"),
        keywords: "language langue francais english",
        icon: ic(<BookOpen size={16} aria-hidden />),
        run: () => {
          close();
          setLang(lang === "en" ? "fr" : "en");
        },
      },
    ];
    if (here)
      acts.push({
        id: "a:pulse",
        group: "actions",
        label: t("v8k.a.pulse"),
        keywords: "journal timeline activity",
        icon: ic(<Activity size={16} aria-hidden />),
        run: () => go(`/brains/${encodeURIComponent(here)}/pulse`),
      });
    const goto: Item[] = [
      { id: "g:home", to: "/", label: t("v4.home"), icon: <Home size={16} aria-hidden /> },
      {
        id: "g:brains",
        to: "/brains",
        label: t("v4.allbrains"),
        icon: <BookOpen size={16} aria-hidden />,
      },
      {
        id: "g:search",
        to: "/search",
        label: t("v8k.g.search.page"),
        icon: <Search size={16} aria-hidden />,
      },
      {
        id: "g:agent",
        to: "/agent",
        label: t("v8k.go.agent"),
        icon: <Sparkles size={16} aria-hidden />,
      },
    ].map((g) => ({
      id: g.id,
      group: "go" as const,
      label: g.label,
      keywords: "go open navigate",
      icon: g.icon,
      run: () => go(g.to),
    }));
    const bs: Item[] = (brains ?? []).map((b) => ({
      id: `b:${b.id}`,
      group: "brains" as const,
      label: brainName(b),
      hint: t("v8k.brain"),
      keywords: "brain open pulse",
      icon: ic(<BookOpen size={16} aria-hidden />),
      run: () =>
        go(`/brains/${encodeURIComponent(b.id)}`, {
          id: `b:${b.id}`,
          label: brainName(b),
          hint: t("v8k.brain"),
        }),
    }));
    const ss: Item[] = SETTINGS.map((s) => ({
      id: `s:${s.to}`,
      group: "settings" as const,
      label: t(s.label),
      hint: t("v4.settings"),
      keywords: "settings preferences",
      icon: ic(<SettingsIcon size={16} aria-hidden />),
      run: () =>
        go(`/settings/${s.to}`, { id: `s:${s.to}`, label: t(s.label), hint: t("v4.settings") }),
    }));
    return [...acts, ...goto, ...bs, ...ss];
  }, [t, here, brains, dark, lang, go, close, host, setTheme, setLang]);

  const text = q.trim();
  const actionsOnly = text.startsWith(">");
  const needle = actionsOnly ? text.slice(1).trim() : text;

  const shown = useMemo<Item[]>(() => {
    if (!text) {
      const rec: Item[] = recents.map((r) => ({
        id: `r:${r.id}`,
        group: "recent",
        label: r.label,
        ...(r.hint ? { hint: r.hint } : {}),
        icon: <History size={16} aria-hidden />,
        run: () => go(r.to),
        recent: r,
      }));
      return [
        ...rec,
        ...items.filter((i) => i.group === "actions" || i.group === "go").slice(0, 8),
      ];
    }
    const base = actionsOnly ? items.filter((i) => i.group === "actions") : items;
    const matched = rank(needle, base);
    const pages: Item[] = actionsOnly
      ? []
      : hits.map((h) => ({
          id: `p:${h.brainId}:${h.id}`,
          group: "pages" as const,
          label: h.title,
          hint: `${h.brainId === "me" ? t("v4.personal") : h.brainName} · ${h.collection}`,
          icon: <FileText size={16} aria-hidden />,
          run: () =>
            go(pageLink(h.brainId, h.id), {
              id: `p:${h.brainId}:${h.id}`,
              label: h.title,
              hint: `${h.brainId === "me" ? t("v4.personal") : h.brainName} · ${h.collection}`,
            }),
        }));
    const all: Item[] = actionsOnly
      ? []
      : [
          {
            id: "q:search",
            group: "search" as const,
            label: t("v8k.search.for", { q: text }),
            icon: <Search size={16} aria-hidden />,
            run: () =>
              go(`/search?q=${encodeURIComponent(text)}`, {
                id: `q:${text}`,
                label: t("v8k.search.for", { q: text }),
              }),
          },
          {
            id: "q:ask",
            group: "search" as const,
            label: t("v8k.ask.for", { q: text }),
            icon: <Sparkles size={16} aria-hidden />,
            run: () => {
              close();
              host.ask({ label: text, text });
            },
          },
        ];
    // Commands first when they match, then pages, then the two "search for" rows.
    return [...matched, ...pages, ...all];
  }, [text, actionsOnly, needle, items, hits, recents, go, t, close, host]);

  // Keep the active row in range and in view.
  useEffect(() => setAt(0), [text, hits.length, brains?.length]);
  useEffect(() => {
    list.current?.querySelector(`[data-i="${at}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [at]);

  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    const n = shown.length;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey && n > 0 && at < n - 1)) {
      e.preventDefault();
      setAt((i) => (n ? (i + 1) % n : 0));
    } else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey && n > 0 && at > 0)) {
      e.preventDefault();
      setAt((i) => (n ? (i - 1 + n) % n : 0));
    } else if (e.key === "Home" && e.ctrlKey) {
      e.preventDefault();
      setAt(0);
    } else if (e.key === "End" && e.ctrlKey) {
      e.preventDefault();
      setAt(Math.max(0, n - 1));
    } else if (e.key === "Enter" && (e.altKey || e.metaKey || e.ctrlKey) && text) {
      e.preventDefault();
      go(`/search?q=${encodeURIComponent(text)}`);
    } else if (e.key === "Enter") {
      e.preventDefault();
      shown[at]?.run();
    }
  };

  if (!open) return null;

  const groups = ORDER.map((g) => ({ g, rows: shown.filter((i) => i.group === g) })).filter(
    (x) => x.rows.length,
  );
  let i = -1;
  const optionId = (n: number) => `pal-opt-${n}`;
  return (
    <div className="pal8-wrap">
      <button
        type="button"
        className="pal8-back"
        tabIndex={-1}
        aria-label={t("v8k.close")}
        onClick={close}
      />
      <div
        ref={box}
        className="pal8"
        role="dialog"
        aria-modal="true"
        aria-label={t("v8k.title")}
        onKeyDown={onKey}
        data-testid="palette"
      >
        <div className="pal8-in">
          <Command size={16} aria-hidden />
          <input
            ref={input}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="pal-list"
            aria-autocomplete="list"
            aria-activedescendant={shown.length ? optionId(at) : undefined}
            aria-label={t("v8k.label")}
            placeholder={t("v8k.ph")}
            autoComplete="off"
            spellCheck={false}
            value={q}
            maxLength={300}
            onChange={(e) => setQ(e.target.value)}
          />
          <kbd className="pal8-kbd">Esc</kbd>
        </div>
        <div
          id="pal-list"
          ref={list}
          className="pal8-list"
          role="listbox"
          aria-label={t("v8k.results")}
        >
          {groups.map(({ g, rows }) => (
            <div key={g} role="group" aria-labelledby={`pal-g-${g}`}>
              <div id={`pal-g-${g}`} className="pal8-gh" role="presentation">
                {t(GROUP_KEY[g])}
              </div>
              {rows.map((it) => {
                i += 1;
                const idx = i;
                return (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: keys are handled on the combobox
                  <div
                    key={it.id}
                    id={optionId(idx)}
                    data-i={idx}
                    role="option"
                    aria-selected={idx === at}
                    className={`pal8-opt${idx === at ? " on" : ""}`}
                    onMouseMove={() => idx !== at && setAt(idx)}
                    onClick={() => it.run()}
                  >
                    <span className="pal8-ic">{it.icon}</span>
                    <span className="pal8-l">{it.label}</span>
                    {it.hint ? <span className="pal8-h">{it.hint}</span> : null}
                    {idx === at ? (
                      <CornerDownLeft size={14} aria-hidden className="pal8-ret" />
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
          {!shown.length ? <p className="pal8-none">{t("v8k.none")}</p> : null}
        </div>
        <p className="sr-only" role="status" aria-live="polite">
          {text ? tn(shown.length, "v8k.n.one", "v8k.n.other") : ""}
        </p>
        <p className="pal8-foot" aria-hidden>
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> {t("v8k.foot.move")}
          </span>
          <span>
            <kbd>Enter</kbd> {t("v8k.foot.open")}
          </span>
          <span>
            <kbd>Alt</kbd> <kbd>Enter</kbd> {t("v8k.foot.search")}
          </span>
          <span>
            <kbd>&gt;</kbd> {t("v8k.foot.actions")}
          </span>
        </p>
      </div>
    </div>
  );
}

/** The top-bar button that opens the palette for people who do not use the shortcut. */
export function PaletteButton() {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className="pal8-btn"
      aria-haspopup="dialog"
      aria-keyshortcuts="Control+K Meta+K"
      title={`${t("v8k.open")} (Ctrl+K)`}
      onClick={() => window.dispatchEvent(new Event(OPEN_PALETTE))}
      data-testid="palette-button"
    >
      <Command size={15} aria-hidden />
      <span className="pal8-txt">{t("v8k.btn")}</span>
      <kbd aria-hidden>K</kbd>
    </button>
  );
}
