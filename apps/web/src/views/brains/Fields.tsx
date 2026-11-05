import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ApiError } from "../../api";
import { type Key, useI18n } from "../../i18n";
import { useApp } from "../../state";
import { useApi } from "../../useApi";
import { v3 } from "./api";
import { BrainFrame } from "./shared";
import type { FieldDef, FieldType, Sensitivity } from "./types";

const KEY_RE = /^[a-z][a-z0-9_]{0,31}$/;

/** The client-side twin of the server rules, so a mistake shows next to the field. The server still decides. */
export function validate(fields: FieldDef[]): Record<number, Key> {
  const out: Record<number, Key> = {};
  const seen = new Set<string>();
  fields.forEach((f, i) => {
    if (!KEY_RE.test(f.key)) out[i] = "b3.fld.err.key";
    else if (seen.has(f.key)) out[i] = "b3.fld.err.dup";
    else if (f.type === "select" && (!f.options?.length || f.options.length > 20))
      out[i] = "b3.fld.err.options";
    else if (f.retentionDays !== null && (f.retentionDays < 1 || f.retentionDays > 3650))
      out[i] = "b3.fld.err.retention";
    else if (!f.label.trim()) out[i] = "b3.fld.err.label";
    seen.add(f.key);
  });
  return out;
}

