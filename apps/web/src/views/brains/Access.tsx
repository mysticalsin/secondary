import { Lock, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError } from "../../api";
import { TableWrap } from "../../components/ui";
import { type Key, useI18n } from "../../i18n";
import { useApp } from "../../state";
import { useApi } from "../../useApi";
import { v3 } from "./api";
import { BrainFrame } from "./shared";
import type { AccessView, BrainRole, Everyone, Publication } from "./types";

const EVERYONE: Everyone[] = ["none", "reader", "contributor"];
const PUBLICATION: Publication[] = ["review", "direct"];

/**
 * Radios for one bounded setting. An option outside the policy bound is disabled and the reason
 * the server gave is on the page, tied to the option, not only in a tooltip.
 */
export function BoundedChoice<T extends string>({
  name,
  legend,
  values,
  allowed,
  value,
  reason,
  disabled,
  label,
  hint,
  onChange,
}: {
  name: string;
  legend: string;
  values: T[];
  allowed: T[];
  value: T;
  reason: string | null;
  disabled: boolean;
  label: (v: T) => string;
  hint: (v: T) => string;
  onChange: (v: T) => void;
}) {
  const { t } = useI18n();
  const blocked = values.some((v) => !allowed.includes(v));
  return (
    <fieldset className="choices bounded">
      <legend>{legend}</legend>
      {values.map((v) => {
        const off = !allowed.includes(v);
        const rid = `${name}-${v}`;
        return (
          <label key={v} className={`choice${off ? " locked" : ""}`} htmlFor={rid}>
            <input
              id={rid}
              type="radio"
              name={name}
              value={v}
              checked={value === v}
              disabled={disabled || off}
              aria-describedby={off && reason ? `${name}-why` : undefined}
              onChange={() => onChange(v)}
            />
            <span>
              <b>
                {label(v)}
                {off ? (
                  <span className="chip t-attn" style={{ marginLeft: 8 }}>
                    <Lock size={11} aria-hidden /> {t("b3.acc.notallowed")}
                  </span>
                ) : null}
              </b>
              <span className="muted">{hint(v)}</span>
            </span>
          </label>
        );
      })}
      {blocked && reason ? (
        <p id={`${name}-why`} className="bound-why">
          <Lock size={14} aria-hidden /> {reason}
        </p>
      ) : null}
    </fieldset>
  );
}

