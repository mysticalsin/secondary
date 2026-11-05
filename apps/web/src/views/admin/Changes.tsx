// Pending and recent changes (roles, memberships, NDA grants) with approve, reject and withdraw.
// The two-person rule is the server's: the buttons only appear where the server says canDecide,
// and a refusal is shown with the server's reason.

import { useState } from "react";
import { Await, Chip } from "../../components/ui";
import { useI18n } from "../../i18n";
import { whoIs } from "../../personas";
import { useApi } from "../../useApi";
import { adm, type Change } from "./api";
import { describeChange, fmtTime, Reason, useAct } from "./shared";

const TONE = {
  pending: "attn",
  applied: "done",
  rejected: "risk",
  withdrawn: "open",
  expired: "open",
} as const;
const STATUS_KEY = {
  pending: "adm.st.pending",
  applied: "adm.st.applied",
  rejected: "adm.st.rejected",
  withdrawn: "adm.st.withdrawn",
  expired: "adm.st.expired",
} as const;

export function Changes({
  kinds,
  title,
  refreshKey = 0,
  onChanged,
}: {
  kinds: Change["kind"][];
  title: string;
  refreshKey?: number;
  onChanged?: () => void;
}) {
  const { t, td } = useI18n();
  const list = useApi(() => adm.changes(), [refreshKey]);
  const { busy, error, run } = useAct();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const done = () => {
    list.reload();
    onChanged?.();
  };

  return (
    <section aria-labelledby={`chg-${kinds[0]}`}>
      <h3 id={`chg-${kinds[0]}`} style={{ marginBottom: 8 }}>
        {title}
      </h3>
      <Reason message={error} />
      <Await state={list} skeleton={2}>
        {(all) => {
          const rows = all.filter((c) => kinds.includes(c.kind));
          if (rows.length === 0) return <p className="muted">{t("adm.chg.empty")}</p>;
          return (
            <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {rows.map((c) => (
                <li className="card" key={c.id}>
                  <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
                    <div>
                      <strong>{describeChange(c, { t, td })}</strong>
                      <div className="muted" style={{ fontSize: 14 }}>
                        {t("adm.chg.proposed", {
                          who:
                            c.proposedByEmail ??
                            whoIs(c.proposedBy, (rid, f) => td("role", rid, f)),
                          when: fmtTime(c.proposedAt),
                        })}
                        {c.needsSecond ? ` · ${t("adm.chg.second")}` : ""}
                        {c.status === "pending"
                          ? ` · ${t("adm.chg.lapses", { when: fmtTime(c.expiresAt) })}`
                          : ""}
                      </div>
                      {c.kind === "nda_grant" && typeof c.payload.reason === "string" ? (
                        <div style={{ fontSize: 14 }}>
                          {t("adm.lbl.reason", { text: c.payload.reason })}
                        </div>
                      ) : null}
                      {c.note ? (
                        <div style={{ fontSize: 14 }}>{t("adm.lbl.note", { text: c.note })}</div>
                      ) : null}
                    </div>
                    <Chip tone={TONE[c.status]}>{t(STATUS_KEY[c.status])}</Chip>
                  </div>
                  {c.status === "pending" ? (
                    <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
                      {c.canDecide ? (
                        <>
                          <button
                            type="button"
                            className="btn primary sm"
                            disabled={busy}
                            onClick={async () => {
                              if (await run(() => adm.approveChange(c.id), t("adm.chg.approved")))
                                done();
                            }}
                          >
                            {t("adm.approve")}
                          </button>
                          <button
                            type="button"
                            className="btn sm"
                            disabled={busy}
                            onClick={() => setRejecting(rejecting === c.id ? null : c.id)}
                          >
                            {t("adm.chg.reject")}
                          </button>
                        </>
                      ) : c.canWithdraw ? (
                        <button
                          type="button"
                          className="btn sm"
                          disabled={busy}
                          onClick={async () => {
                            if (await run(() => adm.withdrawChange(c.id), t("adm.chg.withdrawn")))
                              done();
                          }}
                        >
                          {t("adm.chg.withdraw")}
                        </button>
                      ) : (
                        <span className="muted" style={{ fontSize: 14 }}>
                          {t("adm.chg.wait")}
                        </span>
                      )}
                    </div>
                  ) : null}
                  {rejecting === c.id ? (
                    <form
                      className="ask"
                      style={{ marginTop: 10 }}
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (await run(() => adm.rejectChange(c.id, note), t("adm.chg.rejected"))) {
                          setRejecting(null);
                          setNote("");
                          done();
                        }
                      }}
                    >
                      <label className="sr-only" htmlFor={`rej-${c.id}`}>
                        {t("adm.chg.reject.label")}
                      </label>
                      <input
                        id={`rej-${c.id}`}
                        className="input"
                        placeholder={t("adm.chg.reject.ph")}
                        value={note}
                        maxLength={300}
                        onChange={(e) => setNote(e.target.value)}
                      />
                      <button
                        type="submit"
                        className="btn danger sm"
                        disabled={busy || !note.trim()}
                      >
                        {t("adm.chg.reject.confirm")}
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          );
        }}
      </Await>
    </section>
  );
}
