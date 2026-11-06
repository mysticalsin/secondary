import { useState } from "react";
import { ApiError } from "../../api";
import { Modal } from "../../components/Modal";
import { useI18n } from "../../i18n";
import { deskApi } from "./api";
import type { Person } from "./types";

const DAY = 86_400_000;
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Local 09:00 on a calendar day, as an instant. */
export const morning = (date: string): string => new Date(`${date}T09:00:00`).toISOString();

export const isWarning = (e: unknown): string[] | null =>
  e instanceof ApiError && e.body.error === "personal_data_warning" && Array.isArray(e.body.kinds)
    ? (e.body.kinds as string[])
    : null;

/** Which kinds of personal data a warning found, in words. */
export function useKinds(): (kinds: string[]) => string {
  const { t } = useI18n();
  return (k) => k.map((x) => t(`v8r.pd.${x}` as never)).join(", ");
}

export function SnoozeDialog({
  id,
  current,
  onClose,
  onDone,
}: {
  id: string;
  current: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const now = new Date();
  const tomorrow = ymd(new Date(now.getTime() + DAY));
  const max = ymd(new Date(now.getTime() + 59 * DAY));
  const monday = new Date(now);
  monday.setDate(now.getDate() + ((8 - now.getDay()) % 7 || 7));
  const [date, setDate] = useState(tomorrow);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (until: string | null) => {
    setBusy(true);
    setErr(null);
    try {
      await deskApi.snooze(id, until);
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.reason : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };
  const presets: [string, string][] = [
    [t("v8r.snooze.tomorrow"), tomorrow],
    [t("v8r.snooze.3d"), ymd(new Date(now.getTime() + 3 * DAY))],
    [t("v8r.snooze.monday"), ymd(monday)],
  ];
  return (
    <Modal
      title={t("v8r.snooze.title")}
      onClose={onClose}
      foot={
        <>
          {current ? (
            <button type="button" className="btn" disabled={busy} onClick={() => run(null)}>
              {t("v8r.snooze.back")}
            </button>
          ) : null}
          <button type="button" className="btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !date}
            onClick={() => run(morning(date))}
          >
            {busy ? t("common.working") : t("v8r.snooze.go")}
          </button>
        </>
      }
    >
      <p className="muted">{t("v8r.snooze.lead")}</p>
      <div className="row rv-presets">
        {presets.map(([label, d]) => (
          <button
            key={d}
            type="button"
            className={`btn sm${date === d ? " primary" : ""}`}
            aria-pressed={date === d}
            onClick={() => setDate(d)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="field">
        <label htmlFor="rv-snooze-date">{t("v8r.snooze.until")}</label>
        <input
          id="rv-snooze-date"
          type="date"
          className="input"
          min={tomorrow}
          max={max}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>
      {err ? (
        <div className="errorbox" role="alert">
          {err}
        </div>
      ) : null}
    </Modal>
  );
}

export function ReassignDialog({
  id,
  people,
  current,
  onClose,
  onDone,
}: {
  id: string;
  people: Person[];
  current: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [to, setTo] = useState(current ?? people[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (target: string | null) => {
    setBusy(true);
    setErr(null);
    try {
      await deskApi.reassign(id, target);
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.reason : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={t("v8r.reassign.title")}
      onClose={onClose}
      foot={
        <>
          {current ? (
            <button type="button" className="btn" disabled={busy} onClick={() => run(null)}>
              {t("v8r.reassign.clear")}
            </button>
          ) : null}
          <button type="button" className="btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !to}
            onClick={() => run(to)}
          >
            {busy ? t("common.working") : t("v8r.reassign.go")}
          </button>
        </>
      }
    >
      {people.length ? (
        <>
          <p className="muted">{t("v8r.reassign.lead")}</p>
          <div className="field">
            <label htmlFor="rv-reassign">{t("v8r.reassign.to")}</label>
            <select
              id="rv-reassign"
              className="select"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            >
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </>
      ) : (
        <p>{t("v8r.reassign.none")}</p>
      )}
      {err ? (
        <div className="errorbox" role="alert">
          {err}
        </div>
      ) : null}
    </Modal>
  );
}

/**
 * A note, with the personal-data confirm step: the first send may answer a warning, and the
 * person either edits the note or confirms.
 */
export function NoteDialog({
  title,
  label,
  go,
  tone,
  required,
  onClose,
  onSend,
}: {
  title: string;
  label: string;
  go: string;
  tone: "danger" | "primary";
  required: boolean;
  onClose: () => void;
  onSend: (note: string, acknowledged: boolean) => Promise<void>;
}) {
  const { t } = useI18n();
  const kinds = useKinds();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [warn, setWarn] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async (ack: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      await onSend(note.trim(), ack);
    } catch (e) {
      const w = isWarning(e);
      if (w) setWarn(w);
      else setErr(e instanceof ApiError ? e.reason : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={title}
      onClose={onClose}
      foot={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          {warn ? (
            <button type="button" className="btn" disabled={busy} onClick={() => run(true)}>
              {t("v8r.pd.confirm")}
            </button>
          ) : null}
          <button
            type="button"
            className={`btn ${tone}`}
            disabled={busy || (required && !note.trim())}
            onClick={() => {
              setWarn(null);
              run(false);
            }}
          >
            {busy ? t("common.working") : go}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="rv-note">{label}</label>
        <textarea
          id="rv-note"
          className="textarea"
          style={{ minHeight: 96 }}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setWarn(null);
          }}
        />
      </div>
      {warn ? (
        <div className="rv-warn" role="alert">
          {t("v8r.pd.warn", { kinds: kinds(warn) })}
        </div>
      ) : null}
      {err ? (
        <div className="errorbox" role="alert">
          {err}
        </div>
      ) : null}
    </Modal>
  );
}

const KEYS: [string, string][] = [
  ["J / K", "v8r.help.move"],
  ["Enter", "v8r.help.open"],
  ["A", "v8r.help.approve"],
  ["R", "v8r.help.request"],
  ["S", "v8r.help.snooze"],
  ["M", "v8r.help.mention"],
  ["?", "v8r.help.help"],
];

export function HelpDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Modal
      title={t("v8r.help.title")}
      onClose={onClose}
      foot={
        <button type="button" className="btn primary" onClick={onClose}>
          {t("common.close")}
        </button>
      }
    >
      <dl className="rv-keys">
        {KEYS.map(([k, label]) => (
          <div key={k}>
            <dt>
              <kbd>{k}</kbd>
            </dt>
            <dd>{t(label as never)}</dd>
          </div>
        ))}
      </dl>
      <p className="muted">{t("v8r.help.note")}</p>
    </Modal>
  );
}
