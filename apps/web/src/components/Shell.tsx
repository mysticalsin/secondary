import {
  Building2,
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
import { PERSONAS } from "../personas";
import { useApp } from "../state";
import { useApi } from "../useApi";
import { Drawer } from "./Drawer";
import { Palette } from "./Palette";

export function Shell() {
  const { me, meError, drawerId, closeDrawer, setPaletteOpen, setPersona, toast } = useApp();
  const nav = useNavigate();
  const loc = useLocation();
  const queue = useApi(() => api.review(), []);
  const dev = me?.env === "dev";
  const pending = queue.data?.candidates.length ?? 0;
  const canAdmin = !!me?.capabilities?.configure;
  const personaId = me?.persona ?? getPersona() ?? "";
  const roleLabel = me
    ? (PERSONAS.find((p) => p.id === me.principal.roleIds[0])?.label ??
      me.principal.roleIds.join(", "))
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
    { to: "/", end: true, icon: LayoutDashboard, long: "Today", short: "Today", n: 0 },
    { to: "/map", icon: MapIcon, long: "Map", short: "Map", n: 0 },
    { to: "/accounts", icon: Building2, long: "Accounts", short: "Accounts", n: 0 },
    { to: "/governances", icon: Layers, long: "Governances", short: "Govern", n: 0 },
    { to: "/review", icon: ClipboardCheck, long: "Review", short: "Review", n: pending },
    { to: "/personal", icon: UserRound, long: "My Secondary", short: "Mine", n: 0 },
    ...(canAdmin ? [{ to: "/admin", icon: Shield, long: "Admin", short: "Admin", n: 0 }] : []),
  ];

  return (
    <div className="app">
      <div className="top">
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <div className="strip eyebrow">
          <span>
            <i className="dot" />
            Company Brain
          </span>
          <span>Private by design</span>
          {dev ? <span className="tag-dev">Env DEV</span> : null}
          {MOCK ? <span className="tag-mock">Mock data</span> : null}
          <span className="sp" />
          <span>
            Signed in as <b>{me ? me.principal.email : meError ? "unknown" : "..."}</b>
            {roleLabel ? <> · {roleLabel}</> : null}
          </span>
        </div>
        {dev ? (
          <div className="devbanner" role="note">
            <strong>DEV</strong>
            <span>
              Synthetic data only. Demo personas are for testing and are ignored in production.
            </span>
          </div>
        ) : null}
        <header className="header">
          <Link className="logo-tile" to="/" aria-label="mantu, Secondary home">
            mantu
          </Link>
          <div className="brand-title">
            <h1>Secondary</h1>
            <p className="eyebrow">Company Brain</p>
          </div>
          <button type="button" className="searchbtn" onClick={() => setPaletteOpen(true)}>
            <Search size={16} aria-hidden />
            <span>Search nodes, accounts, topics</span>
            <kbd>⌘K</kbd>
          </button>
          <span className="sp" />
          {dev ? (
            <div className="persona">
              <label htmlFor="persona">Demo persona (dev only)</label>
              <select
                id="persona"
                className="select"
                value={personaId}
                onChange={(e) => setPersona(e.target.value)}
              >
                {PERSONAS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <button type="button" className="btn primary" onClick={() => nav("/personal?new=1")}>
            <Plus size={16} aria-hidden /> Capture
          </button>
        </header>
      </div>
      <div className={`body${drawerId ? " has-drawer" : ""}`}>
        <nav className="rail" aria-label="Main">
          {items.map((it) => (
            <NavLink key={it.to} to={it.to} end={it.end}>
              <it.icon size={18} aria-hidden />
              <span className="lbl-long">{it.long}</span>
              <span className="lbl-short">{it.short}</span>
              {it.n > 0 ? (
                <span className="badge-n">
                  {it.n}
                  <span className="sr-only"> waiting</span>
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
      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
