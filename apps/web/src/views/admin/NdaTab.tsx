// Named access to NDA accounts: a reason, an expiry, and a second person to approve.

import { useState } from "react";
import { Await, Chip, Empty, TableWrap } from "../../components/ui";
import { useI18n } from "../../i18n";
import { useApi } from "../../useApi";
import { adm } from "./api";
import { Changes } from "./Changes";
import { Field, fmtTime, Reason, useAct } from "./shared";

const inDays = (n: number): string =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

export function NdaTab() {
  const { t } = useI18n();
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
      t("adm.nda.proposed"),
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
          {t("adm.nda.title")}
        </h3>
        <Await state={data} skeleton={2}>
          {(d) => (
            <div className="stack">
              {d.grants.length === 0 ? (
                <p className="muted">{t("adm.nda.none")}</p>
              ) : (
                <TableWrap label={t("adm.nda.title")}>
                  <table className="t">
                    <caption className="sr-only">{t("adm.nda.title")}</caption>
                    <thead>
                      <tr>
                        <th scope="col">{t("adm.person")}</th>
                        <th scope="col">{t("adm.account")}</th>
                        <th scope="col">{t("adm.reason")}</th>
                        <th scope="col">{t("adm.nda.col.expires")}</th>
                        <th scope="col">{t("adm.nda.col.state")}</th>
                        <th scope="col">
                          <span className="sr-only">{t("adm.actions")}</span>
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
                              {g.active ? t("adm.st.active") : t("adm.st.expired")}
                            </Chip>
                          </td>
                          <td>
                            {g.active ? (
                              <button
                                type="button"
                                className="btn sm"
                                disabled={revoking}
                                aria-label={t("adm.nda.revoke.aria", {
                                  who: g.email || g.principalId,
                                  account: g.accountId,
                                })}
                                onClick={async () => {
                                  if (
                                    await runRevoke(
                                      () =>
                                        adm.ndaRevoke({
                                          principalId: g.principalId,
                                          accountId: g.accountId,
                                        }),
                                      t("adm.nda.revoked"),
                                    )
                                  )
                                    data.reload();
                                }}
                              >
                                {t("adm.nda.revoke")}
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              )}
              <Reason message={revokeError} />
              {d.accounts.length === 0 ? (
                <Empty title={t("adm.nda.empty.title")}>{t("adm.nda.empty.body")}</Empty>
              ) : (
                <form
                  className="card stack"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submit();
                  }}
                >
                  <h4>{t("adm.nda.form")}</h4>
                  <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
                    <Field id="nda-account" label={t("adm.account")}>
                      <select
                        id="nda-account"
                        className="select"
                        value={account}
                        onChange={(e) => setAccount(e.target.value)}
                      >
                        <option value="">{t("adm.nda.choose")}</option>
                        {d.accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field id="nda-person" label={t("adm.person")}>
                      <select
                        id="nda-person"
                        className="select"
                        value={person}
                        onChange={(e) => setPerson(e.target.value)}
                      >
                        <option value="">{t("adm.choose.person")}</option>
                        {(people.data ?? []).map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.email}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field
                      id="nda-expiry"
                      label={t("adm.nda.expiry")}
                      hint={t("adm.nda.expiry.hint")}
                    >
                      <input
                        id="nda-expiry"
                        className="input"
                        type="date"
                        value={expiry}
                        onChange={(e) => setExpiry(e.target.value)}
                      />
                    </Field>
                  </div>
                  <Field id="nda-reason" label={t("adm.reason")}>
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
                      {t("adm.nda.propose")}
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
        title={t("adm.nda.changes")}
        refreshKey={tick}
        onChanged={() => {
          data.reload();
          setTick((t) => t + 1);
        }}
      />
    </div>
  );
}
