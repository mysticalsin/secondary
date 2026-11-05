// Roles and grants as data. Edits are versioned; a role that grants account or restricted scopes
// needs a second admin to approve (the server decides which edits are sensitive).

import { X } from "lucide-react";
import { useState } from "react";
import { Await, Chip, Empty } from "../../components/ui";
import { whoIs } from "../../personas";
import type { Action } from "../../types";
import { useApi } from "../../useApi";
import { ALL_ACTIONS, adm, type GovRole } from "./api";
import { Changes } from "./Changes";
import { Field, fmtTime, Reason, useAct } from "./shared";

const SCOPE_TYPES = ["global", "department", "circle", "account", "region"] as const;
const BOOLS = [
  ["linked_to_bid", "Only accounts linked to a bid"],
  ["member", "Members only"],
  ["metadata_only", "Metadata only (no content)"],
  ["own_drafts", "Own drafts only"],
  ["self_approval", "Self-approval allowed"],
  ["assigned_queue", "Assigned queue only"],
  ["not_contributor", "Never the contributor"],
] as const;
const ELEVATABLE: Action[] = ["comment", "contribute", "edit", "review"];

interface Draft {
  scope_type: string;
  scope_id: string;
  actions: Action[];
  flags: string[];
  nda: boolean;
}

const toDraft = (g: GovRole["grants"][number]): Draft => ({
  scope_type: g.scope_type,
  scope_id: g.scope_id,
  actions: [...g.actions],
  flags: Object.entries(g.conditions)
    .filter(([k, v]) => v === true && k !== "nda")
    .map(([k]) => k),
  nda: g.conditions.nda === "named_grant",
});

const fromDraft = (d: Draft) => ({
  scope_type: d.scope_type,
  scope_id: d.scope_id.trim(),
  actions: d.actions,
  conditions: {
    ...(d.nda ? { nda: "named_grant" } : {}),
    ...Object.fromEntries(d.flags.map((f) => [f, true])),
  },
});

const toggle = <T,>(list: T[], v: T): T[] =>
  list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

