// Pending and recent changes (roles, memberships, NDA grants) with approve, reject and withdraw.
// The two-person rule is the server's: the buttons only appear where the server says canDecide,
// and a refusal is shown with the server's reason.

import { useState } from "react";
import { Await, Chip } from "../../components/ui";
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
          if (rows.length === 0)
            return <p className="muted">Nothing waiting and nothing recent.</p>;
          return (
            <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {rows.map((c) => (
                <li className="card" key={c.id}>
                  <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
                    <div>
                      <strong>{describeChange(c)}</strong>
                      <div className="muted" style={{ fontSize: 14 }}>
                        Proposed by {c.proposedByEmail ?? whoIs(c.proposedBy)} ·{" "}
                        {fmtTime(c.proposedAt)}
                        {c.needsSecond ? " · second approver required" : ""}
                        {c.status === "pending" ? ` · lapses ${fmtTime(c.expiresAt)}` : ""}
                      </div>
                      {c.kind === "nda_grant" && typeof c.payload.reason === "string" ? (
                        <div style={{ fontSize: 14 }}>Reason: {c.payload.reason}</div>
                      ) : null}
                      {c.note ? <div style={{ fontSize: 14 }}>Note: {c.note}</div> : null}
                    </div>
                    <Chip tone={TONE[c.status]}>{c.status}</Chip>
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
                              if (
                                await run(
                                  () => adm.approveChange(c.id),
                                  "Change approved and applied.",
                                )
                              )
                                done();
                            }}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="btn sm"
                            disabled={busy}
                            onClick={() => setRejecting(rejecting === c.id ? null : c.id)}
                          >
                            Reject
                          </button>
                        </>
                      ) : c.canWithdraw ? (
                        <button
                          type="button"
                          className="btn sm"
                          disabled={busy}
                          onClick={async () => {
                            if (await run(() => adm.withdrawChange(c.id), "Change withdrawn."))
                              done();
                          }}
                        >
                          Withdraw
                        </button>
                      ) : (
                        <span className="muted" style={{ fontSize: 14 }}>
                          Waiting for someone else: you cannot decide your own proposal.
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
                        if (await run(() => adm.rejectChange(c.id, note), "Change rejected.")) {
                          setRejecting(null);
                          setNote("");
                          done();
                        }
                      }}
                    >
                      <label className="sr-only" htmlFor={`rej-${c.id}`}>
                        Reason for rejecting
                      </label>
                      <input
                        id={`rej-${c.id}`}
                        className="input"
                        placeholder="Reason for rejecting (the proposer sees it)"
                        value={note}
                        maxLength={300}
                        onChange={(e) => setNote(e.target.value)}
                      />
                      <button
                        type="submit"
                        className="btn danger sm"
                        disabled={busy || !note.trim()}
                      >
                        Confirm reject
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
