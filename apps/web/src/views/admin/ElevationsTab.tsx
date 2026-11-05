// Time-boxed elevation: a reason, up to the role's maximum, ends on its own. Where the role
// requires it, a second admin approves. Nobody approves their own request.

import { useState } from "react";
import { Await, Chip } from "../../components/ui";
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

function Item({ e, onDone }: { e: Elevation; onDone: () => void }) {
  const { busy, error, run } = useAct();
  const [denying, setDenying] = useState(false);
  const [note, setNote] = useState("");
  return (
    <li className="card">
      <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
        <div>
          <strong>{e.email ?? e.principalId}</strong> · {e.hours} h
          <div className="muted" style={{ fontSize: 14 }}>
            Asked {fmtTime(e.requestedAt)}
            {e.status === "active" && e.until ? ` · ends ${fmtTime(e.until)}` : ""}
          </div>
          <div style={{ fontSize: 14 }}>Reason: {e.reason}</div>
          {e.note ? <div style={{ fontSize: 14 }}>Note: {e.note}</div> : null}
        </div>
        <Chip tone={TONE[e.status]}>{e.status}</Chip>
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
                        "Elevation approved.",
                      )
                    )
                      onDone();
                  }}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="btn sm"
                  disabled={busy}
                  onClick={() => setDenying(!denying)}
                >
                  Deny
                </button>
              </>
            ) : null}
            {e.canEnd ? (
              <button
                type="button"
                className="btn sm"
                disabled={busy}
                onClick={async () => {
                  if (await run(() => adm.endElevation(e.id), "Elevation ended.")) onDone();
                }}
              >
                End now
              </button>
            ) : null}
          </div>
          {denying ? (
            <form
              className="ask"
              onSubmit={async (ev) => {
                ev.preventDefault();
                if (await run(() => adm.decideElevation(e.id, "deny", note), "Elevation denied."))
                  onDone();
              }}
            >
              <label className="sr-only" htmlFor={`elv-deny-${e.id}`}>
                Reason for denying
              </label>
              <input
                id={`elv-deny-${e.id}`}
                className="input"
                placeholder="Reason"
                maxLength={300}
                value={note}
                onChange={(x) => setNote(x.target.value)}
              />
              <button type="submit" className="btn danger sm" disabled={busy || !note.trim()}>
                Confirm deny
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
          Elevate my access
        </h3>
        <Await state={mine} skeleton={1}>
          {(m) =>
            !m.eligible ? (
              <p className="muted">
                None of your roles can be elevated. Ask a platform admin to review your role.
              </p>
            ) : m.active ? (
              <div className="callout attention" role="status">
                Elevated until {fmtTime(m.active.until)}. Reason: {m.active.reason}
              </div>
            ) : m.pending ? (
              <div className="callout" role="status">
                Waiting for approval: {m.pending.hours} h, {m.pending.reason}
              </div>
            ) : (
              <form
                className="card stack"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (
                    await run(
                      () => adm.requestElevation({ hours: Number(hours), reason }),
                      m.eligible?.needsApproval
                        ? "Request sent for approval."
                        : "Elevation is active.",
                    )
                  ) {
                    setReason("");
                    reload();
                  }
                }}
              >
                <p>
                  Your role can unlock <strong>{m.eligible.actions.join(", ")}</strong> for up to{" "}
                  <strong>{m.eligible.maxHours} hours</strong>.{" "}
                  {m.eligible.needsApproval
                    ? "A second admin must approve each request."
                    : "It starts as soon as you ask, and every use is audited."}
                </p>
                <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
                  <Field id="elev-hours" label="Hours">
                    <input
                      id="elev-hours"
                      className="input"
                      inputMode="numeric"
                      value={hours}
                      onChange={(e) => setHours(e.target.value.replace(/\D/g, ""))}
                      style={{ width: 90 }}
                    />
                  </Field>
                  <Field id="elev-reason" label="Reason">
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
                    {m.eligible.needsApproval ? "Request elevation" : "Elevate now"}
                  </button>
                </div>
              </form>
            )
          }
        </Await>
      </section>
      <section aria-labelledby="elev-list-h">
        <h3 id="elev-list-h" style={{ marginBottom: 8 }}>
          Requests and windows
        </h3>
        <Await state={list} skeleton={1}>
          {(rows) =>
            rows.length === 0 ? (
              <p className="muted">No elevation requests yet.</p>
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
