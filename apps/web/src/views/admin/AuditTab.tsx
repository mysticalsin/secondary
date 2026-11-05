// Audit viewer for the auditor and platform admin. Receipts hold who, what, where and the result,
// never content.

import { useState } from "react";
import { Await, Chip, fmtDate } from "../../components/ui";
import { whoIs } from "../../personas";
import { useApi } from "../../useApi";
import { adm } from "./api";
import { Field } from "./shared";

export function AuditTab() {
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
      <h3 id="audit-h">Audit receipts</h3>
      <p className="muted">Who, what, where, result. No content.</p>
      <form
        className="row"
        style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(f);
        }}
      >
        <Field id="au-principal" label="Principal id">
          <input
            id="au-principal"
            className="input"
            placeholder="u_head_bid"
            value={f.principal}
            onChange={set("principal")}
          />
        </Field>
        <Field id="au-action" label="Action">
          <input
            id="au-action"
            className="input"
            placeholder="gov.member_add"
            value={f.action}
            onChange={set("action")}
          />
        </Field>
        <Field id="au-from" label="From">
          <input id="au-from" className="input" type="date" value={f.from} onChange={set("from")} />
        </Field>
        <Field id="au-to" label="To">
          <input id="au-to" className="input" type="date" value={f.to} onChange={set("to")} />
        </Field>
        <button type="submit" className="btn primary">
          Apply filters
        </button>
      </form>
      <Await state={rows} skeleton={2}>
        {(d) =>
          d.length === 0 ? (
            <p className="muted">No receipts match.</p>
          ) : (
            <div className="tablewrap">
              <table className="t">
                <caption className="sr-only">Audit receipts</caption>
                <thead>
                  <tr>
                    <th scope="col">Receipt</th>
                    <th scope="col">When</th>
                    <th scope="col">Actor</th>
                    <th scope="col">Action</th>
                    <th scope="col">Scope</th>
                    <th scope="col">Result</th>
                    <th scope="col">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {d.map((r) => (
                    <tr key={r.id}>
                      <td className="num">{r.id}</td>
                      <td>{fmtDate(r.at)}</td>
                      <td>{whoIs(r.actor)}</td>
                      <td>{r.action}</td>
                      <td>{r.scope}</td>
                      <td>
                        <Chip tone={r.result === "allow" ? "done" : "risk"}>{r.result}</Chip>
                      </td>
                      <td>{r.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Await>
    </section>
  );
}
