// Named access to NDA accounts: a reason, an expiry, and a second person to approve.

import { useState } from "react";
import { Await, Chip, Empty } from "../../components/ui";
import { useApi } from "../../useApi";
import { adm } from "./api";
import { Changes } from "./Changes";
import { Field, fmtTime, Reason, useAct } from "./shared";

const inDays = (n: number): string =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

export function NdaTab() {
  const data = useApi(() => adm.nda(), []);
  const people = useApi(() => adm.principals(), []);
  const [account, setAccount] = useState("");
  const [person, setPerson] = useState("");
  const [reason, setReason] = useState("");
  const [expiry, setExpiry] = useState(inDays(30));
  const [tick, setTick] = useState(0);
  const { busy, error, run } = useAct();
  const { busy: revoking, error: revokeError, run: runRevoke } = useAct();

  const submit = async () => {
    const r = await run(
      () =>
        adm.ndaGrant({
          principalId: person,
          accountId: account,
          reason,
          expiresAt: `${expiry}T23:59:59Z`,
        }),
      "Proposed. A second person must approve before access starts.",
    );
    if (r) {
      setReason("");
      setPerson("");
      setTick((t) => t + 1);
    }
  };

  return (
    <div className="stack" style={{ gap: 24 }}>
      <section aria-labelledby="nda-h">
        <h3 id="nda-h" style={{ marginBottom: 8 }}>
          Named NDA grants
        </h3>
        <Await state={data} skeleton={2}>
          {(d) => (
            <div className="stack">
              {d.grants.length === 0 ? (
                <p className="muted">No named grants.</p>
              ) : (
                <div className="tablewrap">
                  <table className="t">
                    <caption className="sr-only">Named NDA grants</caption>
                    <thead>
                      <tr>
                        <th scope="col">Person</th>
                        <th scope="col">Account</th>
                        <th scope="col">Reason</th>
                        <th scope="col">Expires</th>
                        <th scope="col">State</th>
                        <th scope="col">
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.grants.map((g) => (
                        <tr key={`${g.principalId}-${g.accountId}`}>
                          <th scope="row" style={{ background: "transparent", position: "static" }}>
                            {g.email || g.principalId}
                          </th>
                          <td>{g.accountId}</td>
                          <td>{g.reason ?? ""}</td>
                          <td>{fmtTime(g.expiresAt)}</td>
                          <td>
                            <Chip tone={g.active ? "done" : "open"}>
                              {g.active ? "active" : "expired"}
                            </Chip>
                          </td>
                          <td>
                            {g.active ? (
                              <button
                                type="button"
                                className="btn sm"
                                disabled={revoking}
                                aria-label={`Revoke ${g.email || g.principalId} on ${g.accountId}`}
                                onClick={async () => {
                                  if (
                                    await runRevoke(
                                      () =>
                                        adm.ndaRevoke({
                                          principalId: g.principalId,
                                          accountId: g.accountId,
                                        }),
                                      "Grant revoked.",
                                    )
                                  )
                                    data.reload();
                                }}
                              >
                                Revoke
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <Reason message={revokeError} />
              {d.accounts.length === 0 ? (
                <Empty title="No NDA account to manage">
                  Named grants are managed by the account's steward or a platform admin.
                </Empty>
              ) : (
                <form
                  className="card stack"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submit();
                  }}
                >
                  <h4>Grant access to an NDA account</h4>
                  <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
                    <Field id="nda-account" label="Account">
                      <select
                        id="nda-account"
                        className="select"
                        value={account}
                        onChange={(e) => setAccount(e.target.value)}
                      >
                        <option value="">Choose an account</option>
                        {d.accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field id="nda-person" label="Person">
                      <select
                        id="nda-person"
                        className="select"
                        value={person}
                        onChange={(e) => setPerson(e.target.value)}
                      >
                        <option value="">Choose a person</option>
                        {(people.data ?? []).map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.email}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field id="nda-expiry" label="Expires on" hint="At most one year ahead">
                      <input
                        id="nda-expiry"
                        className="input"
                        type="date"
                        value={expiry}
                        onChange={(e) => setExpiry(e.target.value)}
                      />
                    </Field>
                  </div>
                  <Field id="nda-reason" label="Reason">
                    <input
                      id="nda-reason"
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
                      disabled={busy || !account || !person || !reason.trim() || !expiry}
                    >
                      Propose grant
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </Await>
      </section>
      <Changes
        kinds={["nda_grant"]}
        title="Grants waiting for approval"
        refreshKey={tick}
        onChanged={() => {
          data.reload();
          setTick((t) => t + 1);
        }}
      />
    </div>
  );
}
