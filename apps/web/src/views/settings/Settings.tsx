import { Download } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { Link, Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { ApiError, api } from "../../api";
import { Await, Empty, fmtDate } from "../../components/ui";
import { type Key, useI18n } from "../../i18n";
import { displayName, initialsOf } from "../../lib/people";
import type { Theme } from "../../lib/theme";
import { HealthPage } from "../../ops/HealthPage";
import { useOpsRights } from "../../ops/rights";
import { SourcePage } from "../../ops/SourcePage";
import { SourcesList } from "../../ops/SourcesList";
import { PERSONAS } from "../../personas";
import { useRulesAccess } from "../../rules/access";
import { useApp } from "../../state";
import { useApi } from "../../useApi";
import { downloadExport } from "../../uxv2/api";
import { Admin, useAdminCaps } from "../admin";
import { AgentsSection } from "../brains/Agents";
import { v3 } from "../brains/api";
import { PilotPage } from "../brains/Pilot";
import { ExpertSetting } from "../lens";
import { Usage } from "../usage/Usage";

const AgentSettingsSection = lazy(() => import("../../agent/SettingsSection"));
const RulesPage = lazy(() => import("../../rules/Rules"));

function Profile() {
  const { t, td } = useI18n();
  const { me } = useApp();
  const name = displayName(me);
  const p = me?.profile;
  const roleId = me?.principal.roleIds[0] ?? "";
  const rows: [string, string | undefined][] = [
    [t("v4.profile.email"), me?.principal.email],
    [
      t("v4.profile.title"),
      p?.jobTitle ?? td("role", roleId, PERSONAS.find((x) => x.id === roleId)?.label ?? roleId),
    ],
    [t("v4.profile.dept"), p?.department],
    [t("v4.profile.office"), p?.office],
    [t("v4.profile.country"), p?.country],
  ];
  return (
    <section aria-labelledby="pr-h">
      <h2 id="pr-h" className="sec-title">
        {t("v4.settings.profile")}
      </h2>
      <div className="setcard">
        <div className="setcard-head">
          <span className="avatar lg" aria-hidden>
            {initialsOf(name)}
          </span>
          <div>
            <b>{name}</b>
            <div className="muted">{p ? t("v4.profile.from") : t("v4.profile.signedin")}</div>
          </div>
        </div>
        <dl className="kv4">
          {rows
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
        </dl>
        {p ? <p className="muted small">{t("v4.profile.refreshed")}</p> : null}
      </div>
    </section>
  );
}

function YourBrains() {
  const { t } = useI18n();
  const nav = useApi(() => v3.nav(), []);
  return (
    <section aria-labelledby="yb-h">
      <h2 id="yb-h" className="sec-title">
        {t("v4.settings.brains")}
      </h2>
      <Await state={nav} skeleton={2}>
        {({ items }) => {
          const all = items.flatMap((i) => (i.children?.length ? i.children : [i]));
          return all.length ? (
            <ul className="setlist">
              {all.map((b) => (
                <li key={b.id}>
                  <div>
                    <Link to={`/brains/${encodeURIComponent(b.id)}`}>
                      {b.id === "me" ? t("v4.personal") : b.name}
                    </Link>
                    <span className="muted"> · {t(`v4.role.${b.role ?? "reader"}` as Key)}</span>
                  </div>
                  {b.type !== "personal" && b.manages ? (
                    <Link className="textlink" to={`/brains/${encodeURIComponent(b.id)}/access`}>
                      {t("v4.members.access")}
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <Empty title={t("v4.home.nobrains")}>{t("v4.home.nobrains.lead")}</Empty>
          );
        }}
      </Await>
    </section>
  );
}

function Security() {
  const { t } = useI18n();
  const { me, say } = useApp();
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const revoke = async () => {
    setBusy(true);
    try {
      const r = await v3.revokeAll();
      say(t("b3.ag.revoked", { n: r.revoked }));
      setAsk(false);
    } catch (e) {
      say(e instanceof ApiError ? e.reason : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-labelledby="sc-h">
      <h2 id="sc-h" className="sec-title">
        {t("v4.settings.security")}
      </h2>
      <div className="setcard">
        <dl className="kv4">
          <div>
            <dt>{t("v4.sec.account")}</dt>
            <dd>{me?.principal.email}</dd>
          </div>
          <div>
            <dt>{t("v4.sec.method")}</dt>
            <dd>{t("v4.sec.method.v")}</dd>
          </div>
        </dl>
        <h3>{t("v4.sec.agents")}</h3>
        <p className="muted">{t("v4.sec.agents.lead")}</p>
        {ask ? (
          <div className="row" role="group" aria-label={t("b3.ag.confirm.title")}>
            <button type="button" className="btn danger" disabled={busy} onClick={revoke}>
              {busy ? t("common.working") : t("b3.ag.confirm.yes")}
            </button>
            <button type="button" className="btn ghost" onClick={() => setAsk(false)}>
              {t("b3.ag.confirm.no")}
            </button>
          </div>
        ) : (
          <button type="button" className="btn danger" onClick={() => setAsk(true)}>
            {t("v4.sec.revokeall")}
          </button>
        )}
      </div>
    </section>
  );
}

function Privacy() {
  const { t } = useI18n();
  const { say } = useApp();
  const [busy, setBusy] = useState(false);
  const exp = async () => {
    setBusy(true);
    try {
      await downloadExport("me");
      say(t("brain.export.done"));
    } catch (e) {
      say(e instanceof ApiError ? e.reason : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-labelledby="pv-h">
      <h2 id="pv-h" className="sec-title">
        {t("v4.settings.privacy")}
      </h2>
      <div className="setcard">
        <ul className="plain">
          <li>{t("v4.priv.1")}</li>
          <li>{t("v4.priv.2")}</li>
          <li>{t("v4.priv.3")}</li>
          <li>{t("v4.priv.4")}</li>
        </ul>
        <button type="button" className="btn soft" disabled={busy} onClick={exp}>
          <Download size={15} aria-hidden /> {t("v4.priv.export")}
        </button>
      </div>
      <ExpertSetting />
    </section>
  );
}

function Appearance() {
  const { t, lang, setLang } = useI18n();
  const { theme, setTheme } = useApp();
  const themes: [Theme, Key][] = [
    ["light", "v4.theme.light"],
    ["dark", "v4.theme.dark"],
    ["system", "v4.theme.system"],
  ];
  return (
    <section aria-labelledby="ap-h">
      <h2 id="ap-h" className="sec-title">
        {t("v4.settings.appearance")}
      </h2>
      <div className="setcard stack">
        <fieldset className="radios">
          <legend>{t("v4.theme")}</legend>
          {themes.map(([v, k]) => (
            <label key={v}>
              <input
                type="radio"
                name="theme"
                value={v}
                checked={theme === v}
                onChange={() => setTheme(v)}
              />
              {t(k)}
            </label>
          ))}
        </fieldset>
        <fieldset className="radios">
          <legend>{t("shell.language")}</legend>
          {(["en", "fr"] as const).map((l) => (
            <label key={l} lang={l}>
              <input
                type="radio"
                name="lang"
                value={l}
                checked={lang === l}
                onChange={() => setLang(l)}
              />
              {l === "en" ? "English" : "Français"}
            </label>
          ))}
        </fieldset>
      </div>
    </section>
  );
}

function Journal() {
  const { t } = useI18n();
  const log = useApi(() => api.activity(), []);
  return (
    <section aria-labelledby="jn-h">
      <h2 id="jn-h" className="sec-title">
        {t("v4.settings.journal")}
      </h2>
      <p className="muted">{t("v4.journal.lead")}</p>
      <Await state={log} skeleton={2}>
        {(rows) =>
          rows.length ? (
            <ul className="rows">
              {rows.map((r) => (
                <li key={r.id} className="rowline">
                  <div>
                    {r.title}
                    <p className="muted">{r.scopeLabel}</p>
                  </div>
                  <span className="muted">{fmtDate(r.at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title={t("v4.journal.empty")} />
          )
        }
      </Await>
    </section>
  );
}

export function Settings() {
  const { t } = useI18n();
  const { me } = useApp();
  const caps = useAdminCaps();
  const admin =
    !!me?.capabilities?.configure || !!(caps?.steward || caps?.auditor || caps?.elevation);
  // The console's rights arrive a moment after the page. Until they do, an admin route waits.
  const known = !!me && caps !== null;
  const guard = (el: JSX.Element) =>
    admin ? el : known ? <Navigate to="/settings/profile" replace /> : null;
  // v7 Operate: Sources for admins, Health for admins and stewards.
  const opsRights = useOpsRights();
  const wide = /^\/settings\/(sources|health)/.test(useLocation().pathname);
  const opsGuard = (ok: boolean, el: JSX.Element) =>
    ok ? el : opsRights.known ? <Navigate to="/settings/profile" replace /> : null;
  // Rules is for people with the configure grant, and only where the API says the surface exists.
  const rules = useRulesAccess(undefined, !!me?.capabilities?.configure);
  const items: { to: string; label: Key; admin?: boolean; gap?: boolean; show?: boolean; hide?: boolean }[] = [
    { to: "profile", label: "v4.settings.profile" },
    { to: "brains", label: "v4.settings.brains" },
    { to: "agents", label: "v4.settings.agents" },
    { to: "security", label: "v4.settings.security" },
    { to: "privacy", label: "v4.settings.privacy" },
    { to: "appearance", label: "v4.settings.appearance" },
    { to: "agent-settings", label: "v6.settings" },
    { to: "usage", label: "v4.settings.usage", gap: true },
    { to: "members", label: "v4.settings.members", admin: true, gap: true },
    { to: "pilot", label: "v4.settings.pilot", admin: true },
    { to: "sources", label: "v7o.nav.sources", show: opsRights.sources },
    { to: "health", label: "v7o.nav.health", show: opsRights.health },
    { to: "rules", label: "v7.rules", admin: true, hide: rules !== true },
    { to: "journal", label: "v4.settings.journal" },
  ];
  return (
    <div className={`page v4page settings${wide ? " wide" : ""}`}>
      <h1 className="ptitle">{t("v4.settings")}</h1>
      <div className="setgrid">
        <nav className="setnav" aria-label={t("v4.settings")}>
          <ul>
            {items
              .filter((i) => (i.show !== undefined ? i.show : !i.admin || admin) && !i.hide)
              .map((i) => (
                <li key={i.to} className={i.gap ? "gap" : undefined}>
                  <NavLink to={`/settings/${i.to}`}>{t(i.label)}</NavLink>
                </li>
              ))}
          </ul>
        </nav>
        <div className="setbody">
          <Routes>
            <Route index element={<Navigate to="/settings/profile" replace />} />
            <Route path="profile" element={<Profile />} />
            <Route path="brains" element={<YourBrains />} />
            <Route path="agents" element={<AgentsSection />} />
            <Route path="security" element={<Security />} />
            <Route path="privacy" element={<Privacy />} />
            <Route path="appearance" element={<Appearance />} />
            <Route
              path="agent-settings"
              element={
                <Suspense fallback={null}>
                  <AgentSettingsSection />
                </Suspense>
              }
            />
            <Route path="usage" element={<Usage />} />
            <Route path="members" element={guard(<Admin />)} />
            <Route path="pilot" element={guard(<PilotPage />)} />
            <Route path="sources" element={opsGuard(opsRights.sources, <SourcesList />)} />
            <Route path="sources/:id" element={opsGuard(opsRights.sources, <SourcePage />)} />
            <Route path="health" element={opsGuard(opsRights.health, <HealthPage />)} />
            <Route
              path="rules"
              element={
                !me || rules === null ? null : rules ? (
                  <Suspense fallback={null}>
                    <RulesPage />
                  </Suspense>
                ) : (
                  <Navigate to="/settings/profile" replace />
                )
              }
            />
            <Route path="journal" element={<Journal />} />
            <Route path="*" element={<Navigate to="/settings/profile" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