function RoleEditor({
  role,
  onClose,
  onSaved,
}: {
  role: GovRole | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { busy, error, run } = useAct();
  const [id, setId] = useState("");
  const [label, setLabel] = useState(role?.label ?? "");
  const [summary, setSummary] = useState(role?.summary ?? "");
  const [grants, setGrants] = useState<Draft[]>(role ? role.grants.map(toDraft) : []);
  const [hours, setHours] = useState(role?.elevation ? String(role.elevation.hours) : "");
  const [elActions, setElActions] = useState<Action[]>(
    (role?.elevation?.actions as Action[]) ?? [],
  );
  const [approval, setApproval] = useState(!!role?.elevation?.approval);

  const patch = (i: number, p: Partial<Draft>) =>
    setGrants((g) => g.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const save = async () => {
    const body: Record<string, unknown> = {
      label,
      summary,
      grants: grants.map(fromDraft),
      elevation: hours
        ? { actions: elActions, hours: Number(hours), ...(approval ? { approval: true } : {}) }
        : null,
      ...(role ? { baseVersion: role.version } : { id }),
    };
    const r = await run(
      () => adm.saveRole(role?.id ?? null, body),
      (x) => (x.applied ? "Role saved." : "Saved as a proposal. A second admin must approve it."),
    );
    if (r) {
      onSaved();
      onClose();
    }
  };

  return (
    <div className="overlay center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="sheet"
        style={{ width: "min(860px, 100%)" }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="role-ed-h"
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <div className="sheet-head">
          <h3 id="role-ed-h">{role ? `Edit ${role.label}` : "New role"}</h3>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className="sheet-body">
          {role?.sensitive ? (
            <div className="callout attention" role="note">
              This role grants account or restricted scopes. Your edit waits for a second admin.
            </div>
          ) : null}
          {!role ? (
            <Field
              id="role-id"
              label="Role id"
              hint="3 to 32 lowercase letters, digits or underscores."
            >
              <input
                id="role-id"
                className="input"
                value={id}
                onChange={(e) => setId(e.target.value)}
              />
            </Field>
          ) : null}
          <Field id="role-label" label="Label">
            <input
              id="role-label"
              className="input"
              value={label}
              maxLength={60}
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
          <Field id="role-summary" label="Summary">
            <input
              id="role-summary"
              className="input"
              value={summary}
              maxLength={300}
              onChange={(e) => setSummary(e.target.value)}
            />
          </Field>

          <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="eyebrow">Grants</legend>
            {grants.map((g, i) => (
              // The list is edited in place, so the position is the identity.
              <div className="card" key={i}>
                <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                  <Field id={`g-type-${i}`} label="Scope type">
                    <select
                      id={`g-type-${i}`}
                      className="select"
                      value={g.scope_type}
                      onChange={(e) =>
                        patch(i, {
                          scope_type: e.target.value,
                          scope_id: e.target.value === "global" ? "core" : g.scope_id,
                        })
                      }
                    >
                      {SCOPE_TYPES.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </Field>
                  <Field id={`g-id-${i}`} label="Scope id" hint="An id, or * for all of that type">
                    <input
                      id={`g-id-${i}`}
                      className="input"
                      value={g.scope_id}
                      onChange={(e) => patch(i, { scope_id: e.target.value })}
                    />
                  </Field>
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={() => setGrants((x) => x.filter((_, j) => j !== i))}
                  >
                    Remove grant
                  </button>
                </div>
                <div
                  className="pills"
                  role="group"
                  aria-label={`Actions for grant ${i + 1}`}
                  style={{ marginTop: 8 }}
                >
                  {ALL_ACTIONS.map((a) => (
                    <button
                      key={a}
                      type="button"
                      className="pill"
                      aria-pressed={g.actions.includes(a)}
                      onClick={() => patch(i, { actions: toggle(g.actions, a) })}
                    >
                      {a.replace(/_/g, " ")}
                    </button>
                  ))}
                </div>
                <div
                  className="pills"
                  role="group"
                  aria-label={`Conditions for grant ${i + 1}`}
                  style={{ marginTop: 8 }}
                >
                  <button
                    type="button"
                    className="pill"
                    aria-pressed={g.nda}
                    onClick={() => patch(i, { nda: !g.nda })}
                  >
                    NDA needs a named grant
                  </button>
                  {BOOLS.map(([k, text]) => (
                    <button
                      key={k}
                      type="button"
                      className="pill"
                      aria-pressed={g.flags.includes(k)}
                      onClick={() => patch(i, { flags: toggle(g.flags, k) })}
                    >
                      {text}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div>
              <button
                type="button"
                className="btn sm"
                onClick={() =>
                  setGrants((x) => [
                    ...x,
                    {
                      scope_type: "circle",
                      scope_id: "",
                      actions: ["view_structure"],
                      flags: [],
                      nda: false,
                    },
                  ])
                }
              >
                Add grant
              </button>
            </div>
          </fieldset>

          <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="eyebrow">Elevation (optional)</legend>
            <Field id="el-hours" label="Longest window, in hours (1 to 24). Empty means none">
              <input
                id="el-hours"
                className="input"
                inputMode="numeric"
                value={hours}
                onChange={(e) => setHours(e.target.value.replace(/\D/g, ""))}
              />
            </Field>
            <div className="pills" role="group" aria-label="Actions elevation may unlock">
              {ELEVATABLE.map((a) => (
                <button
                  key={a}
                  type="button"
                  className="pill"
                  aria-pressed={elActions.includes(a)}
                  onClick={() => setElActions(toggle(elActions, a))}
                >
                  {a}
                </button>
              ))}
            </div>
            <label className="check" htmlFor="el-approval">
              <input
                id="el-approval"
                type="checkbox"
                checked={approval}
                onChange={(e) => setApproval(e.target.checked)}
              />
              <span>A second admin must approve each elevation request for this role.</span>
            </label>
          </fieldset>
          <Reason message={error} />
        </div>
        <div className="sheet-foot">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !label.trim() || (!role && !id.trim())}
            onClick={save}
          >
            {busy ? "Saving" : "Save role"}
          </button>
        </div>
      </div>
    </div>
  );
}

function History({ id }: { id: string }) {
  const h = useApi(() => adm.roleHistory(id), [id]);
  return (
    <Await state={h} skeleton={1}>
      {(rows) => (
        <ol className="stack" style={{ margin: 0, paddingLeft: 18 }}>
          {rows.map((v) => (
            <li key={v.version}>
              <strong>Version {v.version}</strong> · {fmtTime(v.at)} · proposed by{" "}
              {v.proposedBy === "system" ? "the seed" : whoIs(v.proposedBy)}
              {v.approvedBy ? `, approved by ${whoIs(v.approvedBy)}` : ""}
            </li>
          ))}
        </ol>
      )}
    </Await>
  );
}

export function RolesTab() {
  const roles = useApi(() => adm.roles(), []);
  const [editing, setEditing] = useState<GovRole | "new" | null>(null);
  const [history, setHistory] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = () => {
    roles.reload();
    setTick((t) => t + 1);
  };

  return (
    <div className="stack" style={{ gap: 24 }}>
      <section aria-labelledby="roles-h">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <h3 id="roles-h">Roles and grants</h3>
          <button type="button" className="btn primary sm" onClick={() => setEditing("new")}>
            New role
          </button>
        </div>
        <Await state={roles} skeleton={3}>
          {(d) =>
            d.length === 0 ? (
              <Empty title="No roles" />
            ) : (
              <div className="tablewrap">
                <table className="t">
                  <caption className="sr-only">Roles with version, members and grants</caption>
                  <thead>
                    <tr>
                      <th scope="col">Role</th>
                      <th scope="col">Members</th>
                      <th scope="col">Grants</th>
                      <th scope="col">Elevation</th>
                      <th scope="col">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.map((r) => (
                      <tr key={r.id}>
                        <th
                          scope="row"
                          style={{ background: "transparent", position: "static", minWidth: 200 }}
                        >
                          <div>{r.label}</div>
                          <div className="muted" style={{ fontWeight: 400, fontSize: 13 }}>
                            v{r.version}
                            {r.sensitive ? " · two-person edits" : ""}
                          </div>
                        </th>
                        <td className="num">{r.members}</td>
                        <td>
                          <ul style={{ margin: 0, paddingLeft: 16 }}>
                            {r.grants.map((g) => (
                              <li
                                key={`${g.scope_type}-${g.scope_id}-${JSON.stringify(g.conditions)}`}
                              >
                                {g.scope_type} {g.scope_id === "*" ? "(all)" : g.scope_id}:{" "}
                                {g.actions.map((a) => a.replace(/_/g, " ")).join(", ")}
                                {Object.keys(g.conditions).length ? (
                                  <span className="muted">
                                    {" "}
                                    [
                                    {Object.entries(g.conditions)
                                      .map(([k, v]) => (v === true ? k : `${k}=${String(v)}`))
                                      .join(", ")}
                                    ]
                                  </span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </td>
                        <td>
                          {r.elevation ? (
                            <>
                              {r.elevation.hours} h
                              {r.elevation.approval ? <Chip tone="attn">approval</Chip> : null}
                            </>
                          ) : (
                            <span className="muted">none</span>
                          )}
                        </td>
                        <td>
                          <div className="row" style={{ gap: 6 }}>
                            <button
                              type="button"
                              className="btn sm"
                              aria-label={`Edit ${r.label}`}
                              onClick={() => setEditing(r)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn ghost sm"
                              aria-expanded={history === r.id}
                              aria-label={`History of ${r.label}`}
                              onClick={() => setHistory(history === r.id ? null : r.id)}
                            >
                              History
                            </button>
                          </div>
                          {history === r.id ? <History id={r.id} /> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </Await>
      </section>
      <Changes
        kinds={["role_upsert"]}
        title="Role changes"
        refreshKey={tick}
        onChanged={roles.reload}
      />
      {editing ? (
        <RoleEditor
          role={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      ) : null}
    </div>
  );
}
