import { Plus } from "lucide-react";
import { useState } from "react";
import { ApiError } from "../../api";
import { Await, Empty, PageHead } from "../../components/ui";
import { type Key, useI18n } from "../../i18n";
import { useApp } from "../../state";
import { useApi } from "../../useApi";
import { v3 } from "./api";
import "./brains.css";
import type { Cohort } from "./types";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function Editor({
  cohort,
  flagKeys,
  onDone,
  onCancel,
}: {
  cohort: Cohort | null;
  flagKeys: string[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const { say } = useApp();
  const [name, setName] = useState(cohort?.name ?? "");
  const [members, setMembers] = useState((cohort?.members ?? []).join("\n"));
  const [flags, setFlags] = useState<Record<string, boolean>>(cohort?.flags ?? {});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = members
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const bad = list.filter((m) => !EMAIL.test(m));
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await v3.savePilot({ name: name.trim(), members: list, flags }, cohort?.id);
      say(t("b3.pilot.saved"));
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.reason : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="wizard wide" aria-labelledby="pe-h">
      <h3 id="pe-h">{cohort ? t("b3.pilot.edit") : t("b3.pilot.new")}</h3>
      {err ? (
        <div className="errorbox" role="alert">
          {err}
        </div>
      ) : null}
      <div className="field">
        <label htmlFor="pc-name">{t("b3.pilot.name")}</label>
        <input
          id="pc-name"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="pc-members">{t("b3.pilot.members")}</label>
        <textarea
          id="pc-members"
          className="textarea"
          rows={5}
          value={members}
          aria-describedby="pc-members-h"
          onChange={(e) => setMembers(e.target.value)}
        />
        <span id="pc-members-h" className="muted">
          {t("b3.pilot.members.h", { n: list.length })}
        </span>
        {bad.length ? (
          <span className="field-err" role="alert">
            {t("b3.pilot.bad", { list: bad.join(", ") })}
          </span>
        ) : null}
      </div>
      <fieldset className="choices">
        <legend>{t("b3.pilot.flags")}</legend>
        {flagKeys.map((k) => (
          <label key={k} className="choice" htmlFor={`fl-${k}`}>
            <input
              id={`fl-${k}`}
              type="checkbox"
              checked={!!flags[k]}
              onChange={(e) => setFlags((f) => ({ ...f, [k]: e.target.checked }))}
            />
            <span>
              <b className="mono">{k}</b>
              <span className="muted">{t(`b3.pilot.f.${k}` as Key)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="row wiz-nav">
        <button type="button" className="btn ghost" onClick={onCancel}>
          {t("common.cancel")}
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={busy || !name.trim() || bad.length > 0}
          onClick={save}
        >
          {busy ? t("common.working") : t("common.save")}
        </button>
      </div>
    </section>
  );
}

export function PilotPage() {
  const { t, tn } = useI18n();
  const { say } = useApp();
  const pilot = useApi(() => v3.pilot(), []);
  const [editing, setEditing] = useState<Cohort | "new" | null>(null);
  const [del, setDel] = useState<string | null>(null);
  const remove = async (id: string) => {
    try {
      await v3.deletePilot(id);
      say(t("b3.pilot.deleted"));
      setDel(null);
      pilot.reload();
    } catch (e) {
      say(e instanceof ApiError ? e.reason : t("common.failed"));
    }
  };
  return (
    <div className="page brains">
      <PageHead eyebrow={t("nav.pilot")} title={t("b3.pilot.title")} lead={t("b3.pilot.lead")} />
      <Await state={pilot} skeleton={2}>
        {(d) =>
          editing ? (
            <Editor
              cohort={editing === "new" ? null : editing}
              flagKeys={d.flagKeys}
              onDone={() => {
                setEditing(null);
                pilot.reload();
              }}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <div className="stack">
              <div>
                <button type="button" className="btn primary" onClick={() => setEditing("new")}>
                  <Plus size={16} aria-hidden /> {t("b3.pilot.new")}
                </button>
              </div>
              {d.cohorts.length ? (
                <ul className="rt-list">
                  {d.cohorts.map((c) => (
                    <li key={c.id} className="rt-card">
                      <div className="rt-top">
                        <div>
                          <h3>{c.name}</h3>
                          <p className="muted">
                            {tn(c.members.length, "b3.pilot.n.one", "b3.pilot.n.other")}
                          </p>
                        </div>
                        <p className="scopes">
                          {d.flagKeys
                            .filter((k) => c.flags[k])
                            .map((k) => (
                              <span key={k} className="chip t-done mono">
                                {k}
                              </span>
                            ))}
                        </p>
                      </div>
                      <div className="row">
                        <button type="button" className="btn sm" onClick={() => setEditing(c)}>
                          {t("common.edit")}
                          <span className="sr-only"> {c.name}</span>
                        </button>
                        {del === c.id ? (
                          <>
                            <button
                              type="button"
                              className="btn sm danger"
                              onClick={() => remove(c.id)}
                            >
                              {t("b3.pilot.delete.yes")}
                            </button>
                            <button
                              type="button"
                              className="btn sm ghost"
                              onClick={() => setDel(null)}
                            >
                              {t("common.cancel")}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="btn sm ghost"
                            onClick={() => setDel(c.id)}
                          >
                            {t("b3.pilot.delete")}
                            <span className="sr-only"> {c.name}</span>
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty title={t("b3.pilot.empty")}>{t("b3.pilot.empty.lead")}</Empty>
              )}
            </div>
          )
        }
      </Await>
    </div>
  );
}
