// Audit viewer for the auditor and platform admin. Receipts hold who, what, where and the result,
// never content.

import { useState } from "react";
import { Await, Chip, fmtDate, TableWrap } from "../../components/ui";
import { useI18n } from "../../i18n";
import { whoIs } from "../../personas";
import { useApi } from "../../useApi";
import { adm } from "./api";
import { Field } from "./shared";

export function AuditTab() {
  const { t, td } = useI18n();
  const [f, setF] = useState({ principal: "", action: "", from: "", to: "" });
  const [applied, setApplied] = useState(f);
  const rows = useApi(
    () =>
      adm.audit({
        principal: applied.principal.trim() || undefined,
        action: applied.action.trim() || undefined,
        from: applied.from || undefined,
        to: applied.to || undefined,
      }),
    [applied],
  );
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  return (
    <section aria-labelledby="audit-h" className="stack">
      <h3 id="audit-h">{t("adm.audit.title")}</h3>
      <p className="muted">{t("adm.audit.lead")}</p>
      <form
        className="row"
        style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(f);
        }}
      >
        <Field id="au-principal" label={t("adm.audit.principal")}>
          <input
            id="au-principal"
            className="input"
            placeholder="u_head_bid"
            value={f.principal}
            onChange={set("principal")}
          />
        </Field>
        <Field id="au-action" label={t("adm.audit.action")}>
          <input
            id="au-action"
            className="input"
            placeholder="gov.member_add"
            value={f.action}
            onChange={set("action")}
          />
        </Field>
        <Field id="au-from" label={t("adm.audit.from")}>
          <input id="au-from" className="input" type="date" value={f.from} onChange={set("from")} />
        </Field>
        <Field id="au-to" label={t("adm.audit.to")}>
          <input id="au-to" className="input" type="date" value={f.to} onChange={set("to")} />
        </Field>
        <button type="submit" className="btn primary">
          {t("adm.audit.apply")}
        </button>
      </form>
      <Await state={rows} skeleton={2}>
        {(d) =>
          d.length === 0 ? (
            <p className="muted">{t("adm.audit.empty")}</p>
          ) : (
            <TableWrap label={t("adm.audit.title")}>
              <table className="t">
                <caption className="sr-only">{t("adm.audit.title")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("adm.audit.col.receipt")}</th>
                    <th scope="col">{t("adm.audit.col.when")}</th>
                    <th scope="col">{t("adm.audit.col.actor")}</th>
                    <th scope="col">{t("adm.audit.action")}</th>
                    <th scope="col">{t("adm.audit.col.scope")}</th>
                    <th scope="col">{t("adm.audit.col.result")}</th>
                    <th scope="col">{t("adm.reason")}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.map((r) => (
                    <tr key={r.id}>
                      <td className="num">{r.id}</td>
                      <td>{fmtDate(r.at)}</td>
                      <td>{whoIs(r.actor, (rid, f) => td("role", rid, f))}</td>
                      <td>{r.action}</td>
                      <td>{r.scope}</td>
                      <td>
                        <Chip tone={r.result === "allow" ? "done" : "risk"}>
                          {td("adm.res", r.result)}
                        </Chip>
                      </td>
                      <td>{r.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )
        }
      </Await>
    </section>
  );
}