function Members({
  id,
  view,
  onChange,
  onPending,
}: {
  id: string;
  view: AccessView;
  onChange: () => void;
  onPending: () => void;
}) {
  const { t } = useI18n();
  const { say } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [newId, setNewId] = useState("");
  const [newRole, setNewRole] = useState<BrainRole>("reader");
  const run = async (key: string, fn: () => ReturnType<typeof v3.setMember>) => {
    setBusy(key);
    setErr(null);
    try {
      const r = await fn();
      if (r.status === "pending") {
        say(t("b3.acc.pending.say"));
        onPending();
      } else say(t("b3.acc.saved"));
      onChange();
    } catch (e) {
      setErr(e instanceof ApiError ? e.reason : t("common.failed"));
    } finally {
      setBusy(null);
    }
  };
  const members = view.members ?? [];
  return (
    <section className="card" aria-labelledby="mem-h">
      <h3 id="mem-h">{t("b3.acc.members")}</h3>
      {view.members === null ? <p className="muted">{t("b3.acc.members.hidden")}</p> : null}
      {err ? (
        <div className="errorbox" role="alert">
          {err}
        </div>
      ) : null}
      {members.length ? (
        <TableWrap label={t("b3.acc.members")}>
          <table className="t">
            <thead>
              <tr>
                <th scope="col">{t("b3.acc.person")}</th>
                <th scope="col">{t("b3.acc.role")}</th>
                <th scope="col">{t("b3.acc.state")}</th>
                <th scope="col">
                  <span className="sr-only">{t("b3.acc.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.principalId}>
                  <th scope="row">{m.email}</th>
                  <td>
                    <label className="sr-only" htmlFor={`role-${m.principalId}`}>
                      {t("b3.acc.role.of", { who: m.email })}
                    </label>
                    <select
                      id={`role-${m.principalId}`}
                      className="select"
                      value={m.role}
                      disabled={!view.canManage || busy !== null}
                      onChange={(e) =>
                        run(m.principalId, () =>
                          v3.setMember(id, m.principalId, e.target.value as BrainRole),
                        )
                      }
                    >
                      {view.roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <span className={`chip t-${m.state === "pending" ? "attn" : "done"}`}>
                      {t(m.state === "pending" ? "b3.acc.s.pending" : "b3.acc.s.active")}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn sm danger"
                      disabled={!view.canManage || busy !== null}
                      onClick={() => run(m.principalId, () => v3.removeMember(id, m.principalId))}
                    >
                      {t("b3.acc.remove")}
                      <span className="sr-only"> {m.email}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      ) : view.members ? (
        <p className="muted">{t("b3.acc.members.none")}</p>
      ) : null}
      {view.canManage && view.type !== "personal" ? (
        <form
          className="row addmember"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newId.trim()) return;
            run("new", () => v3.setMember(id, newId.trim(), newRole)).then(() => setNewId(""));
          }}
        >
          <div className="field">
            <label htmlFor="m-new">{t("b3.acc.add.id")}</label>
            <input
              id="m-new"
              className="input"
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              placeholder="u_…"
            />
          </div>
          <div className="field">
            <label htmlFor="m-role">{t("b3.acc.role")}</label>
            <select
              id="m-role"
              className="select"
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as BrainRole)}
            >
              {view.roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn" disabled={busy !== null || !newId.trim()}>
            <UserPlus size={16} aria-hidden /> {t("b3.acc.add")}
          </button>
        </form>
      ) : null}
      <details className="roles-legend">
        <summary>{t("b3.acc.roles.legend")}</summary>
        <dl>
          {view.roles.map((r) => (
            <div key={r.id}>
              <dt>{r.label}</dt>
              <dd className="muted">{r.summary}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}

export function AccessPanel({
  id,
  view,
  reload,
}: {
  id: string;
  view: AccessView;
  reload: () => void;
}) {
  const { t } = useI18n();
  const { say } = useApp();
  const [err, setErr] = useState<string | null>(null);
  const [pendingNow, setPendingNow] = useState(false);
  // The choice shows at once and snaps back if the server refuses it.
  const [pub, setPub] = useState(view.publication.mode);
  const [every, setEvery] = useState(view.everyone.level);
  useEffect(() => {
    setPub(view.publication.mode);
    setEvery(view.everyone.level);
  }, [view.publication.mode, view.everyone.level]);
  const save = async (body: { publication?: Publication; everyone?: Everyone }) => {
    setErr(null);
    if (body.publication) setPub(body.publication);
    if (body.everyone) setEvery(body.everyone);
    try {
      await v3.setAccess(id, body);
      say(t("b3.acc.saved"));
      reload();
    } catch (e) {
      setPub(view.publication.mode);
      setEvery(view.everyone.level);
      setErr(e instanceof ApiError ? e.reason : t("common.failed"));
    }
  };
  const waiting = (view.members ?? []).filter((m) => m.state === "pending").length;
  const showBanner = waiting > 0 || pendingNow;
  return (
    <div className="stack access">
      {showBanner ? (
        <div className="banner" role="status" data-testid="pending-banner">
          <b>{t("b3.acc.banner.title")}</b>{" "}
          <span>{t("b3.acc.banner.lead", { n: Math.max(waiting, 1) })}</span>{" "}
          <Link to="/admin">{t("b3.acc.banner.link")}</Link>
        </div>
      ) : null}
      {view.type === "personal" ? (
        <div className="banner info" role="note">
          {t("b3.acc.personal")}
        </div>
      ) : null}
      {!view.canManage ? (
        <p className="muted" role="note">
          {t("b3.acc.readonly")}
        </p>
      ) : null}
      {err ? (
        <div className="errorbox" role="alert">
          {err}
        </div>
      ) : null}
      <section className="card two-col">
        <BoundedChoice<Everyone>
          name="everyone"
          legend={t("b3.acc.everyone")}
          values={EVERYONE}
          allowed={view.everyone.allowed}
          value={every}
          reason={view.everyone.reason}
          disabled={!view.canManage}
          label={(v) => t(`b3.acc.ev.${v}` as Key)}
          hint={(v) => t(`b3.acc.ev.${v}.d` as Key)}
          onChange={(v) => save({ everyone: v })}
        />
        <BoundedChoice<Publication>
          name="publication"
          legend={t("b3.acc.publication")}
          values={PUBLICATION}
          allowed={view.publication.allowed}
          value={pub}
          reason={view.publication.reason}
          disabled={!view.canManage}
          label={(v) => t(`b3.acc.pub.${v}` as Key)}
          hint={(v) => t(`b3.acc.pub.${v}.d` as Key)}
          onChange={(v) => save({ publication: v })}
        />
      </section>
      {view.type !== "personal" ? (
        <Members id={id} view={view} onChange={reload} onPending={() => setPendingNow(true)} />
      ) : null}
    </div>
  );
}

export function AccessPage() {
  const { id = "" } = useParams();
  const access = useApi(() => v3.access(id), [id]);
  const { t } = useI18n();
  return (
    <BrainFrame id={id} tab="access">
      {() => (
        <>
          <h3 className="sec-h">{t("b3.acc.title")}</h3>
          {access.data ? (
            <AccessPanel id={id} view={access.data} reload={access.reload} />
          ) : access.error ? (
            <div className="errorbox" role="alert">
              {access.error}
            </div>
          ) : null}
        </>
      )}
    </BrainFrame>
  );
}
