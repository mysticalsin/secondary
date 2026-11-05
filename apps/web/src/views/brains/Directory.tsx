import { Lock } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../api";
import { Modal } from "../../components/Modal";
import { Await, Empty } from "../../components/ui";
import { useI18n } from "../../i18n";
import { useApp } from "../../state";
import { useApi } from "../../useApi";
import { v3 } from "./api";
import { LastActive, TYPE_KEY } from "./shared";
import type { BrainType, DirectoryEntry } from "./types";

const TYPES: (BrainType | "all")[] = ["all", "personal", "team", "account", "global"];

function RequestAccess({ b, onClose }: { b: DirectoryEntry; onClose: () => void }) {
  const { t } = useI18n();
  const { say } = useApp();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await v3.requestAccess(b.id, reason.trim());
      say(t("v4.req.sent"));
      onClose();
    } catch (x) {
      setErr(x instanceof ApiError ? x.reason : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={t("v4.req.title", { name: b.name })}
      onClose={onClose}
      foot={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            form="req"
            className="btn primary"
            disabled={busy || !reason.trim()}
          >
            {busy ? t("common.sending") : t("v4.req.send")}
          </button>
        </>
      }
    >
      <form id="req" className="field" onSubmit={send}>
        <label htmlFor="req-why">{t("v4.req.why")}</label>
        <textarea
          id="req-why"
          className="textarea"
          style={{ minHeight: 96 }}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {err ? (
          <div className="errorbox" role="alert">
            {err}
          </div>
        ) : null}
      </form>
    </Modal>
  );
}

/** All brains: what the person can open, and what they can see but not open yet. */
export function Directory() {
  const { t, tn } = useI18n();
  const list = useApi(() => v3.directory(), []);
  const [type, setType] = useState<BrainType | "all">("all");
  const [term, setTerm] = useState("");
  const [asking, setAsking] = useState<DirectoryEntry | null>(null);
  return (
    <div className="page v4page narrow">
      <h1 className="ptitle">{t("v4.allbrains")}</h1>
      <p className="muted">{t("v4.all.lead")}</p>
      <div className="filters4 two" role="group" aria-label={t("v4.filters")}>
        <input
          className="input"
          type="search"
          value={term}
          aria-label={t("b3.dir.search")}
          placeholder={t("b3.dir.search.ph")}
          onChange={(e) => setTerm(e.target.value)}
        />
        <select
          className="select"
          aria-label={t("b3.dir.types")}
          value={type}
          onChange={(e) => setType(e.target.value as BrainType | "all")}
        >
          {TYPES.map((x) => (
            <option key={x} value={x}>
              {x === "all" ? t("b3.type.all") : t(TYPE_KEY[x])}
            </option>
          ))}
        </select>
      </div>
      <Await state={list} skeleton={3}>
        {({ brains }) => {
          const shown = brains.filter(
            (b) =>
              (type === "all" || b.type === type) &&
              (!term.trim() || b.name.toLowerCase().includes(term.trim().toLowerCase())),
          );
          return shown.length ? (
            <ul className="dirlist">
              {shown.map((b) => (
                <li key={b.id} className="dirrow">
                  <div>
                    {b.canOpen ? (
                      <Link to={`/brains/${encodeURIComponent(b.id)}`}>
                        {b.id === "me" ? t("v4.personal") : b.name}
                      </Link>
                    ) : (
                      <span className="locked">
                        <Lock size={14} aria-hidden /> {b.name}
                      </span>
                    )}
                    <p className="muted">
                      {t(TYPE_KEY[b.type])}
                      {b.canOpen
                        ? ` · ${tn(b.pages, "b3.pages.one", "b3.pages.other")} · ${tn(b.readers, "v4.readers.one", "v4.readers.other")}`
                        : ` · ${t("v4.all.noaccess")}`}
                      {b.canOpen ? (
                        <>
                          {" · "}
                          <LastActive iso={b.lastActivityAt} />
                        </>
                      ) : null}
                    </p>
                  </div>
                  {!b.canOpen && b.canRequestAccess ? (
                    <button type="button" className="btn soft sm" onClick={() => setAsking(b)}>
                      {t("v4.req.cta")}
                      <span className="sr-only"> {b.name}</span>
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <Empty title={t("b3.dir.empty.title")}>{t("b3.dir.empty.lead")}</Empty>
          );
        }}
      </Await>
      {asking ? <RequestAccess b={asking} onClose={() => setAsking(null)} /> : null}
    </div>
  );
}
