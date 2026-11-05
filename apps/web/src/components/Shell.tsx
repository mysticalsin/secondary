import {
  Building2,
  CircleHelp,
  ClipboardCheck,
  Layers,
  LayoutDashboard,
  Map as MapIcon,
  Plus,
  Search,
  Shield,
  UserRound,
} from "lucide-react";
import { useEffect } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api, getPersona, MOCK } from "../api";
import { useI18n } from "../i18n";
import { PERSONAS } from "../personas";
import { useApp } from "../state";
import { useApi } from "../useApi";
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
  const dev = me?.env === "dev";
  const pending = queue.data?.length ?? 0;
  const canAdmin = !!me?.capabilities?.configure;
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
    document.getElementById("main")?.scrollTo({ top: 0 });
  }, [loc.pathname]);

  const items = [
    {
      to: "/",
      end: true,
      icon: LayoutDashboard,
      long: t("nav.today"),
      short: t("nav.today"),
      n: 0,
    },
    { to: "/map", icon: MapIcon, long: t("nav.map"), short: t("nav.map"), n: 0 },
    { to: "/accounts", icon: Building2, long: t("nav.accounts"), short: t("nav.accounts"), n: 0 },
    {
      to: "/governances",
      icon: Layers,
      long: t("nav.governances"),
      short: t("nav.governances.short"),
      n: 0,
    },
    {
      to: "/review",
      icon: ClipboardCheck,
      long: t("nav.review"),
      short: t("nav.review"),
      n: pending,
    },
    {
      to: "/personal",
      icon: UserRound,
      long: t("nav.personal"),
      short: t("nav.personal.short"),
      n: 0,
    },
    ...(canAdmin
      ? [{ to: "/admin", icon: Shield, long: t("nav.admin"), short: t("nav.admin"), n: 0 }]
      : []),
  ];

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
          {items.map((it) => (
            <NavLink key={it.to} to={it.to} end={it.end}>
              <it.icon size={18} aria-hidden />
              <span className="lbl-long">{it.long}</span>
              <span className="lbl-short">{it.short}</span>
              {it.n > 0 ? (
                <span className="badge-n">
                  {it.n}
                  <span className="sr-only"> {t("nav.waiting")}</span>
                </span>
              ) : null}
            </NavLink>
          ))}
        </nav>
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