function FieldEditor({
  id,
  initial,
  types,
  sensitivities,
  pageTypes,
  canManage,
  shared,
}: {
  id: string;
  initial: FieldDef[];
  types: FieldType[];
  sensitivities: Sensitivity[];
  pageTypes: string[];
  canManage: boolean;
  shared: boolean;
}) {
  const { t } = useI18n();
  const { say } = useApp();
  const [rows, setRows] = useState<FieldDef[]>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setRows(initial), [initial]);
  const bad = validate(rows);
  const patch = (i: number, p: Partial<FieldDef>) =>
    setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await v3.saveFields(
        id,
        rows.map((f) => ({ ...f, ...(f.type === "select" ? {} : { options: undefined }) })),
      );
      say(t("b3.fld.saved"));
    } catch (e) {
      setErr(e instanceof ApiError ? e.reason : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <p className="muted">{t("b3.fld.lead")}</p>
      <ul className="sens-legend row" aria-label={t("b3.fld.legend")}>
        {sensitivities.map((s) => (
          <li key={s} className="chip t-open">
            <b>{t(`b3.fld.s.${s}` as Key)}</b>&nbsp;{t(`b3.fld.s.${s}.d` as Key)}
          </li>
        ))}
      </ul>
      {err ? (
        <div className="errorbox" role="alert">
          {err}
        </div>
      ) : null}
      {rows.length === 0 ? <p className="muted">{t("b3.fld.none")}</p> : null}
      <ul className="fld-list">
        {rows.map((f, i) => {
          const e = bad[i];
          const k = `f${i}`;
          return (
            <li key={`${k}-${f.key}`} className="card fld">
              <div className="fld-grid">
                <div className="field">
                  <label htmlFor={`${k}-label`}>{t("b3.fld.label")}</label>
                  <input
                    id={`${k}-label`}
                    className="input"
                    value={f.label}
                    disabled={!canManage}
                    onChange={(ev) => patch(i, { label: ev.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`${k}-key`}>{t("b3.fld.key")}</label>
                  <input
                    id={`${k}-key`}
                    className="input mono"
                    value={f.key}
                    disabled={!canManage}
                    aria-invalid={e === "b3.fld.err.key" || e === "b3.fld.err.dup"}
                    onChange={(ev) => patch(i, { key: ev.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`${k}-type`}>{t("b3.fld.type")}</label>
                  <select
                    id={`${k}-type`}
                    className="select"
                    value={f.type}
                    disabled={!canManage}
                    onChange={(ev) => patch(i, { type: ev.target.value as FieldType })}
                  >
                    {types.map((x) => (
                      <option key={x} value={x}>
                        {t(`b3.fld.t.${x}` as Key)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={`${k}-sens`}>{t("b3.fld.sens")}</label>
                  <select
                    id={`${k}-sens`}
                    className="select"
                    value={f.sensitivity}
                    disabled={!canManage}
                    onChange={(ev) => patch(i, { sensitivity: ev.target.value as Sensitivity })}
                  >
                    {sensitivities.map((x) => (
                      <option key={x} value={x} disabled={x === "personal" && shared}>
                        {t(`b3.fld.s.${x}` as Key)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={`${k}-ret`}>{t("b3.fld.ret")}</label>
                  <input
                    id={`${k}-ret`}
                    className="input"
                    type="number"
                    min={1}
                    max={3650}
                    value={f.retentionDays ?? ""}
                    placeholder={t("b3.fld.ret.ph")}
                    disabled={!canManage}
                    onChange={(ev) =>
                      patch(i, {
                        retentionDays: ev.target.value === "" ? null : Number(ev.target.value),
                      })
                    }
                  />
                </div>
                {f.type === "select" ? (
                  <div className="field">
                    <label htmlFor={`${k}-opts`}>{t("b3.fld.options")}</label>
                    <input
                      id={`${k}-opts`}
                      className="input"
                      value={(f.options ?? []).join(", ")}
                      disabled={!canManage}
                      onChange={(ev) =>
                        patch(i, {
                          options: ev.target.value
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </div>
                ) : null}
              </div>
              {pageTypes.length ? (
                <fieldset className="applies">
                  <legend>{t("b3.fld.applies")}</legend>
                  {pageTypes.map((pt) => (
                    <label key={pt} className="check">
                      <input
                        type="checkbox"
                        checked={f.appliesTo.includes(pt)}
                        disabled={!canManage}
                        onChange={(ev) =>
                          patch(i, {
                            appliesTo: ev.target.checked
                              ? [...f.appliesTo, pt]
                              : f.appliesTo.filter((x) => x !== pt),
                          })
                        }
                      />
                      {pt}
                    </label>
                  ))}
                  <span className="muted">{f.appliesTo.length ? "" : t("b3.fld.applies.all")}</span>
                </fieldset>
              ) : null}
              {e ? (
                <p className="field-err" role="alert">
                  {t(e)}
                </p>
              ) : null}
              {canManage ? (
                <button
                  type="button"
                  className="btn sm danger"
                  onClick={() => setRows((r) => r.filter((_, j) => j !== i))}
                >
                  <Trash2 size={14} aria-hidden /> {t("b3.fld.remove")}
                  <span className="sr-only"> {f.label}</span>
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {canManage ? (
        <div className="row">
          <button
            type="button"
            className="btn"
            disabled={rows.length >= 30}
            onClick={() =>
              setRows((r) => [
                ...r,
                {
                  key: `field_${r.length + 1}`,
                  label: "",
                  type: "text",
                  sensitivity: "none",
                  retentionDays: null,
                  appliesTo: [],
                },
              ])
            }
          >
            <Plus size={16} aria-hidden /> {t("b3.fld.add")}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || Object.keys(bad).length > 0}
            onClick={save}
          >
            {busy ? t("common.working") : t("b3.fld.save")}
          </button>
        </div>
      ) : (
        <p className="muted">{t("b3.fld.readonly")}</p>
      )}
    </div>
  );
}

export function FieldsPage() {
  const { id = "" } = useParams();
  const fields = useApi(() => v3.fields(id), [id]);
  const { t } = useI18n();
  return (
    <BrainFrame id={id} tab="fields">
      {(b) => (
        <>
          <h3 className="sec-h">{t("b3.fld.title")}</h3>
          {fields.data ? (
            <FieldEditor
              id={id}
              initial={fields.data.fields}
              types={fields.data.types}
              sensitivities={fields.data.sensitivities}
              pageTypes={b.collections.map((c) => c.type)}
              canManage={b.manages}
              shared={b.type !== "personal"}
            />
          ) : fields.error ? (
            <div className="errorbox" role="alert">
              {fields.error}
            </div>
          ) : null}
        </>
      )}
    </BrainFrame>
  );
}
