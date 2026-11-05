// Access requests. A locked node is requested with a reason and lands in the steward queue. A
// steward approves or denies with a reason; nothing is granted automatically.

import { useState } from "react";
import { api } from "../../api";
import { Await, Chip } from "../../components/ui";
import { useI18n } from "../../i18n";
import { useApi } from "../../useApi";
import { type AccessReq, adm } from "./api";
import { Field, fmtTime, Reason, useAct } from "./shared";

const TONE = { pending: "attn", approved: "progress", granted: "done", denied: "risk" } as const;
const STATE_KEY = {
  pending: "adm.rs.pending",
  approved: "adm.rs.approved",
  granted: "adm.rs.granted",
  denied: "adm.rs.denied",
} as const;

/** The request form. Also usable from a node drawer: pass `nodeId` to skip the picker. */
export function RequestAccessForm({
  nodeId,
  label,
  onSent,
  onCancel,
}: {
  nodeId?: string;
  /** Name of the node, when the form is opened from its drawer. */
  label?: string;
  onSent?: () => void;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const locked = useApi(async () => {
    if (nodeId) return [{ id: nodeId, label: label ?? nodeId }];
    const m = await api.map("departments");
    return m.hubs.filter((h) => h.access === "locked").map((h) => ({ id: h.id, label: h.label }));
  }, [nodeId]);
  const [node, setNode] = useState(nodeId ?? "");
  const [reason, setReason] = useState("");
  const { busy, error, run } = useAct();

  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => adm.requestAccess(node, reason), t("dr.requested"))) {
          setReason("");
          setNode(nodeId ?? "");
          onSent?.();
        }
      }}
    >
      <h4>{t("adm.req.form")}</h4>
      <Await state={locked} skeleton={1}>
        {(list) =>
          list.length === 0 ? (
            <p className="muted">{t("adm.req.nothing")}</p>
          ) : (
            <>
              <Field id="req-node" label={t("adm.req.space")}>
                <select
                  id="req-node"
                  className="select"
                  value={node}
                  onChange={(e) => setNode(e.target.value)}
                >
                  <option value="">{t("adm.choose.space")}</option>
                  {list.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="req-reason" label={t("adm.req.why")} hint={t("adm.req.why.hint")}>
                <input
                  id="req-reason"
                  className="input"
                  maxLength={200}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
              <Reason message={error} />
              <div>
                <button
                  type="submit"
                  className="btn primary"
                  disabled={busy || !node || !reason.trim()}
                >
                  {t("adm.req.send")}
                </button>
                {onCancel ? (
                  <button type="button" className="btn ghost" onClick={onCancel}>
                    {t("common.cancel")}
                  </button>
                ) : null}
              </div>
            </>
          )
        }
      </Await>
    </form>
  );
}

function Row({ r, onDone, queue }: { r: AccessReq; onDone: () => void; queue: boolean }) {
  const { t } = useI18n();
  const { busy, error, run } = useAct();
  const [denying, setDenying] = useState(false);
  const [note, setNote] = useState("");
  return (
    <li className="card">
      <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
        <div>
          <strong>{r.scopeLabel}</strong>
          <div className="muted" style={{ fontSize: 14 }}>
            {queue ? `${r.requesterEmail ?? r.principalId} · ` : ""}
            {fmtTime(r.createdAt)}
          </div>
          <div style={{ fontSize: 14 }}>{t("adm.lbl.reason", { text: r.reason })}</div>
          {r.note ? (
            <div style={{ fontSize: 14 }}>{t("adm.req.steward_note", { text: r.note })}</div>
          ) : null}
        </div>
        <Chip tone={TONE[r.status]}>{t(STATE_KEY[r.status])}</Chip>
      </div>
      {queue && r.status === "pending" ? (
        r.canDecide ? (
          <div className="stack" style={{ marginTop: 10 }}>
            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn primary sm"
                disabled={busy}
                onClick={async () => {
                  const x = await run(
                    () => adm.approveRequest(r.id),
                    (o) => t(o.applied ? "adm.req.granted" : "adm.req.approved"),
                  );
                  if (x) onDone();
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
            </div>
            {denying ? (
              <form
                className="ask"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await run(() => adm.denyRequest(r.id, note), t("adm.req.denied"))) onDone();
                }}
              >
                <label className="sr-only" htmlFor={`deny-${r.id}`}>
                  {t("adm.deny.label")}
                </label>
                <input
                  id={`deny-${r.id}`}
                  className="input"
                  placeholder={t("adm.req.deny.ph")}
                  maxLength={300}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <button type="submit" className="btn danger sm" disabled={busy || !note.trim()}>
                  {t("adm.deny.confirm")}
                </button>
              </form>
            ) : null}
            <Reason message={error} />
          </div>
        ) : (
          <p className="muted" style={{ fontSize: 14, marginTop: 8 }}>
            {t("adm.req.cannot")}
          </p>
        )
      ) : null}
    </li>
  );
}

export function RequestsTab() {
  const { t } = useI18n();
  const mine = useApi(() => adm.accessRequests("mine"), []);
  const queue = useApi(() => adm.accessRequests("queue"), []);
  const both = () => {
    mine.reload();
    queue.reload();
  };
  return (
    <div className="stack" style={{ gap: 24 }}>
      <RequestAccessForm onSent={both} />
      <section aria-labelledby="myreq-h">
        <h3 id="myreq-h" style={{ marginBottom: 8 }}>
          {t("adm.req.mine")}
        </h3>
        <Await state={mine} skeleton={1}>
          {(rows) =>
            rows.length === 0 ? (
              <p className="muted">{t("adm.req.mine.empty")}</p>
            ) : (
              <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {rows.map((r) => (
                  <Row key={r.id} r={r} queue={false} onDone={both} />
                ))}
              </ul>
            )
          }
        </Await>
      </section>
      <section aria-labelledby="queue-h">
        <h3 id="queue-h" style={{ marginBottom: 8 }}>
          {t("adm.req.queue")}
        </h3>
        <Await state={queue} skeleton={1}>
          {(rows) =>
            rows.length === 0 ? (
              <p className="muted">{t("adm.req.queue.empty")}</p>
            ) : (
              <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {rows.map((r) => (
                  <Row key={r.id} r={r} queue onDone={both} />
                ))}
              </ul>
            )
          }
        </Await>
      </section>
    </div>
  );
}
