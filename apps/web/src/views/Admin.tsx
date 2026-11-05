import { Fragment } from "react";
import { api } from "../api";
import { Await, Chip, Eyebrow, fmtDate, PageHead } from "../components/ui";
import { whoIs } from "../personas";
import { useApp } from "../state";
import { STRUCTURE_ONLY_ROLES } from "../types";
import { useApi } from "../useApi";

const cond = (c: Record<string, unknown>) =>
  Object.keys(c).length === 0
    ? "None"
    : Object.entries(c)
        .map(([k, v]) => `${k.replace(/_/g, " ")}: ${String(v)}`)
        .join(", ");

export function Admin() {
  const { me } = useApp();
  const roles = useApi(() => api.adminRoles(), []);
  const structureOnly = !!me?.principal.roleIds.some((r) => STRUCTURE_ONLY_ROLES.includes(r));
  const audit = useApi(() => api.adminAudit(), []);
  return (
    <div className="page stack" style={{ gap: 24 }}>
      <PageHead
        eyebrow="Admin"
        title={
          <>
            Who can do <em>what.</em>
          </>
        }
        lead="Roles are data: scope, actions and conditions. Changes go through policy, not through this page."
      />
      <Await state={roles} skeleton={3}>
        {(d) => (
          <>
            {structureOnly ? (
              <div className="callout attention" role="note">
                <div>
                  <strong>Structure only.</strong> The platform admin sees roles, scopes and
                  receipts. Content and counts stay hidden.
                </div>
              </div>
            ) : null}
            <section aria-labelledby="roles-h">
              <h3 id="roles-h" style={{ marginBottom: 12 }}>
                Roles and grants
              </h3>
              <div className="tablewrap">
                <table className="t">
                  <caption className="sr-only">
                    Grants by role: scope, actions and conditions
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Role</th>
                      <th scope="col">Members</th>
                      <th scope="col">Scope</th>
                      <th scope="col">Actions</th>
                      <th scope="col">Conditions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.map((r) => (
                      <Fragment key={r.id}>
                        {r.grants.map((g, i) => (
                          <tr key={`${r.id}-${g.scope_type}-${g.scope_id}`}>
                            {i === 0 ? (
                              <>
                                <th
                                  scope="row"
                                  rowSpan={r.grants.length}
                                  style={{
                                    background: "transparent",
                                    position: "static",
                                    minWidth: 220,
                                  }}
                                >
                                  <div>{r.label}</div>
                                  <div
                                    className="muted"
                                    style={{ fontWeight: 400, fontSize: 13, marginTop: 4 }}
                                  >
                                    {r.summary}
                                  </div>
                                  <div style={{ marginTop: 6 }}>
                                    {r.exclusions.map((x) => (
                                      <Chip key={x} tone="risk">
                                        no {x.replace(/_/g, " ")}
                                      </Chip>
                                    ))}
                                  </div>
                                </th>
                                <td rowSpan={r.grants.length} className="num">
                                  {r.members}
                                </td>
                              </>
                            ) : null}
                            <td>
                              {g.scope_type} {g.scope_id === "*" ? "(all)" : g.scope_id}
                            </td>
                            <td>{g.actions.map((a) => a.replace(/_/g, " ")).join(", ")}</td>
                            <td>{cond(g.conditions)}</td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </Await>
      <section aria-labelledby="audit-h">
        <h3 id="audit-h" style={{ marginBottom: 4 }}>
          Audit receipts
        </h3>
        <Eyebrow>Who, what, where, result. No content.</Eyebrow>
        <div style={{ marginTop: 12 }}>
          <Await state={audit} skeleton={2}>
            {(d) => (
              <div className="tablewrap">
                <table className="t">
                  <caption className="sr-only">Recent audit receipts</caption>
                  <thead>
                    <tr>
                      <th scope="col">Receipt</th>
                      <th scope="col">When</th>
                      <th scope="col">Actor</th>
                      <th scope="col">Action</th>
                      <th scope="col">Scope</th>
                      <th scope="col">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.map((r) => (
                      <tr key={r.id}>
                        <td className="num">{r.id}</td>
                        <td>{fmtDate(r.at)}</td>
                        <td>{whoIs(r.actor)}</td>
                        <td>{r.action.replace(/_/g, " ")}</td>
                        <td>{r.scope}</td>
                        <td>
                          <Chip tone={r.result === "allow" ? "done" : "risk"}>{r.result}</Chip>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Await>
        </div>
      </section>
    </div>
  );
}
