// Roles and grants as data. Edits are versioned; a role that grants account or restricted scopes
// needs a second admin to approve (the server decides which edits are sensitive).

import { X } from "lucide-react";
import { useState } from "react";
import { Await, Chip, Empty, TableWrap } from "../../components/ui";
import { type Key, useI18n } from "../../i18n";
import { whoIs } from "../../personas";
import type { Action } from "../../types";
import { useApi } from "../../useApi";
import { ALL_ACTIONS, adm, type GovRole } from "./api";
import { Changes } from "./Changes";
import { Field, fmtTime, Reason, useAct } from "./shared";

const SCOPE_TYPES = ["global", "department", "circle", "account", "region"] as const;
const BOOLS = [
  "linked_to_bid",
  "member",
  "membership",
  "metadata_only",
  "own_drafts",
  "self_approval",
  "assigned_queue",
  "not_contributor",
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
  const { t, td } = useI18n();
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
      (x) => t(x.applied ? "adm.roles.saved" : "adm.roles.proposed"),
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
          <h3 id="role-ed-h">
            {role ? t("adm.roles.edit.title", { label: role.label }) : t("adm.roles.new")}
          </h3>
          <button
            type="button"
            className="icon-btn"
            aria-label={t("common.close")}
            onClick={onClose}
          >
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className="sheet-body">
          {role?.sensitive ? (
            <div className="callout attention" role="note">
              {t("adm.roles.sensitive")}
            </div>
          ) : null}
          {!role ? (
            <Field id="role-id" label={t("adm.roles.id")} hint={t("adm.roles.id.hint")}>
              <input
                id="role-id"
                className="input"
                value={id}
                onChange={(e) => setId(e.target.value)}
              />
            </Field>
          ) : null}
          <Field id="role-label" label={t("adm.roles.label")}>
            <input
              id="role-label"
              className="input"
              value={label}
              maxLength={60}
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
          <Field id="role-summary" label={t("adm.roles.summary")}>
            <input
              id="role-summary"
              className="input"
              value={summary}
              maxLength={300}
              onChange={(e) => setSummary(e.target.value)}
            />
          </Field>

          <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="eyebrow">{t("adm.roles.grants")}</legend>
            {grants.map((g, i) => (
              // The list is edited in place, so the position is the identity.
              <div className="card" key={i}>
                <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                  <Field id={`g-type-${i}`} label={t("adm.roles.scope_type")}>
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
                      {SCOPE_TYPES.map((s) => (
                        <option key={s} value={s}>
                          {td("adm.scope", s)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    id={`g-id-${i}`}
                    label={t("adm.roles.scope_id")}
                    hint={t("adm.roles.scope_id.hint")}
                  >
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
                    {t("adm.roles.remove_grant")}
                  </button>
                </div>
                <div
                  className="pills"
                  role="group"
                  aria-label={t("adm.roles.grant_actions", { n: i + 1 })}
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
                      {td("adm.act", a, a.replace(/_/g, " "))}
                    </button>
                  ))}
                </div>
                <div
                  className="pills"
                  role="group"
                  aria-label={t("adm.roles.grant_conditions", { n: i + 1 })}
                  style={{ marginTop: 8 }}
                >
                  <button
                    type="button"
                    className="pill"
                    aria-pressed={g.nda}
                    onClick={() => patch(i, { nda: !g.nda })}
                  >
                    {t("adm.roles.cond.nda")}
                  </button>
                  {BOOLS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      className="pill"
                      aria-pressed={g.flags.includes(k)}
                      onClick={() => patch(i, { flags: toggle(g.flags, k) })}
                    >
                      {t(`adm.roles.cond.${k}` satisfies Key)}
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
                {t("adm.roles.add_grant")}
              </button>
            </div>
          </fieldset>

          <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="eyebrow">{t("adm.roles.elev.legend")}</legend>
            <Field id="el-hours" label={t("adm.roles.elev.hours")}>
              <input
                id="el-hours"
                className="input"
                inputMode="numeric"
                value={hours}
                onChange={(e) => setHours(e.target.value.replace(/\D/g, ""))}
              />
            </Field>
            <div className="pills" role="group" aria-label={t("adm.roles.elev.actions")}>
              {ELEVATABLE.map((a) => (
                <button
                  key={a}
                  type="button"
                  className="pill"
                  aria-pressed={elActions.includes(a)}
                  onClick={() => setElActions(toggle(elActions, a))}
                >
                  {td("adm.act", a)}
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
              <span>{t("adm.roles.elev.approval")}</span>
            </label>
          </fieldset>
          <Reason message={error} />
        </div>
        <div className="sheet-foot">
          <button type="button" className="btn ghost" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !label.trim() || (!role && !id.trim())}
            onClick={save}
          >
            {busy ? t("common.saving") : t("adm.roles.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function History({ id }: { id: string }) {
  const { t, td } = useI18n();
  const h = useApi(() => adm.roleHistory(id), [id]);
  return (
    <Await state={h} skeleton={1}>
      {(rows) => (
        <ol className="stack" style={{ margin: 0, paddingLeft: 18 }}>
          {rows.map((v) => (
            <li key={v.version}>
              <strong>{t("adm.hist.version", { n: v.version })}</strong> · {fmtTime(v.at)} ·{" "}
              {t("adm.hist.proposed", {
                who:
                  v.proposedBy === "system"
                    ? t("adm.hist.seed")
                    : whoIs(v.proposedBy, (rid, f) => td("role", rid, f)),
              })}
              {v.approvedBy
                ? `, ${t("adm.hist.approved", { who: whoIs(v.approvedBy, (rid, f) => td("role", rid, f)) })}`
                : ""}
            </li>
          ))}
        </ol>
      )}
    </Await>
  );
}

export function RolesTab() {
  const { t, td } = useI18n();
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
          <h3 id="roles-h">{t("adm.roles.title")}</h3>
          <button type="button" className="btn primary sm" onClick={() => setEditing("new")}>
            {t("adm.roles.new")}
          </button>
        </div>
        <Await state={roles} skeleton={3}>
          {(d) =>
            d.length === 0 ? (
              <Empty title={t("adm.roles.none")} />
            ) : (
              <TableWrap label={t("adm.roles.caption")}>
                <table className="t">
                  <caption className="sr-only">{t("adm.roles.caption")}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t("adm.roles.col.role")}</th>
                      <th scope="col">{t("adm.roles.col.members")}</th>
                      <th scope="col">{t("adm.roles.col.grants")}</th>
                      <th scope="col">{t("adm.roles.col.elevation")}</th>
                      <th scope="col">
                        <span className="sr-only">{t("adm.actions")}</span>
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
                            {r.sensitive ? ` · ${t("adm.roles.twoperson")}` : ""}
                          </div>
                        </th>
                        <td className="num">{r.members}</td>
                        <td>
                          <ul style={{ margin: 0, paddingLeft: 16 }}>
                            {r.grants.map((g) => (
                              <li
                                key={`${g.scope_type}-${g.scope_id}-${JSON.stringify(g.conditions)}`}
                              >
                                {td("adm.scope", g.scope_type)}{" "}
                                {g.scope_id === "*" ? t("adm.roles.all") : g.scope_id}:{" "}
                                {g.actions
                                  .map((a) => td("adm.act", a, a.replace(/_/g, " ")))
                                  .join(", ")}
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
                              {r.elevation.approval ? (
                                <Chip tone="attn">{t("adm.roles.approval")}</Chip>
                              ) : null}
                            </>
                          ) : (
                            <span className="muted">{t("adm.roles.noelev")}</span>
                          )}
                        </td>
                        <td>
                          <div className="row" style={{ gap: 6 }}>
                            <button
                              type="button"
                              className="btn sm"
                              aria-label={t("adm.roles.edit.aria", { label: r.label })}
                              onClick={() => setEditing(r)}
                            >
                              {t("common.edit")}
                            </button>
                            <button
                              type="button"
                              className="btn ghost sm"
                              aria-expanded={history === r.id}
                              aria-label={t("adm.roles.history.aria", { label: r.label })}
                              onClick={() => setHistory(history === r.id ? null : r.id)}
                            >
                              {t("adm.roles.history")}
                            </button>
                          </div>
                          {history === r.id ? <History id={r.id} /> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )
          }
        </Await>
      </section>
      <Changes
        kinds={["role_upsert"]}
        title={t("adm.roles.changes")}
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
