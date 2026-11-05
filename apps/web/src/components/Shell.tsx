import {
  BookOpen,
  Bot,
  Building2,
  CircleHelp,
  ClipboardCheck,
  Ellipsis,
  FlaskConical,
  Gauge,
  Inbox,
  Layers,
  LayoutDashboard,
  Library,
  Map as MapIcon,
  Plus,
  Repeat,
  Search,
  Shield,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api, getPersona, MOCK } from "../api";
import { useI18n } from "../i18n";
import { PERSONAS } from "../personas";
import { useApp } from "../state";
import { useApi } from "../useApi";
import { ux2 } from "../uxv2/api";
import { ElevationBanner, InboxBell, useAdminCaps } from "../views/admin";
import { QUESTIONS_CHANGED } from "../views/questions/Questions";
import { Drawer } from "./Drawer";
import { Palette } from "./Palette";
import { Tour } from "./Tour";

export function Shell() {
  const { me, meError, drawerId, closeDrawer, setPaletteOpen, setPersona, toast, openTour } =
    useApp();
  const { t, td, lang, setLang } = useI18n();
  const nav = useNavigate();
  const loc = useLocation();
  const queue = useApi(() => api.review(), []);
  const questions = useApi(() => ux2.questions(), []);
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    const again = () => questions.reload();
    window.addEventListener(QUESTIONS_CHANGED, again);
    return () => window.removeEventListener(QUESTIONS_CHANGED, again);
  }, [questions.reload]);
  const dev = me?.env === "dev";
  const pending = queue.data?.length ?? 0;
  const adminCaps = useAdminCaps();
  const canAdmin =
    !!me?.capabilities?.configure ||
    !!(adminCaps?.steward || adminCaps?.auditor || adminCaps?.elevation);
  const personaId = me?.persona ?? getPersona() ?? "";
  const roleId = me?.principal.roleIds[0] ?? "";
  const roleLabel = me
    ? td(
        "role",
        roleId,
        PERSONAS.find((p) => p.id === roleId)?.label ?? me.principal.roleIds.join(", "),
      )
    : "";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (e.key === "Escape") {
        closeDrawer();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeDrawer, setPaletteOpen]);

  useEffect(() => {
    closeDrawer();
    setMoreOpen(false);
    document.getElementById("main")?.scrollTo({ top: 0 });
  }, [loc.pathname]);

  const isSteward = !!me?.capabilities?.review || !!adminCaps?.steward;
  const isExec = roleId === "ceo";

  interface Item {
    id: string;
    to: string;
    icon: typeof Search;
    label: string;
    short: string;
    n: number;
    end?: boolean;
    /** Stays in the bottom bar at phone width. Everything else moves behind "More". */
    bar?: boolean;
  }
  const catalog: Record<string, Item> = {
    ask: {
      id: "ask",
      to: "/",
      end: true,
      icon: Sparkles,
      label: t("nav.ask"),
      short: t("nav.ask"),
      n: 0,
      bar: true,
    },
    brain: {
      id: "brain",
      to: "/brain",
      icon: BookOpen,
      label: t("nav.brain"),
      short: t("nav.brain"),
      n: 0,
      bar: true,
    },
    brains: {
      id: "brains",
      to: "/brains",
      icon: Library,
      label: t("nav.brains"),
      short: t("nav.brains"),
      n: 0,
    },
    agents: {
      id: "agents",
      to: "/settings/agents",
      icon: Bot,
      label: t("nav.agents"),
      short: t("nav.agents"),
      n: 0,
    },
    pilot: {
      id: "pilot",
      to: "/settings/pilot",
      icon: FlaskConical,
      label: t("nav.pilot"),
      short: t("nav.pilot"),
      n: 0,
    },
    questions: {
      id: "questions",
      to: "/questions",
      icon: Inbox,
      label: t("nav.questions"),
      short: t("nav.questions.short"),
      n: questions.data?.length ?? 0,
      bar: true,
    },
    personal: {
      id: "personal",
      to: "/personal",
      icon: UserRound,
      label: t("nav.personal"),
      short: t("nav.personal.short"),
      n: 0,
    },
    map: { id: "map", to: "/map", icon: MapIcon, label: t("nav.map"), short: t("nav.map"), n: 0 },
    routines: {
      id: "routines",
      to: "/routines",
      icon: Repeat,
      label: t("nav.routines"),
      short: t("nav.routines"),
      n: 0,
    },
    usage: {
      id: "usage",
      to: "/usage",
      icon: Gauge,
      label: t("nav.usage"),
      short: t("nav.usage"),
      n: 0,
    },
    admin: {
      id: "admin",
      to: "/admin",
      icon: Shield,
      label: t("nav.admin"),
      short: t("nav.admin"),
      n: 0,
    },
    today: {
      id: "today",
      to: "/today",
      icon: LayoutDashboard,
      label: t("nav.today"),
      short: t("nav.today"),
      n: 0,
    },
    accounts: {
      id: "accounts",
      to: "/accounts",
      icon: Building2,
      label: t("nav.accounts"),
      short: t("nav.accounts"),
      n: 0,
    },
    governances: {
      id: "governances",
      to: "/governances",
      icon: Layers,
      label: t("nav.governances"),
      short: t("nav.governances.short"),
      n: 0,
    },
    review: {
      id: "review",
      to: "/review",
      icon: ClipboardCheck,
      label: t("nav.review"),
      short: t("nav.review"),
      n: pending,
    },
  };
  // Role defaults only change the order. Every person can reach everything they are allowed to see.
  const first = [
    "ask",
    "brain",
    "questions",
    "personal",
    ...(isSteward || isExec ? ["map", "routines"] : []),
    ...(canAdmin ? ["admin", "usage"] : []),
  ];
  const rest = [
    "brains",
    "today",
    "map",
    "accounts",
    "governances",
    "review",
    "routines",
    "usage",
    "agents",
    ...(canAdmin ? ["admin", "pilot"] : []),
  ].filter((id) => !first.includes(id));
  const primary = first.map((id) => catalog[id] as Item);
  const more = rest.map((id) => catalog[id] as Item);
  const link = (it: Item, extra = "") => (
    <NavLink
      key={it.id}
      to={it.to}
      end={it.end}
      className={extra}
      onClick={() => setMoreOpen(false)}
    >
      <it.icon size={18} aria-hidden />
      <span className="lbl-long">{it.label}</span>
      <span className="lbl-short">{it.short}</span>
      {it.n > 0 ? (
        <span className="badge-n">
          {it.n}
          <span className="sr-only"> {t("nav.waiting")}</span>
        </span>
      ) : null}
    </NavLink>
  );
  const sheet = [...primary.filter((i) => !i.bar), ...more];

  return (
    <div className="app">
      <div className="top">
        <a className="skip-link" href="#main">
          {t("shell.skip")}
        </a>
        <div className="strip eyebrow">
          <span>
            <i className="dot" />
            {t("shell.brain")}
          </span>
          <span>{t("shell.private")}</span>
          {dev ? <span className="tag-dev">{t("shell.envdev")}</span> : null}
          {MOCK ? <span className="tag-mock">{t("shell.mock")}</span> : null}
          <span className="sp" />
          <span>
            {t("shell.signedin")}{" "}
            <b>{me ? me.principal.email : meError ? t("shell.unknown") : "..."}</b>
            {roleLabel ? <> · {roleLabel}</> : null}
          </span>
        </div>
        {dev ? (
          <div className="devbanner" role="note">
            <strong>DEV</strong>
            <span>{t("shell.devbanner")}</span>
          </div>
        ) : null}
        <ElevationBanner />
        <header className="header">
          <Link className="logo-tile" to="/" aria-label={t("shell.home")}>
            mantu
          </Link>
          <div className="brand-title">
            <h1>Secondary</h1>
            <p className="eyebrow">{t("shell.brain")}</p>
          </div>
          <button type="button" className="searchbtn" onClick={() => setPaletteOpen(true)}>
            <Search size={16} aria-hidden />
            <span>{t("shell.search")}</span>
            <kbd>⌘K</kbd>
          </button>
          <span className="sp" />
          {dev ? (
            <div className="persona">
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
          <InboxBell />
          <div className="langsw" role="group" aria-label={t("shell.language")}>
            {(["en", "fr"] as const).map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={lang === l}
                lang={l}
                onClick={() => setLang(l)}
              >
                {l.toUpperCase()}
                <span className="sr-only"> {l === "en" ? "English" : "Français"}</span>
              </button>
            ))}
          </div>
          <button type="button" className="icon-btn" aria-label={t("tour.open")} onClick={openTour}>
            <CircleHelp size={18} aria-hidden />
          </button>
          <button type="button" className="btn primary" onClick={() => nav("/personal?new=1")}>
            <Plus size={16} aria-hidden /> {t("shell.capture")}
          </button>
        </header>
      </div>
      <div className={`body${drawerId ? " has-drawer" : ""}`}>
        <nav className="rail" aria-label={t("shell.main")}>
          {primary.map((it) => link(it, it.bar ? "" : "m-more"))}
          <div className="rail-sep" aria-hidden />
          {more.map((it) => link(it, "m-more rail-rest"))}
          <button
            type="button"
            className="rail-more-btn"
            aria-expanded={moreOpen}
            aria-controls="more-sheet"
            onClick={() => setMoreOpen((v) => !v)}
          >
            <Ellipsis size={18} aria-hidden />
            <span className="lbl-short">{t("nav.more")}</span>
          </button>
        </nav>
        {moreOpen ? (
          <div id="more-sheet" className="more-sheet" role="group" aria-label={t("nav.more")}>
            {sheet.map((it) => link(it, "sheet-link"))}
          </div>
        ) : null}
        <main className="main" id="main" tabIndex={-1}>
          <Outlet />
        </main>
        {drawerId ? <Drawer /> : null}
      </div>
      <Palette />
      <Tour />
      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
