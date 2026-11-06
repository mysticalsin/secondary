import { X } from "lucide-react";
import { useState } from "react";
import { ApiError, request } from "../../api";
import { Await } from "../../components/ui";
import { useI18n } from "../../i18n";
import { useApp } from "../../state";
import { useApi } from "../../useApi";

type Member = { id: string; email: string | null };
type Person = { id: string; email: string };

/** Settings, Privacy group: who may approve a change that a rule sends to "named approver group: privacy". */
export function PrivacyGroup() {
  const { t } = useI18n();
  const { say } = useApp();
  const group = useApi(() => request<{ privacy: Member[] }>("GET", "/v1/rules/groups"), []);
  const people = useApi(() => request<Person[]>("GET", "/v1/admin/principals"), []);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async (ids: string[]) => {
    setBusy(true);
    setErr(null);
    try {
      const out = await request<{ ok?: boolean; pending?: boolean } | null>(
        "PUT",
        "/v1/rules/groups",
        { privacy: ids },
      );
      say(out?.pending ? t("v7g.pending") : t("v7g.saved"));
      setPick("");
      group.reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.reason : t("v7g.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="v7g-h">
      <h2 id="v7g-h" className="sec-title">
        {t("v7g.title")}
      </h2>
      <p className="muted">{t("v7g.lead")}</p>
      {err ? (
        <div className="errorbox" role="alert">
          {err}
        </div>
      ) : null}
      <Await state={group}>
        {(d) => {
          const ids = d.privacy.map((m) => m.id);
          const options = (people.data ?? []).filter((p) => !ids.includes(p.id));
          return (
            <div className="setcard">
              <h3 id="v7g-m">{t("v7g.members")}</h3>
              {d.privacy.length === 0 ? (
                <p className="muted">{t("v7g.none")}</p>
              ) : (
                <ul aria-labelledby="v7g-m" className="v7g-list">
                  {d.privacy.map((m) => (
                    <li key={m.id}>
                      <span>{m.email ?? m.id}</span>
                      {m.email === null ? <span className="muted"> {t("v7g.unknown")}</span> : null}{" "}
                      <button
                        type="button"
                        className="btn sm ghost"
                        disabled={busy}
                        aria-label={t("v7g.remove", { who: m.email ?? m.id })}
                        onClick={() => save(ids.filter((x) => x !== m.id))}
                      >
                        <X size={14} aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="field">
                <label htmlFor="v7g-add">{t("v7g.add")}</label>
                <select
                  id="v7g-add"
                  className="input"
                  value={pick}
                  onChange={(e) => setPick(e.target.value)}
                >
                  <option value="">{t("v7g.add.none")}</option>
                  {options.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.email}
                    </option>
                  ))}
                </select>{" "}
                <button
                  type="button"
                  className="btn sm primary"
                  disabled={busy || !pick}
                  onClick={() => save([...ids, pick])}
                >
                  {t("v7g.add.btn")}
                </button>
              </div>
            </div>
          );
        }}
      </Await>
    </section>
  );
}
