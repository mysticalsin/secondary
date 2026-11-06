import { useState } from "react";
import { ApiError } from "../../api";
import { Modal } from "../../components/Modal";
import { type Key, useI18n } from "../../i18n";
import { useApp } from "../../state";
import { gapsApi } from "./api";
import { DISMISS_REASONS, type DismissReason, type Gap } from "./types";

interface Common {
  brain: string;
  gap: Gap;
  onClose: () => void;
  onDone: () => void;
}

/** Runs one action, shows its refusal in plain words, says what happened and refreshes. */
function useRun(done: Key, onDone: () => void, onClose: () => void) {
  const { t } = useI18n();
  const { say } = useApp();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (f: () => Promise<unknown>, explain?: (e: ApiError) => string | null) => {
    setBusy(true);
    setErr(null);
    try {
      await f();
      say(t(done));
      onDone();
      onClose();
    } catch (e) {
      const known = e instanceof ApiError ? explain?.(e) : null;
      setErr(known ?? (e instanceof ApiError ? e.reason : t("common.failed")));
    } finally {
      setBusy(false);
    }
  };
  return { busy, err, run };
}

const Err = ({ msg }: { msg: string | null }) =>
  msg ? (
    <div className="errorbox" role="alert">
      {msg}
    </div>
  ) : null;

const Foot = ({
  onClose,
  go,
  label,
  busy,
  disabled,
  danger,
}: {
  onClose: () => void;
  go: () => void;
  label: string;
  busy: boolean;
  disabled?: boolean;
  danger?: boolean;
}) => {
  const { t } = useI18n();
  return (
    <>
      <button type="button" className="btn" onClick={onClose}>
        {t("common.cancel")}
      </button>
      <button
        type="button"
        className={`btn ${danger ? "danger" : "primary"}`}
        disabled={busy || disabled}
        onClick={go}
      >
        {busy ? t("common.working") : label}
      </button>
    </>
  );
};

export function StartDialog({ brain, gap, onClose, onDone }: Common) {
  const { t } = useI18n();
  const [title, setTitle] = useState(() => {
    const s = gap.text.replace(/[?!.\s]+$/, "");
    return s.charAt(0).toUpperCase() + s.slice(1);
  });
  const { busy, err, run } = useRun("v8g.start.done", onDone, onClose);
  const go = () =>
    run(
      () => gapsApi.start(brain, gap.id, title.trim()),
      (e) => {
        const code = String(e.body.error ?? "");
        if (code === "already_started") return t("v8g.start.already");
        if (code === "page_exists") return t("v8g.start.exists");
        if (code === "invalid_title") return t("v8g.start.badtitle");
        return null;
      },
    );
  return (
    <Modal
      title={t("v8g.start.title")}
      onClose={onClose}
      foot={
        <Foot
          onClose={onClose}
          go={go}
          label={t("v8g.start.go")}
          busy={busy}
          disabled={!title.trim()}
        />
      }
    >
      <p className="muted">{t("v8g.start.lead")}</p>
      <Err msg={err} />
      <div className="field">
        <label htmlFor="gp-title">{t("v8g.start.name")}</label>
        <input
          id="gp-title"
          className="input"
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
    </Modal>
  );
}

const today = () => new Date().toISOString().slice(0, 10);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

export function AssignDialog({
  brain,
  gap,
  eligible,
  onClose,
  onDone,
}: Common & { eligible: { id: string; name: string }[] }) {
  const { t } = useI18n();
  const [to, setTo] = useState("");
  const [due, setDue] = useState(inDays(7));
  const { busy, err, run } = useRun("v8g.assign.done", onDone, onClose);
  const badDue = due < today() || due > inDays(180);
  const go = () =>
    run(
      () => gapsApi.assign(brain, gap.id, to, due),
      (e) => (e.status === 400 && e.reason.includes("due") ? t("v8g.assign.baddue") : null),
    );
  return (
    <Modal
      title={t("v8g.assign.title")}
      onClose={onClose}
      foot={
        <Foot
          onClose={onClose}
          go={go}
          label={t("v8g.assign.go")}
          busy={busy}
          disabled={!to || badDue}
        />
      }
    >
      <p className="muted">{t("v8g.assign.lead")}</p>
      <Err msg={err} />
      {eligible.length ? (
        <>
          <div className="field">
            <label htmlFor="gp-to">{t("v8g.assign.to")}</label>
            <select
              id="gp-to"
              className="select"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            >
              <option value="">{t("v8g.assign.pick")}</option>
              {eligible.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="gp-due">{t("v8g.assign.due")}</label>
            <input
              id="gp-due"
              className="input"
              type="date"
              min={today()}
              max={inDays(180)}
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
            {badDue ? <span className="muted">{t("v8g.assign.baddue")}</span> : null}
          </div>
        </>
      ) : (
        <p>{t("v8g.assign.none")}</p>
      )}
    </Modal>
  );
}

export function MergeDialog({ brain, gap, others, onClose, onDone }: Common & { others: Gap[] }) {
  const { t } = useI18n();
  const [into, setInto] = useState("");
  const { busy, err, run } = useRun("v8g.merge.done", onDone, onClose);
  return (
    <Modal
      title={t("v8g.merge.title")}
      onClose={onClose}
      foot={
        <Foot
          onClose={onClose}
          go={() => run(() => gapsApi.merge(brain, gap.id, into))}
          label={t("v8g.merge.go")}
          busy={busy}
          disabled={!into}
        />
      }
    >
      <p className="muted">{t("v8g.merge.lead")}</p>
      <p>
        <b>{gap.text}</b>
      </p>
      <Err msg={err} />
      {others.length ? (
        <div className="field">
          <label htmlFor="gp-into">{t("v8g.merge.into")}</label>
          <select
            id="gp-into"
            className="select"
            value={into}
            onChange={(e) => setInto(e.target.value)}
          >
            <option value="">{t("v8g.merge.pick")}</option>
            {others.map((g) => (
              <option key={g.id} value={g.id}>
                {g.text}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <p>{t("v8g.merge.none")}</p>
      )}
    </Modal>
  );
}

export function DismissDialog({ brain, gap, onClose, onDone }: Common) {
  const { t } = useI18n();
  const [reason, setReason] = useState<DismissReason>("not_relevant");
  const [note, setNote] = useState("");
  const { busy, err, run } = useRun("v8g.dismiss.done", onDone, onClose);
  const go = () =>
    run(
      () => gapsApi.dismiss(brain, gap.id, reason, note.trim() || undefined),
      (e) => (String(e.body.error) === "personal_data_in_note" ? t("v8g.dismiss.pd") : null),
    );
  return (
    <Modal
      title={t("v8g.dismiss.title")}
      onClose={onClose}
      foot={<Foot onClose={onClose} go={go} label={t("v8g.dismiss.go")} busy={busy} danger />}
    >
      <p className="muted">{t("v8g.dismiss.lead")}</p>
      <p>
        <b>{gap.text}</b>
      </p>
      <Err msg={err} />
      <div className="field">
        <label htmlFor="gp-reason">{t("v8g.dismiss.reason")}</label>
        <select
          id="gp-reason"
          className="select"
          value={reason}
          onChange={(e) => setReason(e.target.value as DismissReason)}
        >
          {DISMISS_REASONS.map((r) => (
            <option key={r} value={r}>
              {t(`v8g.reason.${r}` as Key)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="gp-note">{t("v8g.dismiss.note")}</label>
        <textarea
          id="gp-note"
          className="textarea"
          style={{ minHeight: 72 }}
          maxLength={200}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
    </Modal>
  );
}
