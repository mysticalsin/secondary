// Time-boxed elevation: a reason, up to the role's maximum, ends on its own. Where the role
// requires it, a second admin approves. Nobody approves their own request.

import { useState } from "react";
import { Await, Chip } from "../../components/ui";
import { useI18n } from "../../i18n";
import { useApi } from "../../useApi";
import { adm, type Elevation } from "./api";
import { Field, fmtTime, Reason, useAct } from "./shared";

const TONE = {
  pending: "attn",
  active: "done",
  denied: "risk",
  ended: "open",
  expired: "open",
} as const;

const STATUS_KEY = {
  pending: "adm.st.pending",
  active: "adm.st.active",
  denied: "adm.st.denied",
  ended: "adm.st.ended",
  expired: "adm.st.expired",
} as const;

function Item({ e, onDone }: { e: Elevation; onDone: () => void }) {
  const { t } = useI18n();
  const { busy, error, run } = useAct();
  const [denying, setDenying] = useState(false);
  const [note, setNote] = useState("");
  return (
    <li className="card">
      <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
        <div>
          <strong>{e.email ?? e.principalId}</strong> · {e.hours} h
          <div className="muted" style={{ fontSize: 14 }}>
            {t("adm.el.asked", { when: fmtTime(e.requestedAt) })}
            {e.status === "active" && e.until
              ? ` · ${t("adm.el.ends", { when: fmtTime(e.until) })}`
              : ""}
          </div>
          <div style={{ fontSize: 14 }}>{t("adm.lbl.reason", { text: e.reason })}</div>
          {e.note ? (
            <div style={{ fontSize: 14 }}>{t("adm.lbl.note", { text: e.note })}</div>
          ) : null}
        </div>
        <Chip tone={TONE[e.status]}>{t(STATUS_KEY[e.status])}</Chip>
      </div>
      {e.canDecide || e.canEnd ? (
        <div className="stack" style={{ marginTop: 10 }}>
          <div className="row" style={{ gap: 8 }}>
            {e.canDecide ? (
              <>
                <button
                  type="button"
                  className="btn primary sm"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      await run(
                        () => adm.decideElevation(e.id, "approve", ""),
                        t("adm.el.approved"),
                      )
                    )
                      onDone();
                  }}
                >
                  {t("adm.approve")}
                </button>
                <button
                  type="button"
                  className="btn sm"
                  disabled={busy}
                  onClick={() => setDenying(!denying)}
                >
                  {t("adm.deny")}
                </button>
              </>
            ) : null}
            {e.canEnd ? (
              <button
                type="button"
                className="btn sm"
                disabled={busy}
                onClick={async () => {
                  if (await run(() => adm.endElevation(e.id), t("adm.el.ended"))) onDone();
                }}
              >
                {t("adm.el.end")}
              </button>
            ) : null}
          </div>
          {denying ? (
            <form
              className="ask"
              onSubmit={async (ev) => {
                ev.preventDefault();
                if (await run(() => adm.decideElevation(e.id, "deny", note), t("adm.el.denied")))
                  onDone();
              }}
            >
              <label className="sr-only" htmlFor={`elv-deny-${e.id}`}>
                {t("adm.deny.label")}
              </label>
              <input
                id={`elv-deny-${e.id}`}
                className="input"
                placeholder={t("adm.reason")}
                maxLength={300}
                value={note}
                onChange={(x) => setNote(x.target.value)}
              />
              <button type="submit" className="btn danger sm" disabled={busy || !note.trim()}>
                {t("adm.deny.confirm")}
              </button>
            </form>
          ) : null}
          <Reason message={error} />
        </div>
      ) : null}
    </li>
  );
}

export function ElevationsTab() {
  const { t, td, tn } = useI18n();
  const mine = useApi(() => adm.elevation(), []);
  const list = useApi(() => adm.elevations(), []);
  const [hours, setHours] = useState("2");
  const [reason, setReason] = useState("");
  const { busy, error, run } = useAct();
  const reload = () => {
    mine.reload();
    list.reload();
  };
  return (
    <div className="stack" style={{ gap: 24 }}>
      <section aria-labelledby="elev-h">
        <h3 id="elev-h" style={{ marginBottom: 8 }}>
          {t("adm.el.title")}
        </h3>
        <Await state={mine} skeleton={1}>
          {(m) =>
            !m.eligible ? (
              <p className="muted">{t("adm.el.none")}</p>
            ) : m.active ? (
              <div className="callout attention" role="status">
                {t("adm.el.active", { when: fmtTime(m.active.until), reason: m.active.reason })}
              </div>
            ) : m.pending ? (
              <div className="callout" role="status">
                {t("adm.el.pending", { hours: m.pending.hours, reason: m.pending.reason })}
              </div>
            ) : (
              <form
                className="card stack"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (
                    await run(
                      () => adm.requestElevation({ hours: Number(hours), reason }),
                      m.eligible?.needsApproval ? t("adm.el.sent") : t("adm.el.started"),
                    )
                  ) {
                    setReason("");
                    reload();
                  }
                }}
              >
                <p>
                  {t("adm.el.can")}{" "}
                  <strong>{m.eligible.actions.map((a) => td("adm.act", a)).join(", ")}</strong>{" "}
                  {t("adm.el.upto")}{" "}
                  <strong>
                    {tn(m.eligible.maxHours, "adm.el.hours.one", "adm.el.hours.other")}
                  </strong>
                  . {m.eligible.needsApproval ? t("adm.el.needs_approval") : t("adm.el.instant")}
                </p>
                <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
                  <Field id="elev-hours" label={t("adm.el.hours")}>
                    <input
                      id="elev-hours"
                      className="input"
                      inputMode="numeric"
                      value={hours}
                      onChange={(e) => setHours(e.target.value.replace(/\D/g, ""))}
                      style={{ width: 90 }}
                    />
                  </Field>
                  <Field id="elev-reason" label={t("adm.reason")}>
                    <input
                      id="elev-reason"
                      className="input"
                      maxLength={200}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </Field>
                </div>
                <Reason message={error} />
                <div>
                  <button
                    type="submit"
                    className="btn primary"
                    disabled={busy || !reason.trim() || !hours}
                  >
                    {m.eligible.needsApproval ? t("adm.el.request") : t("adm.el.now")}
                  </button>
                </div>
              </form>
            )
          }
        </Await>
      </section>
      <section aria-labelledby="elev-list-h">
        <h3 id="elev-list-h" style={{ marginBottom: 8 }}>
          {t("adm.el.list")}
        </h3>
        <Await state={list} skeleton={1}>
          {(rows) =>
            rows.length === 0 ? (
              <p className="muted">{t("adm.el.empty")}</p>
            ) : (
              <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {rows.map((e) => (
                  <Item key={e.id} e={e} onDone={reload} />
                ))}
              </ul>
            )
          }
        </Await>
      </section>
    </div>
  );
}
