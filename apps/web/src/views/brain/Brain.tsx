import { ArrowLeft, Download, Moon, Sun } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ApiError } from "../../api";
import { ErrorBox, PageHead, Skeleton } from "../../components/ui";
import { useI18n } from "../../i18n";
import { useApp } from "../../state";
import { useApi } from "../../useApi";
import { downloadExport, ux2 } from "../../uxv2/api";
import type { TreeNode } from "../../uxv2/types";
import { Reading } from "./Reading";
import { BrainTree, type Selected, wsOfFolder } from "./Tree";

const PAPER_KEY = "secondary.paper";
const readPaper = (): boolean => {
  try {
    return window.localStorage.getItem(PAPER_KEY) === "1";
  } catch {
    return false;
  }
};

/** Find the workspace and folder that hold a page, for links that carry only a page id. */
export function locate(
  groups: { nodes: TreeNode[] }[],
  page: string,
): { ws: string; folder: string } | null {
  for (const g of groups)
    for (const w of g.nodes)
      for (const f of w.children ?? [])
        if (f.children?.some((c) => c.id === page)) return { ws: w.id, folder: f.id };
  return null;
}

function ExportPanel({ ws, label, onClose }: { ws: string; label: string; onClose: () => void }) {
  const { t } = useI18n();
  const { say } = useApp();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      await downloadExport(ws);
      say(t("brain.export.done"));
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.reason : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="export-panel" role="group" aria-label={t("brain.export")}>
      <h3>{t("brain.export.title", { name: label })}</h3>
      <p>{t("brain.export.lead")}</p>
      <p className="muted">{t("brain.export.note")}</p>
      {err ? <ErrorBox message={err} /> : null}
      <div className="row">
        <button type="button" className="btn primary" onClick={go} disabled={busy}>
          <Download size={16} aria-hidden /> {busy ? t("brain.export.busy") : t("brain.export.go")}
        </button>
        <button type="button" className="btn ghost" onClick={onClose}>
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}

export function Brain() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const personal = useApi(() => ux2.tree("personal"), []);
  const company = useApi(() => ux2.tree("company"), []);
  const [paper, setPaper] = useState(readPaper);
  const [exporting, setExporting] = useState(false);
  const [folderNode, setFolder] = useState<string | null>(null);

  const groups = useMemo(
    () => [
      { key: "company", title: t("brain.root.company"), nodes: company.data?.roots ?? [] },
      { key: "personal", title: t("brain.root.personal"), nodes: personal.data?.roots ?? [] },
    ],
    [company.data, personal.data, t],
  );

  const pageParam = params.get("page");
  const wsParam = params.get("ws");
  const located = pageParam ? locate(groups, pageParam) : null;
  const selected: Selected | null = pageParam
    ? { ws: wsParam ?? located?.ws ?? "", page: pageParam, folder: located?.folder ?? null }
    : folderNode
      ? { ws: wsOfFolder(folderNode), page: null, folder: folderNode }
      : null;

  const togglePaper = () => {
    const v = !paper;
    setPaper(v);
    try {
      window.localStorage.setItem(PAPER_KEY, v ? "1" : "0");
    } catch {
      /* storage unavailable: the choice lasts for this visit */
    }
  };

  useEffect(() => {
    if (params.get("page") && !params.get("ws") && located)
      setParams({ ws: located.ws, page: params.get("page") as string }, { replace: true });
  }, [located, params, setParams]);

  const openPage = (ws: string, id: string) => {
    setFolder(null);
    setParams({ ws, page: id });
  };
  const openFolder = (_ws: string, id: string) => {
    setFolder(id);
    setParams({});
  };

  const loading = (company.loading && !company.data) || (personal.loading && !personal.data);
  const error = company.error && personal.error ? company.error : null;
  const readOpen = !!selected && !!selected.ws;

  const wsLabel =
    groups.flatMap((g) => g.nodes).find((w) => w.id === selected?.ws)?.label ?? selected?.ws ?? "";
  const folderLabel = (() => {
    const w = groups.flatMap((g) => g.nodes).find((x) => x.id === selected?.ws);
    const f = (w?.children ?? []).find(
      (x) => x.id === selected?.folder || x.children?.some((c) => c.id === selected?.page),
    );
    return f;
  })();

  return (
    <div className={`page brain${readOpen ? " reading-open" : ""}`}>
      <PageHead eyebrow={t("nav.brain")} title={t("brain.title")} />
      {loading ? <Skeleton n={4} /> : null}
      {error ? (
        <ErrorBox
          message={error}
          onRetry={() => {
            company.reload();
            personal.reload();
          }}
        />
      ) : null}
      {!loading && !error ? (
        <div className="brain-grid">
          <aside className="brain-side">
            <BrainTree
              groups={groups}
              selected={selected}
              onPage={openPage}
              onFolder={openFolder}
            />
          </aside>
          <section className="brain-main" aria-label={t("brain.reading")}>
            <div className="brain-bar">
              <button
                type="button"
                className="btn sm ghost brain-back"
                onClick={() => {
                  setFolder(null);
                  setParams({});
                }}
              >
                <ArrowLeft size={14} aria-hidden /> {t("brain.back")}
              </button>
              <span className="sp" />
              <button
                type="button"
                className="btn sm ghost"
                aria-pressed={paper}
                onClick={togglePaper}
              >
                {paper ? <Moon size={14} aria-hidden /> : <Sun size={14} aria-hidden />}
                {paper ? t("brain.paper.off") : t("brain.paper.on")}
              </button>
              {selected?.ws ? (
                <button
                  type="button"
                  className="btn sm ghost"
                  aria-expanded={exporting}
                  onClick={() => setExporting((v) => !v)}
                >
                  <Download size={14} aria-hidden /> {t("brain.export")}
                </button>
              ) : null}
            </div>
            {exporting && selected?.ws ? (
              <ExportPanel ws={selected.ws} label={wsLabel} onClose={() => setExporting(false)} />
            ) : null}
            {selected?.page ? (
              <Reading
                key={`${selected.ws}/${selected.page}`}
                ws={selected.ws}
                id={selected.page}
                paper={paper}
                onLink={(id) => openPage(selected.ws, id)}
                crumb={[wsLabel, folderLabel?.label].filter(Boolean).join(" / ")}
              />
            ) : selected?.folder ? (
              <article className={`reading${paper ? " paper" : ""}`}>
                <p className="crumb muted">{wsLabel}</p>
                <h2>{folderLabel?.label}</h2>
                <p className="muted rd-meta">{t("brain.folder.index")}</p>
                <ul className="folder-index">
                  {(folderLabel?.children ?? []).map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className="linkbtn"
                        onClick={() => openPage(selected.ws, c.id)}
                      >
                        {c.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </article>
            ) : (
              <div className="brain-empty">
                <h3>{t("brain.empty.title")}</h3>
                <p className="muted">{t("brain.empty.lead")}</p>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
