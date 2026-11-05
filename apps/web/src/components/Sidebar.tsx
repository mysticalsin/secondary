import {
  BookOpen,
  Building2,
  ChevronRight,
  FileText,
  Globe,
  House,
  LayoutGrid,
  ListChecks,
  Lock,
  PanelLeftClose,
  Settings,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, useMatch } from "react-router-dom";
import { getPersona } from "../api";
import { useI18n } from "../i18n";
import { buildContents, type ContentNode } from "../lib/contents";
import { displayName, initialsOf } from "../lib/people";
import { PERSONAS } from "../personas";
import { useApp } from "../state";
import { useApi } from "../useApi";
import { ux2 } from "../uxv2/api";
import { v3 } from "../views/brains/api";
import type { NavBrain, NavItem } from "../views/brains/types";
import { QUESTIONS_CHANGED } from "../views/waiting/events";
import { wikiApi } from "../views/wiki/api";

export const logoSrc = (dark: boolean) =>
  dark ? "/brand/logo_main_white.png" : "/brand/logo_main.png";

function Logo() {
  const { theme } = useApp();
  const dark =
    theme === "dark" ||
    (theme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  return <img className="logo" src={logoSrc(dark)} alt="Mantu" height={24} />;
}

/** One row of the contents tree: a collection or folder that opens in place, or a page. */
function TreeRow({
  node,
  brain,
  depth,
  open,
  toggle,
}: {
  node: ContentNode;
  brain: string;
  depth: number;
  open: Set<string>;
  toggle: (id: string) => void;
}) {
  const pad = { paddingLeft: 10 + depth * 14 };
  if (node.kind === "page") {
    return (
      <li>
        <NavLink
          className="srow page"
          style={pad}
          to={`/brains/${encodeURIComponent(brain)}/pages/${encodeURIComponent(node.id)}`}
        >
          <FileText size={14} aria-hidden />
          <span className="lbl">{node.label}</span>
        </NavLink>
      </li>
    );
  }
  const isOpen = open.has(node.id);
  return (
    <li>
      <button
        type="button"
        className="srow"
        style={pad}
        aria-expanded={isOpen}
        onClick={() => toggle(node.id)}
      >
        <ChevronRight size={14} className="chev" aria-hidden />
        <span className="lbl">{node.label}</span>
      </button>
      {isOpen && node.children.length ? (
        <ul>
          {node.children.map((c) => (
            <TreeRow
              key={c.id}
              node={c}
              brain={brain}
              depth={depth + 1}
              open={open}
              toggle={toggle}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function BrainTree({ id }: { id: string }) {
  const { t } = useI18n();
  const idx = useApi(() => wikiApi.index(id), [id]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const tree = useMemo(
    () =>
      idx.data
        ? buildContents(idx.data, { sources: t("v4.sources"), reports: t("v4.session.reports") })
        : null,
    [idx.data, t],
  );
  if (!tree) return null;
  const toggle = (k: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  return (
    <ul className="stree" aria-label={t("v4.tree.of", { name: idx.data?.label ?? id })}>
      {tree.collections.map((c) => (
        <TreeRow key={c.id} node={c} brain={id} depth={0} open={open} toggle={toggle} />
      ))}
      {tree.loose.map((p) => (
        <TreeRow
          key={p.id}
          node={{ id: p.id, kind: "page", label: p.title, count: 1, children: [], page: p }}
          brain={id}
          depth={0}
          open={open}
          toggle={toggle}
        />
      ))}
    </ul>
  );
}

function BrainLink({
  b,
  active,
  icon,
}: {
  b: NavBrain;
  active: string | null;
  icon: React.ReactNode;
}) {
  const on = active === b.id;
  return (
    <li>
      <NavLink
        to={`/brains/${encodeURIComponent(b.id)}`}
        end
        className={`nrow${on ? " active" : ""}`}
        aria-current={on ? "page" : undefined}
      >
        {icon}
        <span className="lbl">{b.name}</span>
      </NavLink>
      {on ? <BrainTree id={b.id} /> : null}
    </li>
  );
}

function UserMenu() {
  const { me, setPersona } = useApp();
  const { t, td, lang, setLang } = useI18n();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        box.current?.querySelector<HTMLElement>("button")?.focus();
      }
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const name = displayName(me);
  const dev = me?.env === "dev";
  const personaId = me?.persona ?? getPersona() ?? "";
  return (
    <div className="usermenu" ref={box}>
      {open ? (
        <div className="menu" role="menu" aria-label={t("v4.user.menu")}>
          <Link role="menuitem" className="mi" to="/settings" onClick={() => setOpen(false)}>
            <Settings size={15} aria-hidden /> {t("v4.settings")}
          </Link>
          <div className="mi-group" role="group" aria-label={t("shell.language")}>
            {(["en", "fr"] as const).map((l) => (
              <button
                key={l}
                type="button"
                role="menuitemradio"
                aria-checked={lang === l}
                className="mi seg"
                lang={l}
                onClick={() => setLang(l)}
              >
                {l === "en" ? "English" : "Français"}
              </button>
            ))}
          </div>
          {dev ? (
            <div className="mi-field">
              <label htmlFor="persona">{t("shell.persona")}</label>
              <select
                id="persona"
                className="select"
                value={personaId}
                onChange={(e) => setPersona(e.target.value)}
              >
                {PERSONAS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {td("role", p.id, p.label)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
      ) : null}
      <button
        type="button"
        className="userbtn"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="avatar" aria-hidden>
          {initialsOf(name)}
        </span>
        <span className="uname">{name || t("shell.unknown")}</span>
      </button>
    </div>
  );
}

export function Sidebar({ onClose, onToggle }: { onClose: () => void; onToggle: () => void }) {
  const { t } = useI18n();
  const { me } = useApp();
  const nav = useApi(() => v3.nav(), []);
  const waiting = useApi(() => ux2.questions(), []);
  useEffect(() => {
    const again = () => waiting.reload();
    window.addEventListener(QUESTIONS_CHANGED, again);
    return () => window.removeEventListener(QUESTIONS_CHANGED, again);
  }, [waiting.reload]);
  const m = useMatch("/brains/:id/*");
  const active = m?.params.id ? decodeURIComponent(m.params.id) : null;
  const items = nav.data?.items ?? [];
  const personal = items.filter((i) => i.group === "personal");
  const governance = items.filter((i) => i.group === "governance");
  const global = items.filter((i) => i.group === "global");
  const n = waiting.data?.length ?? 0;
  const brainIcon = (i: NavItem | NavBrain) =>
    i.type === "account" ? <Building2 size={16} aria-hidden /> : <BookOpen size={16} aria-hidden />;
  void me;
  return (
    <aside className="side" aria-label={t("shell.main")}>
      <div className="side-head">
        <Link to="/" aria-label={t("shell.home")} onClick={onClose} className="logolink">
          <Logo />
        </Link>
        <button
          type="button"
          className="icon-btn"
          aria-label={t("v4.sidebar.collapse")}
          onClick={onToggle}
        >
          <PanelLeftClose size={18} aria-hidden />
        </button>
      </div>
      <nav className="side-nav" aria-label={t("shell.main")}>
        <ul>
          <li>
            <NavLink to="/" end className="nrow">
              <House size={16} aria-hidden />
              <span className="lbl">{t("v4.home")}</span>
            </NavLink>
          </li>
          <li>
            <NavLink to="/waiting" className="nrow">
              <ListChecks size={16} aria-hidden />
              <span className="lbl">{t("v4.waiting")}</span>
              {n > 0 ? (
                <span className="badge-n">
                  {n}
                  <span className="sr-only"> {t("nav.waiting")}</span>
                </span>
              ) : null}
            </NavLink>
          </li>
        </ul>
        {personal.length ? (
          <>
            <h2 className="sgroup">{t("v4.private")}</h2>
            <ul>
              {personal.map((b) => (
                <BrainLink
                  key={b.id}
                  b={{ ...b, name: t("v4.personal") }}
                  active={active}
                  icon={<Lock size={16} aria-hidden />}
                />
              ))}
            </ul>
          </>
        ) : null}
        <h2 className="sgroup">{t("v4.brains")}</h2>
        {nav.error ? <p className="muted side-err">{nav.error}</p> : null}
        <ul>
          {governance.map((g) =>
            g.children ? (
              <li key={g.id}>
                <div className="nrow group">
                  <Building2 size={16} aria-hidden />
                  <span className="lbl">{t("v4.accounts")}</span>
                </div>
                <ul className="subbrains">
                  {g.children.map((c) => (
                    <BrainLink
                      key={c.id}
                      b={c}
                      active={active}
                      icon={<Building2 size={16} aria-hidden />}
                    />
                  ))}
                </ul>
              </li>
            ) : (
              <BrainLink key={g.id} b={g} active={active} icon={brainIcon(g)} />
            ),
          )}
          {global.map((b) => (
            <BrainLink key={b.id} b={b} active={active} icon={<Globe size={16} aria-hidden />} />
          ))}
          <li>
            <NavLink to="/brains" end className="nrow">
              <LayoutGrid size={16} aria-hidden />
              <span className="lbl">{t("v4.allbrains")}</span>
            </NavLink>
          </li>
        </ul>
      </nav>
      <div className="side-foot">
        <UserMenu />
      </div>
    </aside>
  );
}
