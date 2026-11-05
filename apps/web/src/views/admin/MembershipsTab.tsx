// Members of circles, departments, accounts and the Contacts subspace. A steward manages their own
// scope only. A restricted scope needs a second person: the steward proposes, someone else approves.

import { useState } from "react";
import { Await, Chip, Empty } from "../../components/ui";
import { useApi } from "../../useApi";
import { adm, type ScopeOption } from "./api";
import { Changes } from "./Changes";
import { Field, Reason, useAct } from "./shared";

export function MembershipsTab() {
  const scopes = useApi(() => adm.scopes(), []);
  const people = useApi(() => adm.principals(), []);
  const [key, setKey] = useState("");
  const [person, setPerson] = useState("");
  const [tick, setTick] = useState(0);
  const { busy, error, run } = useAct();
  const scope = scopes.data?.find((s) => s.key === key) ?? null;
  const members = useApi(
    () => (scope ? adm.members(scope.type, scope.id, scope.subspace) : Promise.resolve(null)),
    [key, tick],
  );

  const change = async (op: "add" | "remove", principalId: string, s: ScopeOption) => {
    const r = await run(
      () =>
        adm.member({
          op,
          principalId,
          scope_type: s.type,
          scope_id: s.id,
          subspace: s.subspace,
        }),
      (x) => (x.applied ? "Membership updated." : "Proposed. A second person must approve."),
    );
    if (r) {
      setPerson("");
      setTick((t) => t + 1);
    }
  };

  return (
    <div className="stack" style={{ gap: 24 }}>
      <section aria-labelledby="mem-h">
        <h3 id="mem-h" style={{ marginBottom: 8 }}>
          Members
        </h3>
        <Await state={scopes} skeleton={1}>
          {(list) =>
            list.length === 0 ? (
              <Empty title="No scope to manage">
                Membership is managed by the steward of a space or by a platform admin.
              </Empty>
            ) : (
              <div className="stack">
                <Field id="mem-scope" label="Space">
                  <select
                    id="mem-scope"
                    className="select"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                  >
                    <option value="">Choose a space</option>
                    {list.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.type}: {s.label}
                        {s.restricted ? " (restricted)" : ""}
                      </option>
                    ))}
                  </select>
                </Field>
                {scope?.restricted ? (
                  <div className="callout attention" role="note">
                    Restricted space. Every change waits for a second person to approve it.
                  </div>
                ) : null}
                {scope ? (
                  <Await state={members} skeleton={2}>
                    {(m) =>
                      m ? (
                        <>
                          {m.members.length === 0 ? (
                            <p className="muted">No stored members yet.</p>
                          ) : (
                            <ul
                              className="stack"
                              style={{ listStyle: "none", margin: 0, padding: 0 }}
                            >
                              {m.members.map((x) => (
                                <li
                                  className="card row"
                                  key={x.principalId}
                                  style={{ justifyContent: "space-between" }}
                                >
                                  <span>{x.email}</span>
                                  <button
                                    type="button"
                                    className="btn sm"
                                    disabled={busy}
                                    aria-label={`Remove ${x.email}`}
                                    onClick={() => change("remove", x.principalId, scope)}
                                  >
                                    Remove
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                          <form
                            className="ask"
                            onSubmit={(e) => {
                              e.preventDefault();
                              if (person) change("add", person, scope);
                            }}
                          >
                            <label className="sr-only" htmlFor="mem-person">
                              Person to add
                            </label>
                            <select
                              id="mem-person"
                              className="select"
                              value={person}
                              onChange={(e) => setPerson(e.target.value)}
                            >
                              <option value="">Choose a person</option>
                              {(people.data ?? [])
                                .filter((p) => !m.members.some((x) => x.principalId === p.id))
                                .map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.email}
                                  </option>
                                ))}
                            </select>
                            <button
                              type="submit"
                              className="btn primary"
                              disabled={busy || !person}
                            >
                              {scope.restricted ? "Propose adding" : "Add member"}
                            </button>
                            {scope.restricted ? <Chip tone="attn">two-person</Chip> : null}
                          </form>
                        </>
                      ) : null
                    }
                  </Await>
                ) : null}
                <Reason message={error} />
              </div>
            )
          }
        </Await>
      </section>
      <Changes
        kinds={["member_add", "member_remove"]}
        title="Membership changes"
        refreshKey={tick}
        onChanged={() => setTick((t) => t + 1)}
      />
    </div>
  );
}
