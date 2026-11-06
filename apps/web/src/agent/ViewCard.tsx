// One saved view with its chrome: name (rename inline), share, remove with a confirm. The body is
// the stored plan drawn as the current viewer sees it. Used in the My Home grid and the brain's
// My view tab.
import { Link2, Pencil, Share2, Trash2 } from "lucide-react";
import { type FormEvent, type ReactNode, useRef, useState } from "react";
import { ApiError } from "../api";
import { useI18n } from "../i18n";
import { useApp } from "../state";
import { useAgentHost } from "./host";
import { AgentRender } from "./Renderer";
import { useAgentSettings } from "./useSettings";
import { type SavedView, viewsApi } from "./views";

export function ViewCard({
  view,
  onChanged,
  headExtra,
}: {
  view: SavedView;
  /** A change the list must reload for (rename, share, remove). */
  onChanged: (v: SavedView | null) => void;
  headExtra?: ReactNode;
}) {
  const { t } = useI18n();
  const { say } = useApp();
  const { ask } = useAgentHost();
  const s = useAgentSettings();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(view.name);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const renameBtn = useRef<HTMLButtonElement>(null);

  const fail = (e: unknown) => say(e instanceof ApiError ? e.reason : t("v6.view.failed"));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n || n === view.name) {
      setRenaming(false);
      return;
    }
    setBusy(true);
    try {
      onChanged(await viewsApi.update(view.id, { name: n }));
      setRenaming(false);
      requestAnimationFrame(() => renameBtn.current?.focus());
    } catch (x) {
      fail(x);
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    setBusy(true);
    try {
      const r = await viewsApi.share(view.id);
      try {
        await navigator.clipboard.writeText(`${window.location.origin}${r.path}`);
      } catch {
        /* clipboard blocked: the link is still shared */
      }
      say(t("v6.view.copied"));
      if (!view.shared) onChanged({ ...view, shared: true });
    } catch (x) {
      fail(x);
    } finally {
      setBusy(false);
    }
  };
  const unshare = async () => {
    setBusy(true);
    try {
      await viewsApi.unshare(view.id);
      say(t("v6.view.unshared"));
      onChanged({ ...view, shared: false });
    } catch (x) {
      fail(x);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await viewsApi.remove(view.id);
      say(t("v6.view.removed"));
      onChanged(null);
    } catch (x) {
      fail(x);
      setBusy(false);
    }
  };

  return (
    <article className="ag-view" aria-label={view.name} data-testid="agent-view">
      <header className="ag-view-h">
        {headExtra}
        {renaming ? (
          <form className="ag-rename" onSubmit={save}>
            <label className="sr-only" htmlFor={`rn-${view.id}`}>
              {t("v6.view.rename.label")}
            </label>
            <input
              id={`rn-${view.id}`}
              className="input"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setName(view.name);
                  setRenaming(false);
                }
              }}
              // biome-ignore lint/a11y/noAutofocus: the person just asked to rename
              autoFocus
            />
            <button type="submit" className="btn primary sm" disabled={busy || !name.trim()}>
              {t("v6.view.rename.save")}
            </button>
          </form>
        ) : (
          <h3 className="ag-view-t">{view.name}</h3>
        )}
        <div
          className="ag-view-a"
          role="group"
          aria-label={t("v6.view.actions", { name: view.name })}
        >
          {view.shared ? <span className="ag-tag">{t("v6.view.shared")}</span> : null}
          {!renaming ? (
            <button
              ref={renameBtn}
              type="button"
              className="icon-btn"
              aria-label={t("v6.view.rename")}
              title={t("v6.view.rename")}
              onClick={() => {
                setName(view.name);
                setRenaming(true);
              }}
            >
              <Pencil size={15} aria-hidden />
            </button>
          ) : null}
          <button
            type="button"
            className="icon-btn"
            disabled={busy}
            aria-label={view.shared ? t("v6.view.copy") : t("v6.view.share")}
            title={view.shared ? t("v6.view.copy") : t("v6.view.share")}
            onClick={copy}
          >
            {view.shared ? <Link2 size={15} aria-hidden /> : <Share2 size={15} aria-hidden />}
          </button>
          {view.shared ? (
            <button type="button" className="btn ghost sm" disabled={busy} onClick={unshare}>
              {t("v6.view.unshare")}
            </button>
          ) : null}
          <button
            type="button"
            className="icon-btn"
            aria-label={t("v6.view.remove")}
            title={t("v6.view.remove")}
            onClick={() => setConfirm(true)}
          >
            <Trash2 size={15} aria-hidden />
          </button>
        </div>
      </header>
      {confirm ? (
        <div className="ag-confirm" role="alertdialog" aria-label={t("v6.view.remove")}>
          <span>{t("v6.view.remove.confirm", { name: view.name })}</span>
          <button type="button" className="btn danger sm" disabled={busy} onClick={remove}>
            {t("v6.view.remove.yes")}
          </button>
          <button type="button" className="btn ghost sm" onClick={() => setConfirm(false)}>
            {t("common.cancel")}
          </button>
        </div>
      ) : null}
      <div className="ag-view-b">
        <AgentRender
          root={view.tree}
          density={s.density}
          theme={s.theme}
          onTurn={(e, label) => ask({ label, action: e })}
        />
      </div>
    </article>
  );
}
