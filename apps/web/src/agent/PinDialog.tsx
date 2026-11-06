// "Pin this view": a name and a place (My Home, or one brain's My view tab). Only the plan is saved.
import { X } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { ApiError } from "../api";
import { useI18n } from "../i18n";
import { useFocusTrap } from "../lib/focus";
import { useApp } from "../state";
import { useApi } from "../useApi";
import { v3 } from "../views/brains/api";
import { viewsApi } from "./views";

export function PinDialog({
  program,
  defaultName,
  onClose,
}: {
  program: string;
  defaultName: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { say } = useApp();
  const box = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(defaultName.slice(0, 60));
  const [where, setWhere] = useState<"home" | "brain">("home");
  const [brain, setBrain] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const brains = useApi(() => v3.brains(), []);
  useFocusTrap(box, true);
  useEffect(() => nameRef.current?.focus(), []);
  const list = brains.data?.brains ?? [];
  const chosen = brain || list[0]?.id || "";
  const label = (b: { id: string; name: string }) => (b.id === "me" ? t("v4.personal") : b.name);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await viewsApi.create({
        name: name.trim(),
        program,
        pin: where === "home" ? "home" : { brain: chosen },
      });
      const dest =
        where === "home"
          ? t("v6.pin.home")
          : `${label(list.find((b) => b.id === chosen) ?? { id: chosen, name: chosen })} > ${t("v6.tab.myview")}`;
      say(t("v6.pin.done", { where: dest }));
      onClose();
    } catch (x) {
      const code = x instanceof ApiError ? String(x.body.error ?? "") : "";
      setErr(code === "too_many_views" ? t("v6.pin.too_many") : t("v6.pin.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="ag-dialog-back"
      // The dialog owns Escape: the panel behind it must stay open.
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div
        ref={box}
        className="ag-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("v6.pin.title")}
      >
        <header>
          <h2>{t("v6.pin.title")}</h2>
          <button
            type="button"
            className="icon-btn"
            aria-label={t("common.close")}
            onClick={onClose}
          >
            <X size={18} aria-hidden />
          </button>
        </header>
        <form className="stack" onSubmit={submit}>
          <div className="field">
            <label htmlFor="pin-name">{t("v6.pin.name")}</label>
            <input
              id="pin-name"
              ref={nameRef}
              className="input"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <fieldset className="radios">
            <legend>{t("v6.pin.dest")}</legend>
            <label>
              <input
                type="radio"
                name="pin-where"
                checked={where === "home"}
                onChange={() => setWhere("home")}
              />
              {t("v6.pin.home")}
            </label>
            <label>
              <input
                type="radio"
                name="pin-where"
                checked={where === "brain"}
                onChange={() => setWhere("brain")}
              />
              {t("v6.pin.brain")}
            </label>
          </fieldset>
          {where === "brain" ? (
            <div className="field">
              <label htmlFor="pin-brain">{t("v6.pin.brainsel")}</label>
              <select
                id="pin-brain"
                className="select"
                value={chosen}
                onChange={(e) => setBrain(e.target.value)}
              >
                {list.map((b) => (
                  <option key={b.id} value={b.id}>
                    {label(b)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <p className="muted small">{t("v6.pin.note")}</p>
          {err ? (
            <div className="errorbox" role="alert">
              {err}
            </div>
          ) : null}
          <div className="ag-dialog-foot">
            <button type="button" className="btn" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="btn primary"
              disabled={busy || !name.trim() || (where === "brain" && !chosen)}
            >
              {t("v6.pin.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
