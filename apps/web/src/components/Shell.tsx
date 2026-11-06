import { Menu, PanelLeftOpen, Search } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { AgentButton, AgentHostProvider, AgentPanelSlot } from "../agent/host";
import { MOCK } from "../api";
import { useI18n } from "../i18n";
import { displayName, initialsOf } from "../lib/people";
import { readCollapsed, storeCollapsed } from "../lib/theme";
import { Palette, PaletteButton } from "../palette";
import { useApp } from "../state";
import { ElevationBanner } from "../views/admin";
import { Sidebar } from "./Sidebar";

/** The wide search bar of the reference: one field and a Search button. It opens the search page. */
function SearchBar() {
  const { t } = useI18n();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const loc = useLocation();
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState(loc.pathname === "/search" ? (sp.get("q") ?? "") : "");
  const go = (e: FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    if (term) nav(`/search?q=${encodeURIComponent(term)}`);
  };
  return (
    <form className="searchbar" role="search" onSubmit={go}>
      <div className="sfield">
        <Search size={15} aria-hidden />
        <input
          ref={input}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={t("v4.search.label")}
          placeholder={t("v4.search.ph")}
        />
      </div>
      <button type="submit" className="btn soft">
        {t("v4.search.go")}
      </button>
    </form>
  );
}

export function Shell() {
  const { me, meError, toast } = useApp();
  const { t } = useI18n();
  const loc = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const dev = me?.env === "dev";
  const name = displayName(me);

  useEffect(() => {
    setPhoneOpen(false);
    document.getElementById("main")?.scrollTo({ top: 0 });
  }, [loc.pathname]);

  const toggle = () => {
    // On a phone the sidebar is a sheet, so the button opens and closes the sheet.
    if (window.matchMedia("(max-width: 900px)").matches) {
      setPhoneOpen((v) => !v);
      return;
    }
    setCollapsed((v) => {
      storeCollapsed(!v);
      return !v;
    });
  };

  return (
    <AgentHostProvider>
      <div className={`v4app${collapsed ? " collapsed" : ""}${phoneOpen ? " phone-open" : ""}`}>
        <a className="skip-link" href="#main">
          {t("shell.skip")}
        </a>
        <Sidebar onClose={() => setPhoneOpen(false)} onToggle={toggle} />
        {phoneOpen ? (
          <button
            type="button"
            className="side-backdrop"
            aria-label={t("v4.sidebar.collapse")}
            onClick={() => setPhoneOpen(false)}
          />
        ) : null}
        <div className="vstage">
          {dev ? (
            <div className="devbar" role="note">
              <strong>DEV</strong> {t("shell.devbanner")}
              {MOCK ? <span className="tag-mock">{t("shell.mock")}</span> : null}
            </div>
          ) : null}
          <ElevationBanner />
          <header className="topbar">
            <button
              type="button"
              className="icon-btn open-side"
              aria-label={t("v4.sidebar.expand")}
              aria-expanded={!collapsed || phoneOpen}
              onClick={toggle}
            >
              <PanelLeftOpen size={18} className="ic-wide" aria-hidden />
              <Menu size={18} className="ic-phone" aria-hidden />
            </button>
            <SearchBar />
            <span className="sp" />
            <PaletteButton />
            <AgentButton />
            <Link to="/settings" className="whoami">
              <span className="wname">{name || (meError ? t("shell.unknown") : "")}</span>
              <span className="avatar" aria-hidden>
                {initialsOf(name)}
              </span>
            </Link>
          </header>
          <Palette />
          <main className="main" id="main" tabIndex={-1}>
            <Outlet />
          </main>
        </div>
        {toast ? (
          <div className="toast" role="status">
            {toast}
          </div>
        ) : null}
        <AgentPanelSlot />
      </div>
    </AgentHostProvider>
  );
}
